import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Bill splitting (paisa. plus).
 *
 * The one idea everything hangs on: a split expense keeps `Transaction.amount`
 * as *your share*, and the whole bill moves to `splitTotal`. Every total,
 * budget, chart and the Ask agent sums `amount`, so they all count only what
 * you actually spent without a line of them changing — and an app that has
 * never heard of splits still shows the right number.
 *
 * Shares are worked out here, never taken from the phone. The app sends what
 * was entered (equal, exact amounts, percentages, share counts, or per-person
 * totals from receipt items) as weights; the server divides the bill by them.
 * That matters for foreign receipts in particular, whose rupee total only the
 * server knows exactly.
 */

export const SPLIT_MODES = ["equal", "exact", "percent", "shares", "items"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

/**
 * Divide `total` rupees by `weights`, to the paisa, so the parts add up to the
 * total exactly. Largest remainder: everyone gets the floor of their exact
 * share, and the paise left over go one each to whoever lost the most to
 * rounding (ties to the earlier entry, so the result is stable). ₹100 three
 * ways is 33.34 + 33.33 + 33.33, never 99.99.
 */
export function allocate(total: number, weights: number[]): number[] {
  const paise = Math.round(total * 100);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new Error("Weights must add up to more than zero.");
  const exact = weights.map((w) => (paise * w) / sum);
  const floors = exact.map(Math.floor);
  let left = paise - floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return floors.map((p) => p / 100);
}

export type SplitInput = {
  /** null = you paid. */
  paidBy: string | null;
  mode: SplitMode;
  /** personId null = you. Weight 0 is allowed (in the split, owes nothing). */
  entries: { personId: string | null; weight: number }[];
};

export class SplitError extends Error {}

/** The whole bill: splitTotal for an already-split expense, else its amount. */
function billOf(t: { amount: unknown; splitTotal: unknown }): number {
  return Number(t.splitTotal ?? t.amount);
}

/**
 * Split an expense, or re-split one. Replaces any previous split in one
 * transaction so the books are never half-written.
 */
export async function applySplit(userId: string, transactionId: string, input: SplitInput) {
  const txn = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    include: { lines: true },
  });
  if (!txn) throw new SplitError("Not found.");
  if (txn.type !== "debit") throw new SplitError("Only spending can be split.");

  // Every person named must be this user's own, whoever they are in the split.
  const ids = new Set<string>();
  for (const e of input.entries) if (e.personId) ids.add(e.personId);
  if (input.paidBy) ids.add(input.paidBy);
  const people = await prisma.person.findMany({
    where: { id: { in: [...ids] }, userId },
    select: { id: true },
  });
  if (people.length !== ids.size) throw new SplitError("Unknown person in the split.");

  const seen = new Set<string>();
  for (const e of input.entries) {
    const key = e.personId ?? "me";
    if (seen.has(key)) throw new SplitError("Someone appears twice in the split.");
    seen.add(key);
  }
  if (!seen.has("me")) {
    // You are always part of your own expense, even at zero — it is how the
    // app shows "you paid, it was all theirs".
    input.entries.push({ personId: null, weight: 0 });
  }
  if (input.entries.length < 2) throw new SplitError("A split needs at least one other person.");
  if (input.paidBy && !input.entries.some((e) => e.personId === input.paidBy)) {
    throw new SplitError("Whoever paid has to be in the split.");
  }

  const bill = billOf(txn);
  const amounts = allocate(bill, input.entries.map((e) => e.weight));
  const mine = amounts[input.entries.findIndex((e) => e.personId === null)];

  await prisma.$transaction(async (tx) => {
    await tx.splitShare.deleteMany({ where: { transactionId } });
    await tx.splitShare.createMany({
      data: input.entries.map((e, i) => ({
        transactionId,
        personId: e.personId,
        amount: amounts[i],
        weight: e.weight,
      })),
    });
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        amount: mine,
        splitTotal: bill,
        splitMode: input.mode,
        paidByPersonId: input.paidBy,
      },
    });
    await rescaleLines(tx, txn.lines, mine);
  });
}

