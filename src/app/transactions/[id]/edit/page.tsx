import Link from "next/link";
import { notFound } from "next/navigation";
import { TransactionForm } from "@/components/TransactionForm";
import { getCategoryOptions } from "@/lib/categories";
import { getActivePaymentModes } from "@/lib/payment-modes";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";
import {
  updateTransactionAction,
  deleteTransactionAction,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const [tx, categories, paymentModes] = await Promise.all([
    prisma.transaction.findFirst({
      where: { id, userId: user.id },
      include: { lines: true },
    }),
    getCategoryOptions(user.id),
    getActivePaymentModes(user.id),
  ]);

  if (!tx) notFound();

  const update = updateTransactionAction.bind(null, tx.id);
  const remove = deleteTransactionAction.bind(null, tx.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <Link
          href="/"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Edit transaction
        </h1>
        {tx.source !== "manual" ? (
          <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
            Auto-logged from {tx.source}
          </p>
        ) : null}
      </header>

      <TransactionForm
        action={update}
        categories={categories}
        paymentModes={paymentModes}
        initial={{
          merchant: tx.merchant,
          amount: tx.amount.toString(),
          occurredAt: tx.occurredAt,
          paymentMode: tx.paymentMode,
          categoryId: tx.lines[0]?.categoryId,
          note: tx.note,
          type: tx.type === "credit" ? "credit" : "debit",
        }}
        submitLabel="Save changes"
        cancelHref="/"
      />

      <form action={remove} className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" className="btn-danger">
          Delete transaction
        </button>
      </form>
    </main>
  );
}
