import Link from "next/link";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/**
 * First-run onboarding. New users are redirected here from the login callback
 * (isNew === true). Returning users never see it. It just points them at the
 * three ways to get transactions in — nothing is required.
 */
export default async function WelcomePage() {
  const user = await getCurrentUser();
  const firstName = user.name?.split(" ")[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-8 text-center">
        <div className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          paisa<span className="text-zinc-400 dark:text-zinc-500">.</span>
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          Welcome{firstName ? `, ${firstName}` : ""} 👋
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
          Your personal expense tracker for Indian banking. Here are three ways
          to get your transactions in — pick whatever&apos;s easiest.
        </p>
      </div>

      <div className="space-y-3">
        <OnboardCard
          href="/settings/email"
          emoji="📧"
          title="Connect Gmail (recommended)"
          desc="Auto-import UPI, card & bank transactions from your bank alert emails. Set it once and it keeps running in the background."
        />
        <OnboardCard
          href="/settings/email"
          emoji="📄"
          title="Import a statement"
          desc="Upload a bank or credit-card statement — PDF, Excel, or CSV. AI reads it and pulls out every transaction, skipping duplicates."
        />
        <OnboardCard
          href="/transactions/new"
          emoji="✍️"
          title="Add a transaction by hand"
          desc="Just want to log a cash expense or two? Add them manually — takes a few seconds."
        />
      </div>

      <div className="mt-8 text-center">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Skip for now — go to my dashboard →
        </Link>
      </div>

      <p className="mx-auto mt-8 max-w-md text-center text-xs text-zinc-500">
        You can set budgets, add categories, and manage payment methods anytime
        from <span className="font-medium">Settings</span>.
      </p>
    </main>
  );
}

function OnboardCard({
  href,
  emoji,
  title,
  desc,
}: {
  href: string;
  emoji: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
    >
      <span className="text-2xl" aria-hidden>
        {emoji}
      </span>
      <div className="min-w-0">
        <div className="font-medium text-zinc-900 dark:text-zinc-50">
          {title}
        </div>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{desc}</p>
      </div>
      <span className="ml-auto self-center text-zinc-400" aria-hidden>
        →
      </span>
    </Link>
  );
}
