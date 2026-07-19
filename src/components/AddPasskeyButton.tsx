"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

/** Register a new passkey for the signed-in account (Settings → Passkeys). */
export function AddPasskeyButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const optRes = await fetch("/api/auth/passkey/register/options", {
        method: "POST",
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error || "Couldn't start.");

      const attestation = await startRegistration({ optionsJSON: options });

      const verRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const data = await verRes.json();
      if (!verRes.ok || !data.verified) {
        throw new Error(data.error || "Couldn't save passkey.");
      }
      setMsg({
        ok: true,
        text: "Passkey added — you can now sign in with your fingerprint or face.",
      });
      router.refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/aborted|not allowed|cancel|timed out/i.test(text)) {
        setMsg(null); // user cancelled
      } else {
        setMsg({ ok: false, text });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="btn-primary disabled:opacity-60"
      >
        {busy ? "…" : "+ Add a passkey"}
      </button>
      {msg ? (
        <p
          className={
            "mt-2 text-sm " +
            (msg.ok
              ? "text-green-700 dark:text-green-400"
              : "text-red-600 dark:text-red-400")
          }
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
