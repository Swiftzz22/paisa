import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isLoginConfigured } from "@/lib/auth/google-login";
import { PasskeyLoginButton } from "@/components/PasskeyLoginButton";
import { NightBackground } from "@/components/NightBackground";
import { AlertDemo } from "@/components/AlertDemo";

export const dynamic = "force-dynamic";

/**
 * The signed-out front door, and so also the landing page: `/` sends anyone
 * without a session here, which makes this the first thing a visitor from the
 * App Store listing or a shared link ever sees. It shows what paisa. does (the
 * alert-to-transaction demo) beside the way in, instead of asking for a Google
 * sign-in before saying what it is for.
 */
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
    <main className="night flex flex-col">
      <NightBackground />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <span className="text-xl font-bold tracking-tight">
          paisa<span className="text-[var(--nl-blue)]">.</span>
        </span>
        <nav className="flex items-center gap-5 text-sm text-[var(--nl-muted)]">
          <a
            href="#how"
            className="hidden hover:text-[var(--nl-ink)] sm:inline"
          >
            How it works
          </a>
          <a href="/privacy" className="hover:text-[var(--nl-ink)]">
            Privacy
          </a>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-24">
        <div>
          <h1 className="text-balance text-4xl font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
            Your bank already tells you.{" "}
            <span className="night-gradient-text">
              paisa. keeps the ledger.
            </span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-[var(--nl-muted)] sm:text-lg">
            Every UPI, card and bank alert in your inbox becomes a sorted record
            of your spending. Read-only, and nothing to type.
          </p>

          <div className="mt-8 w-full max-w-sm">
            {error ? (
              <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {/* Google's "dark" sign-in button style: their branding rules
                allow light, dark or neutral only, and dark suits the navy.
                The blue glow behind it is ours. */}
            {configured ? (
              <a
                href="/api/auth/login"
                className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-xl border border-[#8e918f] bg-[#131314] px-4 py-3 text-sm font-medium text-[#e3e3e3] shadow-[0_10px_30px_-12px_rgba(59,130,246,0.8)] transition-colors hover:bg-[#1c1d1f] active:scale-[0.99]"
              >
                <GoogleGlyph />
                Continue with Google
              </a>
            ) : (
              <div className="night-card border-dashed p-4 text-sm text-[var(--nl-muted)]">
                Login isn&apos;t configured yet. Set{" "}
                <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code>,{" "}
                <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code>,
                and{" "}
                <code className="font-mono text-xs">
                  GOOGLE_LOGIN_REDIRECT_URI
                </code>{" "}
                in <code className="font-mono text-xs">.env</code>, then
                restart.
              </div>
            )}

            {/* Passkey sign-in — works once you've added one under Settings →
                Passkeys (after signing in with Google the first time). */}
            <div className="mt-3">
              <PasskeyLoginButton />
            </div>

            {/* Second way in, for anyone who doesn't want to hand over inbox
                access. It still signs in first (the file needs an account to
                attach to) but lands them straight on the importer afterwards
                instead of on a dashboard with nothing in it. */}
            {configured ? (
              <a
                href="/api/auth/login?next=%2Fsettings%2Fimport"
                className="mt-4 block text-sm text-[var(--nl-muted)] underline decoration-[var(--nl-edge)] underline-offset-4 hover:text-[var(--nl-ink)]"
              >
                Rather not connect email? Upload a bank statement instead.
              </a>
            ) : null}

            <p className="mt-6 text-xs leading-relaxed text-[var(--nl-muted)]">
              Signing in reads only your name and email. Connecting Gmail is a
              separate, optional step inside the app. By continuing you agree to
              the{" "}
              <a href="/terms" className="underline">
                Terms of Use
              </a>{" "}
              and{" "}
              <a href="/privacy" className="underline">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>

        <AlertDemo />
      </section>

      <section
        id="how"
        className="mx-auto w-full max-w-6xl scroll-mt-8 px-5 pb-16 sm:px-8"
      >
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--nl-muted)]">
          How it works
        </h2>
        {/* A real sequence, so the numbers carry information. */}
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="night-card p-5">
              <span className="font-mono text-xs text-[var(--nl-hi)]">
                {i + 1}
              </span>
              <p className="mt-2 font-semibold">{s.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--nl-muted)]">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
        <div className="night-card grid gap-6 p-6 sm:grid-cols-2 sm:p-8">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              It only ever reads.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--nl-muted)]">
              paisa. cannot move money, make a payment or send anything from
              your inbox. If you connect Gmail, it looks only at messages from
              banks, card issuers and UPI apps.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Your data stays yours.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--nl-muted)]">
              Disconnect your inbox or delete everything from Settings whenever
              you like. Transactions are read by AI, so check anything important
              against your bank&rsquo;s own statement.
            </p>
          </div>
        </div>
      </section>

      <footer className="mx-auto mt-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-xs text-[var(--nl-muted)] sm:px-8">
        <span>Made in India, for Indian banking.</span>
        <span className="flex gap-4">
          <a href="/privacy" className="hover:text-[var(--nl-ink)]">
            Privacy
          </a>
          <a href="/terms" className="hover:text-[var(--nl-ink)]">
            Terms
          </a>
          <a href="/support" className="hover:text-[var(--nl-ink)]">
            Support
          </a>
        </span>
      </footer>
    </main>
  );
}

const STEPS = [
  {
    title: "Sign in",
    body: "With Google or a passkey. paisa. sees only your name and email.",
  },
  {
    title: "Connect your inbox, or upload a statement",
    body: "Bank, card and UPI alerts are picked up as they arrive. A CSV, Excel or PDF statement works too.",
  },
  {
    title: "Watch it sort itself",
    body: "Each payment lands in a category. Fix one and it remembers that shop next time.",
  },
];

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
