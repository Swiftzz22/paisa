import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Realign email-sourced transactions to their source email's arrival time.
 *
 * Bank/UPI notification emails are sent within seconds of the transaction, so
 * the email's receivedAt IS the transaction time. Rows created before this rule
 * took hold got their date from the LLM's `transacted_at`, which reads dates out
 * of the email body with no timezone context — producing times hours ahead of
 * the real one, statement due dates, and DD/MM-vs-MM/DD swaps. Any email-sourced
 * transaction whose stored date differs from its email's is corrected. Manual
 * (non-email) transactions are left untouched. Returns how many rows were fixed.
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
    if (r.occurredAt.getTime() === r.email.receivedAt.getTime()) continue;
    await prisma.transaction.update({
      where: { id: r.id },
      data: { occurredAt: r.email.receivedAt },
    });
    fixed++;
  }
  return fixed;
}
