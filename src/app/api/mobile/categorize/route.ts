import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { isPlus, plusOnlyResponse } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { getCategoryOptions } from "@/lib/categories";
import { GeminiRateLimitError, categorizeMerchantBatch } from "@/lib/email/parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/mobile/categorize — a category for a scanned receipt (paisa. plus).
 *
 * The app tries the person's own history on the phone first. This is for a
 * merchant it has never seen: their own rules are checked, then the same
 * Gemini categoriser the bank emails use picks one of *their* categories.
 *
 * Only a merchant name and a few item names come here, after the person has
 * agreed to AI use; never the photo. Nothing is stored. A receipt is data,
 * so its words reach the model as a list to label, not as instructions.
 */

const DAILY_CAP = 60;

const Body = z.object({
  merchant: z.string().trim().min(1).max(120),
  /** Item names off the receipt, which tell "Lawson" apart as a grocery run. */
  items: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
});

// Best effort across serverless instances, like the receipt route's cap.
const usage = new Map<string, { day: string; count: number }>();
function underCap(userId: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(userId);
  if (!u || u.day !== day) {
    usage.set(userId, { day, count: 1 });
    return true;
  }
  if (u.count >= DAILY_CAP) return false;
  u.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlus(user.id))) return plusOnlyResponse("Receipt scanning");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Send a merchant name." }, { status: 400 });
  }
  const { merchant, items = [] } = parsed.data;
  const options = await getCategoryOptions(user.id);
  const byLabel = new Map(options.map((c) => [c.label, c]));

  // Their own rules win over any guess, exactly as at email ingest:
  // case-insensitive "contains", highest priority first.
  const rules = await prisma.categorizationRule.findMany({
    where: { userId: user.id, matcherType: "merchant" },
    orderBy: { priority: "desc" },
    select: { matcherValue: true, categoryId: true },
  });
  const lower = merchant.toLowerCase();
  const rule = rules.find((r) => r.matcherValue && lower.includes(r.matcherValue));
  const ruled = rule ? options.find((c) => c.id === rule.categoryId) : null;
  if (ruled) {
    return Response.json({ categoryId: ruled.id, label: ruled.label, from: "rule" });
  }

  if (!underCap(user.id)) {
    return Response.json(
      { error: "That's a lot of receipts today. Pick the category this time." },
      { status: 429 }
    );
  }

  // The batch categoriser labels merchant strings; the items ride along in
  // the string so the model sees what was bought.
  const key = items.length ? `${merchant} (bought: ${items.join(", ")})` : merchant;
  try {
    const labels = await categorizeMerchantBatch({
      merchants: [key],
      categories: options.map((c) => ({ id: c.id, label: c.label })),
    });
    const hit = byLabel.get(labels.get(key) ?? "");
    // "Misc" is the model saying it couldn't tell; leave the choice to them.
    if (!hit || hit.label === "Misc") {
      return Response.json({ categoryId: null, label: null, from: "ai" });
    }
    return Response.json({ categoryId: hit.id, label: hit.label, from: "ai" });
  } catch (e) {
    if (e instanceof GeminiRateLimitError) {
      return Response.json(
        { error: "The AI is busy right now. Pick the category this time." },
        { status: 429 }
      );
    }
    console.error("[categorize] failed", e);
    return Response.json({ error: "Couldn't suggest a category." }, { status: 502 });
  }
}
