"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";

/** "Sign in with a passkey" — usernameless WebAuthn login (fingerprint/face). */
export function PasskeyLoginButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/auth/passkey/auth/options", {
        method: "POST",
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error || "Couldn't start sign-in.");

      const assertion = await startAuthentication({ optionsJSON: options });

      const verRes = await fetch("/api/auth/passkey/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const data = await verRes.json();
      if (!verRes.ok || !data.verified) {
        throw new Error(data.error || "Sign-in failed.");
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // User cancelled / no passkey available — don't shout about it.
      if (!/aborted|not allowed|cancel|no available|timed out/i.test(msg)) {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="btn-secondary w-full disabled:opacity-60"
      >
        {busy ? "…" : "🔑 Sign in with a passkey"}
      </button>
      {error ? (
        <p className="mt-2 text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
