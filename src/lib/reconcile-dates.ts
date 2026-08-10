import "server-only";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Realign wrongly-dated transactions to their source email's date.
 *
 * Bank/UPI notification emails are sent at transaction time, so the email's
 * receivedAt is the authoritative date. Some transactions got a bad occurredAt
 * from an LLM date misparse — a statement "due date" pulled from the body, or a
 * DD/MM-vs-MM/DD swap ("11/08" read as Nov 8) landing weeks away. Any email-
 * sourced transaction whose stored date is more than a day off from its email
 * is corrected to the email's date. Manual (non-email) transactions are left
 * untouched. Returns how many rows were fixed.
 */
export async function reconcileTransactionDates(userId: string): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: { userId, emailId: { not: null } },
    select: {
      id: true,
      occurredAt: true,
      email: { select: { receivedAt: true } },
    },
  });

  let fixed = 0;
  for (const r of rows) {
    if (!r.email) continue;
    const diff = Math.abs(r.occurredAt.getTime() - r.email.receivedAt.getTime());
    if (diff > DAY_MS) {
      await prisma.transaction.update({
        where: { id: r.id },
        data: { occurredAt: r.email.receivedAt },
      });
      fixed++;
    }
  }
  return fixed;
}
