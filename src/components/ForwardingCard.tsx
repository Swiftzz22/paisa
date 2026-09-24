import { ForwardingAddress } from "@/components/ForwardingAddress";
import { CopyButton } from "@/components/CopyButton";
import { formatDateTime } from "@/lib/format";
import type { ForwardingStatus } from "@/lib/email/inbound";

/**
 * Forwarding: the way in that doesn't involve Google.
 *
 * Shown whether or not Gmail is connected, because it is an alternative to it
 * rather than a step after it — and because the "Google hasn't verified this
 * app" screen sends people looking for exactly this.
 *
 * The three things that make or break setup are here rather than in a help
 * page: the code Gmail is waiting for, the filter to paste, and whether any
 * mail has actually arrived. Each one was, at some point, something only a
 * database query could answer.
 */
export function ForwardingCard({
  address,
  filter,
  status,
}: {
  address: string | null;
  filter: string;
  status: ForwardingStatus;
}) {
  return (
    <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Forward alerts instead
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        You can send bank alerts to paisa. yourself, without connecting Gmail at
        all. paisa. then never holds access to your mailbox — it only ever sees
        the mail you forward to it.
      </p>

      {!address ? (
        <p className="mt-3 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700">
          Not available yet — no inbound mail domain is configured on the
          server.
        </p>
      ) : (
        <>
          {/* Gmail will not forward anywhere until this code is entered, and
              it is the step people give up at: the mail carrying it lands in
              paisa. rather than their own inbox, so the obvious place to look
              is the wrong one. */}
          {status.pendingCode ? (
            <div className="mt-3 rounded-md border border-blue-300 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/50">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                Gmail is waiting for this code
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded bg-white px-3 py-1.5 font-mono text-lg tracking-wider text-blue-900 dark:bg-blue-950 dark:text-blue-100">
                  {status.pendingCode}
                </code>
                <CopyButton value={status.pendingCode} />
              </div>
              <p className="mt-2 text-xs text-blue-800 dark:text-blue-300">
                Paste it into Gmail → Settings → Forwarding and POP/IMAP, next
                to the address you just added, and press Verify.
              </p>
            </div>
          ) : null}

          <p className="mt-4 text-xs uppercase tracking-wide text-zinc-500">
            Step 1 · Your private address
          </p>
          <div className="mt-1">
            <ForwardingAddress address={address} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            In Gmail: Settings → <strong>Forwarding and POP/IMAP</strong> → Add
            a forwarding address → paste this. The code Gmail sends will appear
            up here.
          </p>

          <p className="mt-5 text-xs uppercase tracking-wide text-zinc-500">
            Step 2 · The filter
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste this into Gmail&rsquo;s <strong>search box</strong>, press
            Enter, then use the filter icon at the right of the box →{" "}
            <strong>Forward it to</strong> → your address above.
          </p>
          <div className="mt-2 flex items-start gap-2">
            <code className="max-h-24 flex-1 overflow-y-auto break-all rounded-md bg-zinc-100 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {filter}
            </code>
            <CopyButton value={filter} label="Copy filter" />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            It matches every Indian bank, card issuer, UPI app and wallet
            paisa. can read, and excludes the addresses banks send marketing
            from. It is generated from the same list the parser uses, so it
            stays right as more are added.
          </p>

          <p className="mt-5 text-xs uppercase tracking-wide text-zinc-500">
            Step 3 · Is it working
          </p>
          <div className="mt-1 rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900/60">
            {status.lastReceivedAt ? (
              <p className="text-zinc-700 dark:text-zinc-300">
                Last alert received{" "}
                <strong>{formatDateTime(status.lastReceivedAt)}</strong>
                {status.recentCount > 0 ? (
                  <>
                    {" "}
                    · {status.recentCount} in the last 7 days
                  </>
                ) : null}
              </p>
            ) : (
              <p className="text-zinc-600 dark:text-zinc-400">
                No forwarded mail yet. Alerts only arrive after the filter is
                created — it never forwards mail you already had. Make a card
                payment and one should land within a minute or two.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
