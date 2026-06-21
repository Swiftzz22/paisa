import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { getContext } from "@/lib/agent/tools";
import { AskChat } from "@/components/AskChat";

export const dynamic = "force-dynamic";

/**
 * Chat-with-your-money page. The agent loop lives in src/lib/agent/loop.ts;
 * the API endpoint at /api/ask runs it; this page just renders the UI and
 * passes through the user's current categories so the empty state can show
 * them at a glance.
 */
export default async function AskPage() {
  const user = await getCurrentUser();
  const ctx = await getContext(user.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4">
        <Link
          href="/"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Ask paisa.
        </h1>
      </header>
      <AskChat categories={ctx.availableCategories} />
    </main>
  );
}
