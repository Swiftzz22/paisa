import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/billing/revenuecat — the only thing that may grant paisa. plus.
 *
 * RevenueCat validates Apple's receipts and tells us the result. The app is
 * never asked, and never believed: a purchase reported by a phone is a claim,
 * and a patched build could make that claim for free. Entitlement is therefore
 * written here and nowhere else.
 *
 * Doing this without RevenueCat would mean implementing Apple's App Store
 * Server API, verifying signed JWS transactions, and handling Server
 * Notifications v2 — days of work in the one area where a quiet bug either
 * gives the product away or locks out someone who paid.
 *
 * `app_user_id` is our own user id, set by the app when it identifies itself
 * to RevenueCat, so the row is found without any lookup table.
 */

/**
 * Events that decide access. The set is deliberately small: only the expiry
 * matters, so the many event types RevenueCat can send collapse into "here is
 * the new expiry" and "access is over now".
 */
const GRANTING = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE", // the lifetime product
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  // A billing issue has NOT ended access — Apple retries for days and the
  // person keeps their subscription throughout. Treating it as an expiry would
  // cut off someone whose card simply needed re-authorising.
  "BILLING_ISSUE",
]);

const REVOKING = new Set([
  "EXPIRATION",
  "REFUND",
  // Deliberately NOT "CANCELLATION": a cancelled subscription runs to the end
  // of the period it was paid for. Ending it on the cancellation event would
  // take away time someone has already paid for, which is both wrong and the
  // fastest way to lose the few people who paid.
]);

const Event = z.object({
  event: z.object({
    type: z.string(),
    app_user_id: z.string().min(1).max(200),
    /** Milliseconds since the epoch, or null for a non-expiring purchase. */
    expiration_at_ms: z.number().nullable().optional(),
  }),
});

/** The lifetime product never expires; represent that as very far away. */
const FOREVER = new Date("2099-12-31T00:00:00.000Z");

function authorized(req: NextRequest): boolean {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  // Refuse rather than run open. An unauthenticated endpoint that grants paid
  // access is worse than one that is switched off.
  if (!expected) return false;
  const got = req.headers.get("authorization") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Event.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const { type, app_user_id: userId, expiration_at_ms } = parsed.data.event;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  // 200 rather than 404: the account may have been deleted, and there is
  // nothing for RevenueCat to retry. A non-2xx here would have it redeliver
  // this event for days.
  if (!user) {
    console.warn("[revenuecat] event for unknown user:", type);
    return Response.json({ ok: true, ignored: "unknown-user" });
  }

  if (GRANTING.has(type)) {
    const plusUntil = expiration_at_ms ? new Date(expiration_at_ms) : FOREVER;
    await prisma.user.update({ where: { id: userId }, data: { plusUntil } });
    console.log(`[revenuecat] ${type}: plus until ${plusUntil.toISOString()}`);
    return Response.json({ ok: true });
  }

  if (REVOKING.has(type)) {
    await prisma.user.update({
      where: { id: userId },
      data: { plusUntil: null },
    });
    console.log(`[revenuecat] ${type}: plus removed`);
    return Response.json({ ok: true });
  }

  // Everything else — TRANSFER, SUBSCRIPTION_PAUSED, test events — is recorded
  // and ignored. Acknowledging keeps RevenueCat from retrying an event we have
  // deliberately decided not to act on.
  console.log("[revenuecat] ignored event:", type);
  return Response.json({ ok: true, ignored: type });
}
