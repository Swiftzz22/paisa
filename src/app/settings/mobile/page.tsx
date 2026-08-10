import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { MobileConnect } from "@/components/MobileConnect";

export const dynamic = "force-dynamic";

export default async function MobileSettings() {
  await getCurrentUser();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <Link
          href="/settings"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Back to settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Connect the mobile app
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          The native paisa app signs in with a one-time access token. Generate
          one here, paste it into the app, and it pulls your real data.
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <MobileConnect />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <h2 className="mb-2 font-medium text-zinc-900 dark:text-zinc-50">
          How to connect
        </h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Tap Generate token above and copy it.</li>
          <li>Open the paisa app on your phone.</li>
          <li>Paste the token on the connect screen.</li>
          <li>Your dashboard fills with your real transactions.</li>
        </ol>
      </section>
    </main>
  );
}
