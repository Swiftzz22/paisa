import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    fetched?: string;
    inserted?: string;
    skipped?: string;
    parsed?: string;
    ignored?: string;
    failed?: string;
    total?: string;
    status?: string;
    retry?: string;
    remaining?: string;
    show?: string; // legacy; ignored emails are always hidden
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // Inbox shows only relevant emails — parsed (became an expense), failed
  // (need attention), pending (not yet processed), and notices, which are
  // there to be acted on: Gmail's forwarding confirmation is the one piece of
  // mail without which forwarding cannot be set up at all. Ignored emails are
  // pre-filter noise and never shown here.
  const [emails, ignoredCount] = await Promise.all([
    prisma.receivedEmail.findMany({
      where: {
        userId: user.id,
        parseStatus: { in: ["pending", "parsed", "failed", "notice"] },
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: {
        id: true,
        fromAddress: true,
        subject: true,
        receivedAt: true,
        parseStatus: true,
      },
    }),
    prisma.receivedEmail.count({
      where: { userId: user.id, parseStatus: "ignored" },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
          >
            ← Back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Inbox (debug)
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Raw emails pulled from Gmail. Used to design the parser.
          </p>
        </div>
        <Link href="/settings/email" className="btn-secondary">
          Settings
        </Link>
      </header>

      {params.fetched ? (
        <div className="mb-4 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          Fetched {params.fetched} email{params.fetched === "1" ? "" : "s"} —{" "}
          {params.inserted} new, {params.skipped} already on file
          {params.parsed && Number(params.parsed) > 0
            ? `. Auto-created ${params.parsed} expense${
                params.parsed === "1" ? "" : "s"
              }.`
            : "."}
        </div>
      ) : null}
      {params.status === "parsed" && params.total ? (
        <div className="mb-4 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          Processed {params.total} email{params.total === "1" ? "" : "s"}:{" "}
          {params.parsed} parsed → expenses created, {params.ignored} ignored,{" "}
          {params.failed} failed.
          {params.remaining && Number(params.remaining) > 0 ? (
            <>
              {" "}
              <strong>{params.remaining} still pending</strong> — click
              &quot;Parse pending&quot; again to do the next batch.
            </>
          ) : null}
        </div>
      ) : null}
      {params.status === "ratelimited" ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>Paused — AI rate limit.</strong>
          {` Got through ${params.parsed ?? "0"} parsed and ${params.ignored ?? "0"} ignored on this run. The rest stay pending — they'll be picked up by the background sync (or click "Parse pending" again in ~${params.retry ?? "60"}s). No work is lost.`}
        </div>
      ) : null}

      <div className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Showing {emails.length} transaction-shaped email
        {emails.length === 1 ? "" : "s"}
        {ignoredCount > 0 ? (
          <> · {ignoredCount} non-transaction emails filtered out</>
        ) : null}
      </div>

      {emails.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {emails.map((e) => (
            <li key={e.id}>
              <Link
                href={`/inbox/${e.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ParseBadge status={e.parseStatus} />
                    <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {e.fromAddress || "(unknown)"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {e.subject || "(no subject)"}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400">
                  {formatDateTime(e.receivedAt)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ParseBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    parsed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    ignored: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
    notice: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  };
  const cls = styles[status] ?? styles.pending;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-950">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No emails fetched yet.
      </p>
      <Link href="/settings/email" className="btn-primary mt-4">
        Go to settings
      </Link>
    </div>
  );
}
