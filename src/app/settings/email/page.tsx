import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { getEmailAccount } from "@/lib/email/account";
import { isGoogleConfigured } from "@/lib/email/google-oauth";
import { isGeminiConfigured } from "@/lib/email/parser";
import {
  fetchRecentEmailsAction,
  disconnectGmailAction,
  parsePendingEmailsAction,
  runSyncNowAction,
  reprocessIgnoredEmailsAction,
} from "@/lib/actions";
import { formatDateTime } from "@/lib/format";
import { getLastSyncRun } from "@/lib/sync";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    email?: string;
    error?: string;
    upi?: string;
    count?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const account = await getEmailAccount(user.id);
  const oauthReady = isGoogleConfigured();
  const geminiReady = isGeminiConfigured();

  const [totalCount, lastEmail, pendingCount] = account
    ? await Promise.all([
        prisma.receivedEmail.count({ where: { userId: user.id } }),
        prisma.receivedEmail.findFirst({
          where: { userId: user.id },
          orderBy: { receivedAt: "desc" },
          select: { receivedAt: true },
        }),
        prisma.receivedEmail.count({
          where: {
            userId: user.id,
            parseStatus: { in: ["pending", "failed"] },
          },
        }),
      ])
    : [0, null, 0];

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
          Email settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Connect Gmail to auto-ingest bank, UPI, and card transaction emails.
        </p>
      </header>

      {params.status === "connected" ? (
        <Banner kind="ok">
          Connected to {params.email ?? "Gmail"}. Click &quot;Fetch recent&quot; to
          pull your latest emails.
        </Banner>
      ) : null}
      {params.status === "disconnected" ? (
        <Banner kind="ok">Gmail disconnected.</Banner>
      ) : null}
      {params.status === "reprocessed" ? (
        <Banner kind="ok">
          Reset {params.count} previously-ignored email
          {params.count === "1" ? "" : "s"} to pending. The background sync
          (every 60s) will re-evaluate them under the current parser — credits
          missed by older runs will get captured.
        </Banner>
      ) : null}
      {params.status === "err" ? (
        <Banner kind="err">{params.error ?? "Something went wrong."}</Banner>
      ) : null}

      {!oauthReady ? (
        <SetupCard />
      ) : !account ? (
        <NotConnectedCard />
      ) : (
        <div className="space-y-4">
          <StatusCard
            account={account}
            totalCount={totalCount}
            lastReceived={lastEmail?.receivedAt ?? null}
            pendingCount={pendingCount}
            geminiReady={geminiReady}
          />

          <SyncCard userId={user.id} />

          <form
            action={fetchRecentEmailsAction}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col">
                <span className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                  From (optional)
                </span>
                <input name="after" type="date" className="input" />
              </label>
              <label className="flex flex-col">
                <span className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                  To (optional)
                </span>
                <input name="before" type="date" className="input" />
              </label>
              <label className="flex flex-col">
                <span className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                  Max count
                </span>
                <input
                  name="count"
                  type="number"
                  min={1}
                  max={2000}
                  defaultValue={500}
                  className="input"
                />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Only fetches emails from known bank / UPI / card senders, newest
                first. Leave dates blank to fetch the most recent N.
              </p>
              <button type="submit" className="btn-primary">
                Fetch
              </button>
            </div>
          </form>

          <div className="flex flex-wrap gap-2">
            {pendingCount > 0 && geminiReady ? (
              <form action={parsePendingEmailsAction}>
                <button type="submit" className="btn-primary">
                  Parse pending ({pendingCount})
                </button>
              </form>
            ) : null}
            <form action={reprocessIgnoredEmailsAction}>
              <button
                type="submit"
                className="btn-secondary"
                title="Push all currently-ignored emails back into pending so the current parser re-evaluates them. Useful after we improve the prompt (e.g. teaching it new transaction shapes like credits)."
              >
                Reprocess ignored
              </button>
            </form>
            <Link href="/inbox" className="btn-secondary">
              View inbox
            </Link>
            <form action={disconnectGmailAction}>
              <button type="submit" className="btn-danger">
                Disconnect
              </button>
            </form>
          </div>

          {!geminiReady ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <strong>AI key not set.</strong> Fetching will store emails but
              won&apos;t auto-create expenses until you set{" "}
              <code className="font-mono">NVIDIA_API_KEY</code>. Get one free at{" "}
              <a
                href="https://build.nvidia.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                build.nvidia.com
              </a>
              .
            </div>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              The background sync runs every 60 seconds — these manual buttons
              are for when you want to force a fetch / parse right now.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "ok" | "err";
  children: React.ReactNode;
}) {
  const cls =
    kind === "ok"
      ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200";
  return (
    <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function SyncCard({ userId }: { userId: string }) {
  const status = getLastSyncRun(userId);
  const tokenExpired =
    !!status?.error &&
    /invalid_grant|unauthorized|401/i.test(status.error);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Background sync
        </h2>
        <form action={runSyncNowAction}>
          <button type="submit" className="btn-secondary text-xs px-3 py-1">
            Run now
          </button>
        </form>
      </div>

      {tokenExpired ? (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <div>
            <strong>Gmail authorization expired.</strong> Click{" "}
            <a href="/api/auth/google" className="font-medium underline">
              Reconnect Gmail
            </a>{" "}
            to refresh — your existing transactions stay intact.
          </div>
          <div className="mt-2 text-xs">
            <strong>One-time fix to stop this happening every 7 days:</strong>{" "}
            in{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials/consent"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Google Cloud Console → OAuth consent screen
            </a>
            , click <strong>Publish app</strong> to flip the publishing status
            from <em>Testing</em> to <em>In production</em>. The unverified-app
            warning still shows on first connect (one click), but tokens then
            don&apos;t expire. Test-mode tokens auto-expire after 7 days — this
            is Google&apos;s policy, not a bug here.
          </div>
        </div>
      ) : null}

      {status ? (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Row label="Last run">{formatDateTime(status.ranAt)}</Row>
          <Row label="Backfill">
            {status.backfillComplete ? (
              <span className="text-green-700 dark:text-green-400">Caught up to Jan 1, 2026</span>
            ) : status.backfillStillRunning ? (
              <span>In progress — pulling older emails…</span>
            ) : (
              <span>Idle</span>
            )}
          </Row>
          <Row label="Oldest email in DB">
            {status.oldestInDb ? formatDateTime(status.oldestInDb) : "—"}
          </Row>
          <Row label="Last run results">
            {status.fetched > 0 || status.processed.parsed > 0
              ? `+${status.fetched} fetched, ${status.processed.parsed} parsed`
              : tokenExpired
                ? <span className="text-red-700 dark:text-red-400">Gmail token expired — reconnect above</span>
                : status.error
                  ? <span className="text-red-700 dark:text-red-400">error: {status.error.slice(0, 80)}</span>
                  : "nothing new"}
          </Row>
        </dl>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The sync runs every 60 seconds. Reload this page after the first tick
          to see status.
        </p>
      )}
      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
        Runs every 60s while the dev server is up. Each tick pulls new emails
        from Gmail and processes one batch of 10 pending — comfortably under
        every rate limit.
      </p>
    </div>
  );
}

function StatusCard({
  account,
  totalCount,
  lastReceived,
  pendingCount,
  geminiReady,
}: {
  account: { accountEmail: string; createdAt: Date; lastSyncedAt: Date | null };
  totalCount: number;
  lastReceived: Date | null;
  pendingCount: number;
  geminiReady: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800 dark:bg-green-950 dark:text-green-200">
          Connected
        </span>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {account.accountEmail}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <Row label="Connected since">{formatDateTime(account.createdAt)}</Row>
        <Row label="Last fetched">
          {account.lastSyncedAt ? formatDateTime(account.lastSyncedAt) : "never"}
        </Row>
        <Row label="Stored emails">{totalCount}</Row>
        <Row label="Pending parse">
          {pendingCount}
          {pendingCount > 0 && !geminiReady ? (
            <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
              (needs Gemini key)
            </span>
          ) : null}
        </Row>
        <Row label="Latest received">
          {lastReceived ? formatDateTime(lastReceived) : "—"}
        </Row>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{children}</dd>
    </div>
  );
}

function NotConnectedCard() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        Connect your Gmail
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        We&apos;ll redirect you to Google to grant read-only access to your
        inbox. You can revoke access any time at{" "}
        <a
          href="https://myaccount.google.com/permissions"
          className="underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          myaccount.google.com/permissions
        </a>
        .
      </p>
      <a href="/api/auth/google" className="btn-primary mt-4">
        Connect Gmail
      </a>
    </div>
  );
}

function SetupCard() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        OAuth not configured yet
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Set <code className="font-mono">GOOGLE_CLIENT_ID</code>,{" "}
        <code className="font-mono">GOOGLE_CLIENT_SECRET</code>,{" "}
        <code className="font-mono">GOOGLE_REDIRECT_URI</code>, and{" "}
        <code className="font-mono">TOKEN_ENCRYPTION_KEY</code> in your{" "}
        <code className="font-mono">.env</code>, then restart the dev server.
      </p>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        See the &quot;Connecting Gmail&quot; section of the README for the full
        Google Cloud Console walkthrough.
      </p>
    </div>
  );
}
