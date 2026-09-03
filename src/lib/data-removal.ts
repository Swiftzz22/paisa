import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Removing data without removing the account.
 *
 * Deleting the whole account was the only way to undo anything, which is far
 * too blunt: importing the wrong statement, or importing one twice, should not
 * cost someone their categories, budgets and rules.
 */

export type ImportSummary = {
  id: string;
  filename: string;
  bank: string;
  importedAt: Date;
  /** Transactions from this import still present. */
  remaining: number;
  spent: number;
  received: number;
};

/** Every statement this user has imported, newest first. */
export async function listImports(userId: string): Promise<ImportSummary[]> {
  const batches = await prisma.importBatch.findMany({
    where: { userId },
    orderBy: { importedAt: "desc" },
    select: {
      id: true,
      filename: true,
      bank: true,
      importedAt: true,
      transactions: { select: { amount: true, type: true } },
    },
  });

  return batches.map((b) => {
    let spent = 0;
    let received = 0;
    for (const t of b.transactions) {
      if (t.type === "credit") received += Number(t.amount);
      else spent += Number(t.amount);
    }
    return {
      id: b.id,
      filename: b.filename,
      bank: b.bank,
      importedAt: b.importedAt,
      remaining: b.transactions.length,
      spent,
      received,
    };
  });
}

/**
 * Undo one import: its transactions and their category lines, then the batch.
 *
 * Scoped by userId in the same query as the id, so a guessed batch id from
 * another account matches nothing rather than deleting someone else's data.
 */
export async function deleteImport(
  userId: string,
  batchId: string
): Promise<{ deleted: number }> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, userId },
    select: { id: true },
  });
  if (!batch) return { deleted: 0 };

  return prisma.$transaction(async (tx) => {
    await tx.expenseLine.deleteMany({
      where: { transaction: { importBatchId: batch.id, userId } },
    });
    const { count } = await tx.transaction.deleteMany({
      where: { importBatchId: batch.id, userId },
    });
    await tx.importBatch.deleteMany({ where: { id: batch.id, userId } });
    return { deleted: count };
  });
}

/**
 * Remove every transaction, keeping the account and everything the user set up
 * — categories, budgets, rules, learned names and connected inboxes all stay.
 *
 * Stored emails are reset to pending rather than deleted, so a fresh sync can
 * rebuild the transactions from mail already fetched instead of going back to
 * Gmail for it. Import batches go, because their transactions have.
 */
export async function deleteAllTransactions(
  userId: string
): Promise<{ deleted: number; emailsReset: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.expenseLine.deleteMany({ where: { transaction: { userId } } });
    const { count } = await tx.transaction.deleteMany({ where: { userId } });
    await tx.importBatch.deleteMany({ where: { userId } });
    const { count: emailsReset } = await tx.receivedEmail.updateMany({
      where: { userId, parseStatus: "parsed" },
      data: { parseStatus: "pending", parseError: null },
    });
    return { deleted: count, emailsReset };
  });
}