/** Undo a split: the expense is the whole bill again. */
export async function removeSplit(userId: string, transactionId: string) {
  const txn = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    include: { lines: true },
  });
  if (!txn) throw new SplitError("Not found.");
  if (txn.splitTotal == null) return;
  const bill = Number(txn.splitTotal);
  await prisma.$transaction(async (tx) => {
    await tx.splitShare.deleteMany({ where: { transactionId } });
    await tx.transaction.update({
      where: { id: transactionId },
      data: { amount: bill, splitTotal: null, splitMode: null, paidByPersonId: null },
    });
    await rescaleLines(tx, txn.lines, bill);
  });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Category lines must keep adding up to the transaction, or category charts
 * would still count the whole bill. One line (nearly always) just takes the
 * new amount; several are scaled in proportion, to the paisa.
 */
async function rescaleLines(tx: Tx, lines: { id: string; amount: unknown }[], to: number) {
  if (lines.length === 0) return;
  if (lines.length === 1) {
    await tx.expenseLine.update({ where: { id: lines[0].id }, data: { amount: to } });
    return;
  }
  const parts = allocate(to, lines.map((l) => Math.max(0, Number(l.amount))));
  for (let i = 0; i < lines.length; i++) {
    await tx.expenseLine.update({ where: { id: lines[i].id }, data: { amount: parts[i] } });
  }
}

/**
 * What each person and you owe each other, from your side: positive means
 * they owe you, negative means you owe them.
 *
 * - You paid: each of their shares is owed to you.
 * - They paid: your share is owed to them. (Shares between two other people
 *   are theirs to sort out; you only track your own side.)
 * - Settlements move it back towards zero.
 */
export async function balances(userId: string): Promise<Map<string, number>> {
  const [shares, settlements] = await Promise.all([
    prisma.splitShare.findMany({
      where: { transaction: { userId } },
      select: {
        personId: true,
        amount: true,
        transaction: { select: { paidByPersonId: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { userId },
      select: { personId: true, amount: true, direction: true },
    }),
  ]);

  const paise = new Map<string, number>();
  const add = (id: string, p: number) => paise.set(id, (paise.get(id) ?? 0) + p);
  for (const s of shares) {
    const p = Math.round(Number(s.amount) * 100);
    const payer = s.transaction.paidByPersonId;
    if (payer === null && s.personId) add(s.personId, p);
    else if (payer !== null && s.personId === null) add(payer, -p);
  }
  for (const s of settlements) {
    const p = Math.round(Number(s.amount) * 100);
    add(s.personId, s.direction === "paid" ? p : -p);
  }
  return new Map([...paise].map(([id, p]) => [id, p / 100]));
}

/** Prisma include for a transaction's split, shared by every serializer. */
export const SPLIT_INCLUDE = {
  shares: { include: { person: { select: { name: true } } } },
} as const;

type WithSplit = {
  splitTotal: unknown;
  splitMode: string | null;
  paidByPersonId: string | null;
  shares?: { personId: string | null; amount: unknown; weight: unknown; person: { name: string } | null }[];
};

/** The `split` field on a serialized transaction; older apps ignore it. */
export function serializeSplit(t: WithSplit) {
  if (t.splitTotal == null || !t.shares?.length) return null;
  return {
    total: Number(t.splitTotal),
    mode: t.splitMode,
    paidBy: t.paidByPersonId,
    shares: t.shares.map((s) => ({
      personId: s.personId,
      name: s.person?.name ?? null,
      amount: Number(s.amount),
      weight: Number(s.weight),
    })),
  };
}

/** A person as the app sends one. */
export const PersonBody = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(20).nullish(),
  // name@bank — what a UPI app needs to pay them.
  upiId: z
    .string()
    .trim()
    .regex(/^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/, "That doesn't look like a UPI ID.")
    .nullish(),
});
