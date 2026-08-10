import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { logoutAction } from "@/lib/auth/actions";

export const dynamic = "force-dynamic";

const TILES: Array<{
  href: string;
  title: string;
  description: string;
}> = [
  {
    href: "/settings/categories",
    title: "Categories",
    description:
      "Add new spending categories (top-level or sub-categories), archive ones you don't use.",
  },
  {
    href: "/settings/payment-modes",
    title: "Payment modes",
    description:
      "UPI, Card, Cash, Bank transfer — plus any new modes you want to track (Wallet, Gift card, etc.).",
  },
  {
    href: "/settings/budgets",
    title: "Monthly budgets",
    description:
      "Set soft monthly caps per category (food, transport, subs…). The home page shows progress bars and warns at 80%.",
  },
  {
    href: "/settings/email",
    title: "Email connection",
    description:
      "Connect Gmail, run background sync, upload bank statements (HDFC .xls, HSBC .pdf).",
  },
  {
    href: "/settings/passkeys",
    title: "Passkeys",
    description:
      "Sign in with your fingerprint or face — no password. Add a passkey per device; Google login still works.",
  },
  {
    href: "/settings/mobile",
    title: "Mobile app",
    description:
      "Connect the native paisa app on your phone. Generate an access token and paste it into the app.",
  },
  {
    href: "/rules",
    title: "Categorization rules",
    description:
      "Saved rules that auto-categorize matching merchants. Created from the transaction edit screen.",
  },
];

export default async function SettingsIndex() {
  const user = await getCurrentUser();

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
          Settings
        </h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="block rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {t.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {t.description}
            </p>
          </Link>
        ))}
      </div>

      <section className="mt-6 flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Signed in as
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {user.name ? `${user.name} · ` : ""}
            {user.email}
          </div>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
