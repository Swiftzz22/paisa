import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";
import { listImports } from "@/lib/data-removal";
import {
  deleteAllTransactionsAction,
  deleteImportAction,
} from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { formatINR, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Removing data without removing the account.
 *
 * Deleting the account was previously the only undo available, which is a
 * terrible answer to "I imported the wrong file" — it costs the categories,
 * budgets and rules too. Undoing one import is the common case and sits first;
 * clearing everything is below it behind a typed confirmation.
 */
export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    error?: string;
    count?: string;
    emails?: string;
  }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;

  const [imports, totalTransactions] = await Promise.all([
    listImports(user.id),
    prisma.transaction.count({ where: { userId: user.id } }),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <Link
          href="/settings"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Your data
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Undo a statement you imported, or clear your transactions without
          losing your account.
        </p>
      </header>

      {params.status === "removed" ? (
        <Banner tone="ok">
          Removed <strong>{params.count}</strong> transaction
          {params.count === "1" ? "" : "s"} from that import.
        </Banner>
      ) : null}
      {params.status === "cleared" ? (
        <Banner tone="ok">
          Deleted <strong>{params.count}</strong> transaction
          {params.count === "1" ? "" : "s"}.
          {Number(params.emails ?? "0") > 0 ? (
            <>
              {" "}
              {params.emails} stored email
              {params.emails === "1" ? "" : "s"} will be read again on the next
              sync, so anything that came from email will come back.
            </>
          ) : null}
        </Banner>
      ) : null}
      {params.status === "err" ? (
        <Banner tone="err">{params.error ?? "Something went wrong."}</Banner>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Files you imported
        </h2>
        {imports.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            You haven&rsquo;t imported a statement yet.{" "}
            <Link href="/settings/import" className="underline">
              Import one
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {imports.map((b) => (
              <li
                key={b.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {b.filename}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {b.bank} · {formatDateTime(b.importedAt)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      <strong className="tabular-nums">{b.remaining}</strong>{" "}
                      transaction{b.remaining === 1 ? "" : "s"} still here
                      {b.spent > 0 ? <> · {formatINR(b.spent)} spent</> : null}
                      {b.received > 0 ? (
                        <> · {formatINR(b.received)} received</>
                      ) : null}
                    </p>
                  </div>
                  <form action={deleteImportAction} className="shrink-0">
                    <input type="hidden" name="batchId" value={b.id} />
                    <SubmitButton
                      className="btn-danger gap-2"
                      pendingText="Removing…"
                      title={`Remove the ${b.remaining} transactions from ${b.filename}`}
                    >
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Removing an import deletes only the transactions that came from that
          file. Anything you typed in or that arrived by email stays.
        </p>
      </section>

      <section className="mt-8 rounded-lg border border-red-300 bg-red-50/60 p-4 dark:border-red-900 dark:bg-red-950/30">
        <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
          Delete all transactions
        </h2>
        <p className="mt-1 text-sm text-red-800 dark:text-red-300">
          Removes all <strong>{totalTransactions.toLocaleString("en-IN")}</strong>{" "}
          transactions and every import. Your account, categories, budgets,
          rules, learned names and connected inboxes are kept.
        </p>
        <p className="mt-2 text-xs text-red-800/80 dark:text-red-300/80">
          Emails paisa. has already stored will be read again on the next sync,
          so transactions that came from email will reappear. To stop that,
          disconnect the inbox first.
        </p>
        <form action={deleteAllTransactionsAction} className="mt-3">
          <label
            htmlFor="confirm"
            className="block text-sm text-red-900 dark:text-red-200"
          >
            Type <strong>DELETE</strong> to confirm
          </label>
          <input
            id="confirm"
            name="confirm"
            autoComplete="off"
            required
            placeholder="DELETE"
            className="input mt-1"
          />
          <SubmitButton
            className="btn-danger mt-3 w-full gap-2 sm:w-auto"
            pendingText="Deleting…"
          >
            Delete all transactions
          </SubmitButton>
        </form>
      </section>

      <p className="mt-6 text-xs text-zinc-500">
        Want to remove everything, including your account?{" "}
        <Link href="/settings/delete-account" className="underline">
          Delete your account
        </Link>
        .
      </p>
    </main>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "err";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200"
      : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200";
  return (
    <div className={`mb-4 rounded-lg border p-3 text-sm ${cls}`}>{children}</div>
  );
}
