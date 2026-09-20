"use client";

import { useState, useTransition } from "react";
import { rotateForwardingAddressAction } from "@/lib/mobile-actions";

/**
 * Shows this account's private forwarding address, and lets it be replaced.
 *
 * The address is the whole feature: anyone who can post mail to it can write
 * to this ledger, so it is treated like a credential — easy to copy exactly,
 * and easy to revoke without touching the account it belongs to.
 */
export function ForwardingAddress({ address }: { address: string }) {
  const [current, setCurrent] = useState(address);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the address is on screen to select by hand.
    }
  }

  function rotate() {
    setConfirming(false);
    setCopied(false);
    start(async () => {
      const res = await rotateForwardingAddressAction();
      if (res.address) setCurrent(res.address);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 break-all rounded-md bg-zinc-100 px-3 py-2 font-mono text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
          {current}
        </code>
        <button type="button" onClick={copy} className="btn-secondary">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {confirming ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-amber-900 dark:text-amber-200">
            The old address stops working immediately. Any filter still pointing
            at it will silently stop delivering, so update your forwarding rule
            straight afterwards.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={rotate}
              disabled={pending}
              className="btn-primary disabled:opacity-60"
            >
              {pending ? "Replacing…" : "Replace it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn-secondary"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Replace this address
        </button>
      )}
    </div>
  );
}
