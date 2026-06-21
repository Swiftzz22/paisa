import Link from "next/link";
import { TransactionForm } from "@/components/TransactionForm";
import { getCategoryOptions } from "@/lib/categories";
import { getActivePaymentModes } from "@/lib/payment-modes";
import { getCurrentUser } from "@/lib/user";
import { createTransactionAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage() {
  const user = await getCurrentUser();
  const [categories, paymentModes] = await Promise.all([
    getCategoryOptions(user.id),
    getActivePaymentModes(user.id),
  ]);

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
          Add transaction
        </h1>
      </header>

      <TransactionForm
        action={createTransactionAction}
        categories={categories}
        paymentModes={paymentModes}
        submitLabel="Save"
        cancelHref="/"
      />
    </main>
  );
}
