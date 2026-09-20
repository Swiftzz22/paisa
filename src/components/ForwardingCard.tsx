import Link from "next/link";
import { ForwardingAddress } from "@/components/ForwardingAddress";


/**
 * Forwarding: the way in that doesn't involve Google.
 *
 * Shown whether or not Gmail is connected, because it is an alternative to it
 * rather than a step after it — and because the "Google hasn't verified this
 * app" screen sends people looking for exactly this.
 */
export function ForwardingCard({ address }: { address: string | null }) {
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
          <p className="mt-3 text-xs uppercase tracking-wide text-zinc-500">
            Your private address
          </p>
          <div className="mt-1">
            <ForwardingAddress address={address} />
          </div>

          <div className="mt-4 rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900/60">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">
              Setting it up in Gmail
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-zinc-600 dark:text-zinc-400">
              <li>
                Gmail → Settings → <strong>Forwarding and POP/IMAP</strong> →
                Add a forwarding address → paste the address above.
              </li>
              <li>
                Gmail sends a confirmation code there. It arrives in{" "}
                <Link href="/inbox" className="underline">
                  your inbox here
                </Link>{" "}
                — open it and click the link, or paste the code back into Gmail.
              </li>
              <li>
                Then Settings → <strong>Filters</strong>{" "}
                → Create a new filter,
                put your bank&rsquo;s sender address in <em>From</em>, and
                choose <strong>Forward it to</strong> this address.
              </li>
            </ol>
            <p className="mt-2 text-xs text-zinc-500">
              Keep the filter narrow. Anything forwarded that doesn&rsquo;t look
              like a bank alert is discarded on arrival rather than stored, but
              a filter aimed at your whole inbox still sends far more mail than
              it needs to.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

