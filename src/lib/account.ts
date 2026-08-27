import "server-only";
import { prisma } from "@/lib/prisma";
import { getRefreshToken } from "@/lib/email/account";
import { revokeToken } from "@/lib/email/google-oauth";

export type DeleteAccountResult = {
  transactions: number;
  emails: number;
  categories: number;
  googleAccessRevoked: boolean;
};

/**
 * Permanently delete a user and everything belonging to them.
 *
 * Required by Apple for any app with accounts, and it has to be a real
 * deletion — deactivating or anonymising does not satisfy it.
 *
 * Most tables cascade from User, but three references to Category do not:
 * ExpenseLine, CategorizationRule, and Category's own parent link. Relying on
 * cascade order would leave the delete failing on a foreign key, so everything
 * is removed explicitly, children before parents, inside one transaction. If
 * any part fails, nothing is deleted — a half-deleted account would be worse
 * than none.
 *
 * Google access is revoked first, outside the transaction: it is a network call
 * that can fail, and leaving a live grant on a deleted account is the one
 * outcome worth avoiding most. A revoke failure does not stop the deletion.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  let googleAccessRevoked = false;
  try {
    const refresh = await getRefreshToken(userId);
    if (refresh) {
      await revokeToken(refresh);
      googleAccessRevoked = true;
    }
  } catch {
    // Already revoked, or Google unreachable. Deleting our copy still matters.
  }

  return prisma.$transaction(async (tx) => {
    // Transactions first: ExpenseLine cascades from them, which clears the
    // references blocking Category.
    const transactions = await tx.transaction.deleteMany({ where: { userId } });
    await tx.categorizationRule.deleteMany({ where: { userId } });
    await tx.budget.deleteMany({ where: { userId } });
    const emails = await tx.receivedEmail.deleteMany({ where: { userId } });
    await tx.importBatch.deleteMany({ where: { userId } });

    // Sub-categories reference their parent, so they have to go first.
    const children = await tx.category.deleteMany({
      where: { userId, parentId: { not: null } },
    });
    const parents = await tx.category.deleteMany({ where: { userId } });

    await tx.paymentMode.deleteMany({ where: { userId } });
    await tx.emailAccount.deleteMany({ where: { userId } });
    await tx.passkey.deleteMany({ where: { userId } });
    // Sessions last of the children: this is what signs every device out.
    await tx.session.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });

    return {
      transactions: transactions.count,
      emails: emails.count,
      categories: children.count + parents.count,
      googleAccessRevoked,
    };
  });
}
