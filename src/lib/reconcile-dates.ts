import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Realign email-sourced transactions to their source email's arrival time.
 *
 * Bank/UPI notification emails are sent within seconds of the transaction, so
 * the email's receivedAt IS the transaction time. Rows created before this rule
 * took hold got their date from the LLM's `transacted_at`, which read dates out
 * of the email body with no timezone context — an IST wall-clock time parsed as
 * UTC on the (UTC) server landed 5h30m ahead, so an evening order surfaced as
 * 1 am the next day. Manual (non-email) transactions are left untouched.
 *
 * Done as a single correlated UPDATE: this touches every mis-dated row a user
 * has, and one round-trip per row would blow the sync route's 60s budget
 * against a remote Turso instance. Returns how many rows were corrected.
 */
export async function reconcileTransactionDates(userId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Transaction"
    SET "occurredAt" = (
      SELECT "ReceivedEmail"."receivedAt"
      FROM "ReceivedEmail"
      WHERE "ReceivedEmail"."id" = "Transaction"."emailId"
        AND "ReceivedEmail"."userId" = ${userId}
    )
    WHERE "Transaction"."userId" = ${userId}
      AND "Transaction"."emailId" IS NOT NULL
      AND "Transaction"."occurredAt" <> (
        SELECT "ReceivedEmail"."receivedAt"
        FROM "ReceivedEmail"
        WHERE "ReceivedEmail"."id" = "Transaction"."emailId"
      )
  `;
}
