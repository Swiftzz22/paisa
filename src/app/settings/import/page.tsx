import Link from "next/link";
import { uploadStatementAction } from "@/lib/actions";
import { getCurrentUser } from "@/lib/user";
import { isGeminiConfigured } from "@/lib/email/parser";

export const dynamic = "force-dynamic";

/**
 * Importing a file has its own page rather than living under Email settings.
 *
 * It used to be a card inside /settings/email, and worse, one that only
 * rendered once a mailbox was already connected — so the single route that
 * needs no Gmail at all was reachable only by people who had already given
 * Gmail access. Someone who wants to upload a CSV and never connect an inbox
 * had no way in.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    error?: string;
    bank?: string;
    rows?: string;
    inserted?: string;
    debits?: string;
    credits?: string;
    skippedRef?: string;
    skippedFuzzy?: string;
    failed?: string;
    warn?: string;
  }>;
}) {
  // Gates the page the way every other settings route is gated. The action
  // itself already resolves the user, so an upload was never unscoped — but a
  // signed-out visitor could still reach the form and be shown an error only
  // after picking a file.
  await getCurrentUser();

  const params = await searchParams;
  const geminiReady = isGeminiConfigured();

  const skipped =
    Number(params.skippedRef ?? "0") + Number(params.skippedFuzzy ?? "0");
  const moved = Number(params.debits ?? "0") + Number(params.credits ?? "0");

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
          Import a statement
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Upload a CSV, Excel, or PDF statement from any bank. No email access
          needed — this works entirely on its own.
        </p>
      </header>

      {params.status === "imported" ? (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
          Imported from {params.bank ?? "statement"}:{" "}
          <strong>{params.inserted}</strong> new transaction
          {params.inserted === "1" ? "" : "s"} added
          {moved > 0 ? (
            <>
              {" "}
              ({params.debits} spent, {params.credits} received)
            </>
          ) : null}
          .
          {skipped > 0 ? (
            <>
              {" "}
              Skipped {skipped} duplicate{skipped === 1 ? "" : "s"} already on
              file.
            </>
          ) : null}
          {Number(params.failed ?? "0") > 0 ? (
            <> {params.failed} rows failed.</>
          ) : null}
          {params.warn ? <> {params.warn}</> : null}{" "}
          <Link href="/" className="font-medium underline">
            See them on the home page
          </Link>
          .
        </div>
      ) : null}
      {params.status === "err" ? (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {params.error ?? "Something went wrong."}
        </div>
      ) : null}

      {!geminiReady ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Statement parsing needs <code>GEMINI_API_KEY</code> to be set. Uploads
          will fail until it is.
        </div>
      ) : null}

      <form
        action={uploadStatementAction}
        className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          <strong>PDF, Excel (.xlsx/.xls), or CSV</strong>. It&apos;s read by AI,
          so format and bank don&apos;t matter: spends and credits are both
          extracted and categorized, and duplicates of transactions you already
          have (from email or an earlier import) are skipped automatically.
        </p>
        <div className="space-y-3">
          <input
            type="file"
            name="statement"
            accept=".pdf,.xls,.xlsx,.csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            required
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-300 dark:file:bg-zinc-700 dark:file:text-zinc-100 dark:hover:file:bg-zinc-600"
          />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">
              Cardholder name (optional)
            </span>
            <input
              type="text"
              name="cardholderName"
              placeholder="Only for joint / family statements — e.g. Sania Kothari"
              className="input"
            />
          </label>
          <button type="submit" className="btn-primary">
            Import
          </button>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Big statements parse faster split by month. Max 10 MB.
          </p>
        </div>
      </form>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Want transactions to appear on their own instead?{" "}
        <Link href="/settings/email" className="underline">
          Connect an inbox
        </Link>{" "}
        and paisa. will read bank alerts as they arrive.
      </p>
    </main>
  );
}
