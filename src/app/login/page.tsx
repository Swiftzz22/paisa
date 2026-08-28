import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isLoginConfigured } from "@/lib/auth/google-login";
import { PasskeyLoginButton } from "@/components/PasskeyLoginButton";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Already signed in → straight to the dashboard.
  if (await getSessionUser()) redirect("/");

  const { error } = await searchParams;
  const configured = isLoginConfigured();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            paisa<span className="text-zinc-400 dark:text-zinc-500">.</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Your personal expense tracker. Sign in to continue.
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {configured ? (
          <a
            href="/api/auth/login"
            className="flex min-h-[48px] w-full items-center justify-center gap-3 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <GoogleGlyph />
            Sign in with Google
          </a>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            Login isn&apos;t configured yet. Set{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code>,{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code>, and{" "}
            <code className="font-mono text-xs">GOOGLE_LOGIN_REDIRECT_URI</code>{" "}
            in <code className="font-mono text-xs">.env</code>, then restart.
          </div>
        )}

        {/* Passkey sign-in — works once you've added one under Settings →
            Passkeys (after signing in with Google the first time). */}
        <div className="mt-4">
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-wide text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <PasskeyLoginButton />
        </div>

        {/* Second way in, for anyone who doesn't want to hand over inbox
            access. The file itself can only be taken once there's an account to
            attach it to, so this still signs in first — but it says up front
            that importing is possible, and lands them straight on the importer
            afterwards instead of on a dashboard with nothing in it. */}
        {configured ? (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Have a bank statement instead?
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Upload a CSV, Excel, or PDF from any bank and paisa. reads every
              transaction out of it. No inbox access needed.
            </p>
            <a
              href="/api/auth/login?next=%2Fsettings%2Fimport"
              className="mt-3 flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              Sign in &amp; upload a statement
            </a>
          </div>
        ) : null}

        <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          We only read your name and email to identify your account. Connecting
          Gmail for transaction import is a separate, optional step inside the
          app.
        </p>
      </div>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
