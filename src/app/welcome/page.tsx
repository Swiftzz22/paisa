import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * First-run onboarding.
 *
 * New users land here from the login callback, and it stays reachable from
 * Settings afterwards — a first run that vanishes the moment you navigate away
 * is no use to someone who got interrupted.
 *
 * The checklist reads live state rather than being decorative, and the first
 * step is already ticked. Starting at "1 of 4 done" rather than zero is a small
 * thing that measurably changes whether people finish: the account really is
 * set up, so saying so is honest as well as encouraging.
 */
export default async function WelcomePage() {
  const user = await getCurrentUser();
  const firstName = user.name?.split(" ")[0] ?? null;

  const [inboxCount, txCount, categoryCount, budgetCount] = await Promise.all([
    prisma.emailAccount.count({ where: { userId: user.id } }),
    prisma.transaction.count({ where: { userId: user.id } }),
    prisma.category.count({ where: { userId: user.id } }),
    prisma.budget.count({ where: { userId: user.id } }),
  ]);

  const steps = [
    {
      done: true,
      title: "Account created",
      desc: `Signed in as ${user.email}. Nothing else was shared.`,
      href: null,
      cta: null,
    },
    {
      done: categoryCount > 0,
      title: "Categories ready",
      desc:
        categoryCount > 0
          ? `${categoryCount} categories set up for you. Change them whenever you like.`
          : "Set up automatically the first time you sign in.",
      href: "/settings/categories",
      cta: "Review categories",
    },
    {
      done: txCount > 0,
      title: "Get your transactions in",
      desc:
        txCount > 0
          ? `${txCount.toLocaleString("en-IN")} transactions so far.`
          : "Connect an inbox to have bank alerts read automatically, or upload a statement — no email access needed.",
      href: txCount > 0 ? "/" : "/settings/import",
      cta: txCount > 0 ? "See them" : "Upload a statement",
    },
    {
      done: budgetCount > 0,
      title: "Set a monthly budget",
      desc:
        budgetCount > 0
          ? `${budgetCount} budget${budgetCount === 1 ? "" : "s"} set.`
          : "Optional. Once you have a month of spending, paisa. can warn you before you overshoot.",
      href: "/settings/budgets",
      cta: "Set a budget",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

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
          Your expense tracker for Indian banking. It reads the transaction
          alerts your bank already emails you — or a statement you upload — and
          turns them into a record of your spending.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {doneCount} of {steps.length} done
        </span>
      </div>

      <ol className="space-y-2">
        {steps.map((s) => (
          <li
            key={s.title}
            className={
              "flex items-start gap-3 rounded-2xl border p-4 " +
              (s.done
                ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900/40")
            }
          >
            <span
              aria-hidden
              className={
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                (s.done
                  ? "bg-green-600 text-white"
                  : "border-2 border-dashed border-zinc-300 text-transparent dark:border-zinc-600")
              }
            >
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={
                  "text-sm font-medium " +
                  (s.done
                    ? "text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-500"
                    : "text-zinc-900 dark:text-zinc-50")
                }
              >
                {s.title}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {s.desc}
              </p>
              {s.href && s.cta ? (
                <Link
                  href={s.href}
                  className="mt-2 inline-flex min-h-[36px] items-center rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
                >
                  {s.cta}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Two things worth knowing
        </h2>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          <strong>paisa. only ever reads.</strong> It cannot move money, make a
          payment, or send anything from your inbox. If you connect Gmail, it
          looks only at messages from banks, card issuers and UPI apps.
        </p>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          <strong>It will get some things wrong.</strong> Transactions are read
          by AI, so check anything important against your bank&rsquo;s own
          statement. Correcting a category or a name teaches it — it won&rsquo;t
          make the same mistake twice.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/"
          className="btn-primary flex-1 justify-center sm:flex-none sm:px-6"
        >
          {txCount > 0 ? "Go to my dashboard" : "Skip for now"}
        </Link>
        <Link
          href="/settings/import"
          className="btn-secondary flex-1 justify-center sm:flex-none sm:px-6"
        >
          Upload a statement
        </Link>
      </div>

      <p className="mt-6 text-center text-xs text-zinc-400">
        <Link href="/privacy" className="underline">
          Privacy policy
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className="underline">
          Terms of use
        </Link>
      </p>
    </main>
  );
}
