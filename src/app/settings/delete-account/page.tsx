import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";
import { deleteAccountAction } from "@/lib/auth/actions";

export const dynamic = "force-dynamic";

/**
 * Permanent account deletion. Apple requires this to exist and to be reachable
 * from inside the app, so the mobile Settings screen deep-links here.
 *
 * Shows the real counts before asking: people should know what they are about
 * to lose, not agree to an abstraction.
 */
export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  const [transactions, emails, categories, emailAccount] = await Promise.all([
    prisma.transaction.count({ where: { userId: user.id } }),
    prisma.receivedEmail.count({ where: { userId: user.id } }),
    prisma.category.count({ where: { userId: user.id } }),
    prisma.emailAccount.findUnique({
      where: { userId: user.id },
      select: { accountEmail: true },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <Link
          href="/settings"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Delete your account
        </h1>
      </header>

      <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm font-medium text-red-800 dark:text-red-200">
          This cannot be undone. There is no backup to restore from.
        </p>
      </div>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          What gets deleted
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="tabular-nums text-zinc-900 dark:text-zinc-50">
              {transactions.toLocaleString("en-IN")}
            </strong>{" "}
            transactions, and every category, budget and rule you have set up
            {categories > 0 ? ` (${categories} categories)` : ""}
          </li>
          <li>
            <strong className="tabular-nums text-zinc-900 dark:text-zinc-50">
              {emails.toLocaleString("en-IN")}
            </strong>{" "}
            stored bank emails, including their original contents
          </li>
          <li>Your sign-in details, passkeys, and every signed-in device</li>
          {emailAccount ? (
            <li>
              paisa.&rsquo;s access to{" "}
              <strong className="text-zinc-900 dark:text-zinc-50">
                {emailAccount.accountEmail}
              </strong>{" "}
              is revoked with Google first, so nothing is left connected
            </li>
          ) : null}
        </ul>
        <p className="mt-3 text-sm text-zinc-500">
          Your actual Gmail is never touched — only paisa.&rsquo;s copy of what it
          read.
        </p>
      </section>

      {params.error === "mismatch" ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          That didn&rsquo;t match the email on this account. Nothing was deleted.
        </p>
      ) : null}

      <form action={deleteAccountAction} className="mt-6">
        <label
          htmlFor="confirmEmail"
          className="block text-sm text-zinc-700 dark:text-zinc-300"
        >
          Type <strong>{user.email}</strong> to confirm
        </label>
        <input
          id="confirmEmail"
          name="confirmEmail"
          type="email"
          autoComplete="off"
          required
          placeholder={user.email}
          className="input mt-2"
        />
        <div className="mt-4 flex gap-3">
          <button type="submit" className="btn-danger">
            Delete my account permanently
          </button>
          <Link href="/settings" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
