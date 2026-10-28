import Link from "next/link";
import { TransactionForm } from "@/components/TransactionForm";
import { getCategoryOptions } from "@/lib/categories";
import { getActivePaymentModes } from "@/lib/payment-modes";
import { getCurrentUser } from "@/lib/user";
import { createTransactionAction } from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import { QuickAdd } from "@/components/QuickAdd";

export const dynamic = "force-dynamic";

/** How far back quick add looks to learn where each merchant usually goes. */
const HISTORY = 400;

export default async function NewTransactionPage({
  searchParams,
}: {
  // Filled in by quick add when it understood only part of a line.
  searchParams: Promise<{
    amount?: string;
    merchant?: string;
    categoryId?: string;
    paymentMode?: string;
    date?: string;
    type?: string;
    note?: string;
  }>;
}) {
  const user = await getCurrentUser();
  const [categories, paymentModes, history, prefill] = await Promise.all([
    getCategoryOptions(user.id),
    getActivePaymentModes(user.id),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { occurredAt: "desc" },
      take: HISTORY,
      select: { merchant: true, lines: { select: { categoryId: true }, take: 1 } },
    }),
    searchParams,
  ]);

  // Newest first, so the most recent filing of a merchant wins.
  const merchantCategories: Record<string, string> = {};
  for (const t of history) {
    const key = t.merchant.trim().toLowerCase();
    const cat = t.lines[0]?.categoryId;
    if (cat && !(key in merchantCategories)) merchantCategories[key] = cat;
  }

  const date = prefill.date && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date) ? prefill.date : null;
  const initial = {
    amount: prefill.amount,
    merchant: prefill.merchant,
    categoryId: prefill.categoryId,
    paymentMode: prefill.paymentMode,
    note: prefill.note ?? null,
    type: prefill.type === "credit" ? ("credit" as const) : ("debit" as const),
    occurredAt: date ? new Date(`${date}T12:00:00`) : undefined,
  };

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

      <QuickAdd
        action={createTransactionAction}
        categories={categories.map((c) => ({ id: c.id, label: c.label }))}
        paymentModes={paymentModes.map((m) => ({ value: m.value, label: m.label }))}
        merchantCategories={merchantCategories}
      />

      <TransactionForm
        // Re-mount when quick add hands over new values, so the defaults apply.
        key={JSON.stringify(prefill)}
        action={createTransactionAction}
        initial={initial}
        categories={categories}
        paymentModes={paymentModes}
        submitLabel="Save"
        cancelHref="/"
      />
    </main>
  );
}
