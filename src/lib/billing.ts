import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Who is allowed to spend money, and how much of it.
 *
 * Three things in paisa. cost real money each time they run, and all three are
 * LLM calls: parsing a mailbox during a sync, parsing an uploaded statement,
 * and answering a question. Everything else — the charts, the calendar, the
 * budgets, the lock — is free to serve and stays free to use.
 *
 * The answer is computed here, on the server, from a column the app cannot
 * write. A client that claims to be paying proves nothing; if the phone were
 * trusted, a patched build would bill unlimited model calls to us. That makes
 * this a cost-control boundary before it is a revenue one, which is why the
 * check sits next to the spend rather than next to the UI.
 */

/**
 * Master switch. Off unless PAYWALL_ENABLED is exactly "true".
 *
 * The guards went live before the app had any way to buy anything, which would
 * have met an App Review tester as a feature that simply refuses — there is no
 * purchase path in a build that predates the paywall screen. Gating on an
 * environment variable means the server and the app can ship in either order,
 * and the switch is thrown once a build exists that can actually take money.
 *
 * Defaulting to off is deliberate: forgetting to set it leaves everything
 * working for everyone, which is the failure worth having.
 */
export function paywallEnabled(): boolean {
  return process.env.PAYWALL_ENABLED === "true";
}

/** What a free account gets each calendar month. */
export const FREE_ALLOWANCE = {
  /** One is enough to prove the app works on someone's own statement. */
  import: 1,
  /** A few real answers sell the feature better than a locked button. */
  ask: 3,
} as const;

export type MeteredKind = keyof typeof FREE_ALLOWANCE;

/** True while paisa. plus is live — including a cancelled-but-paid-for period. */
export async function isPlus(userId: string): Promise<boolean> {
  // With the paywall off, everyone is treated as paying — which is what makes
  // every guard in the app inert in one place rather than eighteen.
  if (!paywallEnabled()) return true;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plusUntil: true },
  });
  return Boolean(user?.plusUntil && user.plusUntil.getTime() > Date.now());
}

/**
 * The month an allowance belongs to, in the viewer's own timezone.
 *
 * The reset has to land on a boundary the person recognises — the 1st, their
 * 1st — not thirty days after whenever they first used the app. `tzOffset` is
 * the minutes-ahead-of-UTC the app already sends on every other request; at
 * +330 an Indian user's 1 August starts while it is still 31 July in UTC, and
 * without this they would lose most of a day of allowance every month.
 */
export function monthKey(tzOffsetMinutes = 0): string {
  const local = new Date(Date.now() + tzOffsetMinutes * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type Allowance =
  | { allowed: true; plus: boolean; remaining: number | null }
  | { allowed: false; used: number; limit: number; resetsOn: string };

/**
 * Whether this call may proceed, without recording that it did.
 *
 * Checking and consuming are deliberately separate. A model call can fail — the
 * provider can be overloaded, a PDF can turn out to be unparseable — and
 * charging someone a month's allowance for an answer they never received is
 * the kind of detail people notice and resent. So the caller checks here, does
 * the work, and only calls `consume` once the work succeeded.
 */
export async function checkAllowance(
  userId: string,
  kind: MeteredKind,
  tzOffsetMinutes = 0
): Promise<Allowance> {
  if (await isPlus(userId)) {
    return { allowed: true, plus: true, remaining: null };
  }

  const month = monthKey(tzOffsetMinutes);
  const limit = FREE_ALLOWANCE[kind];
  const row = await prisma.usageCounter.findUnique({
    where: { userId_month_kind: { userId, month, kind } },
    select: { used: true },
  });
  const used = row?.used ?? 0;

  if (used >= limit) {
    return { allowed: false, used, limit, resetsOn: nextMonthLabel(month) };
  }
  return { allowed: true, plus: false, remaining: limit - used };
}

/** Record one successful metered use. No-op for paid accounts. */
export async function consume(
  userId: string,
  kind: MeteredKind,
  tzOffsetMinutes = 0
): Promise<void> {
  if (await isPlus(userId)) return;
  const month = monthKey(tzOffsetMinutes);
  await prisma.usageCounter.upsert({
    where: { userId_month_kind: { userId, month, kind } },
    create: { userId, month, kind, used: 1 },
    update: { used: { increment: 1 } },
  });
}

/** "1 October" — so a refusal can say when the allowance comes back. */
function nextMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  return next.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * The 402 body for a refused call.
 *
 * Written to be shown as-is. A paywall message that only says "upgrade" leaves
 * someone guessing what they hit and when it clears, so this names both.
 * `paywall: true` is what tells the app to offer the upgrade sheet rather than
 * an error banner.
 */
export function paywallResponse(
  allowance: Extract<Allowance, { allowed: false }>,
  what: string
): Response {
  return Response.json(
    {
      error: `You've used your ${allowance.limit} free ${what} this month. paisa. plus gives you unlimited — or your free ${what} comes back on ${allowance.resetsOn}.`,
      paywall: true,
      used: allowance.used,
      limit: allowance.limit,
      resetsOn: allowance.resetsOn,
    },
    { status: 402 }
  );
}

/** The 402 for something Plus gates outright, with no free allowance at all. */
export function plusOnlyResponse(what: string): Response {
  return Response.json(
    {
      error: `${what} is part of paisa. plus.`,
      paywall: true,
      plusOnly: true,
    },
    { status: 402 }
  );
}
