import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { deleteRuleAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const user = await getCurrentUser();

  const rules = await prisma.categorizationRule.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      category: {
        include: { parent: true },
      },
    },
  });

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
          Categorization rules
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          When emails or future entries match one of these, the category is
          applied automatically.
        </p>
      </header>

      {rules.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {rules.map((rule) => {
            const cat = rule.category;
            const categoryLabel = cat.parent
              ? `${cat.parent.name} › ${cat.name}`
              : cat.name;
            const matcherLabel = matcherToHuman(rule.matcherType, rule.matcherValue);

            return (
              <li key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-zinc-900 dark:text-zinc-50">
                    {matcherLabel}{" "}
                    <span className="text-zinc-400">→</span>{" "}
                    <span className="font-medium">{categoryLabel}</span>
                  </div>
                </div>
                <form action={deleteRuleAction.bind(null, rule.id)}>
                  <button type="submit" className="btn-danger text-xs px-3 py-1.5">
                    Delete
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function matcherToHuman(type: string, value: string): string {
  if (type === "merchant") {
    return `Merchant contains "${value}"`;
  }
  if (type === "email_from") {
    return `Email from "${value}"`;
  }
  return `${type}: "${value}"`;
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-950">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No rules yet. Check &quot;Remember this categorization&quot; when adding
        or editing an expense to create one.
      </p>
    </div>
  );
}
