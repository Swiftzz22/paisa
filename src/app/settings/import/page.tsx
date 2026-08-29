import Link from "next/link";
import { uploadStatementAction } from "@/lib/actions";
import { getCurrentUser } from "@/lib/user";
import { SubmitButton } from "@/components/SubmitButton";
import { isGeminiConfigured } from "@/lib/email/parser";

export const dynamic = "force-dynamic";

// Reading a statement means an LLM round-trip over the whole file, which is far
// longer than a normal request. The mobile import route already asked for the
// full 60s; this page's server action was left on the platform default, so a
// large statement could be cut off mid-import — the rows landed but the reply
// carrying "it worked" never arrived.
export const maxDuration = 60;

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
  const added = Number(params.inserted ?? "0");

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
        /* An import can take a while, so the result has to be impossible to
           miss when it lands — a one-line strip after a long wait read as
           nothing having happened at all. */
        <section
          role="status"
          className="mb-6 overflow-hidden rounded-2xl border border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/40"
        >
          <div className="flex items-start gap-3 p-4 sm:p-5">
            <span
              aria-hidden
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-base font-bold text-white"
            >
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-green-900 dark:text-green-100 sm:text-xl">
                {added === 0
                  ? "Nothing new to add"
                  : `${added} transaction${added === 1 ? "" : "s"} imported`}
              </h2>
              <p className="mt-1 text-sm text-green-800 dark:text-green-200">
                {added === 0 ? (
                  <>
                    Every row in that {params.bank ?? "statement"} was already on
                    file, so nothing was duplicated.
                  </>
                ) : (
                  <>
                    Read from your {params.bank ?? "statement"} and added to your
                    account.
                  </>
                )}
              </p>

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {moved > 0 ? (
                  <>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-green-700/80 dark:text-green-300/70">
                        Spent
                      </dt>
                      <dd className="font-semibold tabular-nums text-green-900 dark:text-green-100">
                        {params.debits}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-green-700/80 dark:text-green-300/70">
                        Received
                      </dt>
                      <dd className="font-semibold tabular-nums text-green-900 dark:text-green-100">
                        {params.credits}
                      </dd>
                    </div>
                  </>
                ) : null}
                {skipped > 0 ? (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-green-700/80 dark:text-green-300/70">
                      Already had
                    </dt>
                    <dd className="font-semibold tabular-nums text-green-900 dark:text-green-100">
                      {skipped}
                    </dd>
                  </div>
                ) : null}
                {Number(params.failed ?? "0") > 0 ? (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      Couldn&apos;t read
                    </dt>
                    <dd className="font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                      {params.failed}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {params.warn ? (
                <p className="mt-3 text-xs text-green-800/90 dark:text-green-200/90">
                  {params.warn}
                </p>
              ) : null}

              <Link
                href="/"
                className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-800 sm:w-auto"
              >
                See them on the home page →
              </Link>
            </div>
          </div>
        </section>
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
          <SubmitButton
            className="btn-primary w-full gap-2 sm:w-auto"
            pendingText="Reading your statement…"
          >
            Import
          </SubmitButton>
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
