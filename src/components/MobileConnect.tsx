"use client";

import { useState, useTransition } from "react";
import { createMobileTokenAction } from "@/lib/mobile-actions";

/** Generates a mobile access token and lets the user copy it into the app. */
export function MobileConnect() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function generate() {
    setCopied(false);
    start(async () => {
      const res = await createMobileTokenAction();
      setToken(res.token);
    });
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — user can select manually
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        className="btn-primary disabled:opacity-60"
      >
        {pending ? "Generating…" : token ? "Generate a new token" : "Generate token"}
      </button>

      {token ? (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {token}
            </code>
            <button type="button" onClick={copy} className="btn-secondary shrink-0">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Paste this into the paisa app on your phone. Treat it like a password
            — anyone with it can read your data. Generating a new one keeps the
            old one working until you revoke it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
