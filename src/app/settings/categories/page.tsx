import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import {
  addCategoryAction,
  archiveCategoryAction,
  unarchiveCategoryAction,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function CategoriesSettings({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; name?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  const tops = await prisma.category.findMany({
    where: { userId: user.id, parentId: null },
    include: {
      children: { orderBy: { name: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  const usageCounts = await prisma.expenseLine.groupBy({
    by: ["categoryId"],
    where: { transaction: { userId: user.id } },
    _count: { _all: true },
  });
  const usageMap = new Map<string, number>(
    usageCounts.map((u) => [u.categoryId, u._count._all])
  );

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
          Categories
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Two levels: top-level (e.g. Food) with optional children (e.g.
          Food › Coffee). Archived categories disappear from dropdowns but
          existing transactions keep their labels.
        </p>
      </header>

      {params.status === "added" ? (
        <Banner kind="ok">Added "{params.name}".</Banner>
      ) : null}
      {params.status === "archived" ? (
        <Banner kind="ok">Category archived.</Banner>
      ) : null}
      {params.status === "err" ? (
        <Banner kind="err">{params.error ?? "Something went wrong."}</Banner>
      ) : null}

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Add category
        </h2>
        <form
          action={addCategoryAction}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"
        >
          <label className="flex flex-col">
            <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Name
            </span>
            <input name="name" type="text" required className="input" placeholder="e.g. Pets" />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Parent (optional)
            </span>
            <select name="parentId" defaultValue="" className="input">
              <option value="">— top-level —</option>
              {tops.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Icon (optional)
            </span>
            <input name="icon" type="text" maxLength={2} className="input w-20" placeholder="🐾" />
          </label>
          <button type="submit" className="btn-primary self-end">
            Add
          </button>
        </form>
      </section>

      <section className="space-y-3">
        {tops.map((top) => {
          const topCount = usageMap.get(top.id) ?? 0;
          return (
            <div
              key={top.id}
              className={
                "rounded-lg border bg-white dark:bg-zinc-950 " +
                (top.archived
                  ? "border-zinc-200/60 dark:border-zinc-800/60 opacity-60"
                  : "border-zinc-200 dark:border-zinc-800")
              }
            >
              <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  {top.icon ? <span className="text-base">{top.icon}</span> : null}
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {top.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    · {topCount} tx{topCount === 1 ? "" : "s"}
                  </span>
                  {top.archived ? (
                    <span className="ml-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      archived
                    </span>
                  ) : null}
                </div>
                <ArchiveToggle
                  id={top.id}
                  archived={top.archived}
                />
              </header>
              {top.children.length > 0 ? (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {top.children.map((child) => {
                    const c = usageMap.get(child.id) ?? 0;
                    return (
                      <li
                        key={child.id}
                        className={
                          "flex items-center justify-between gap-3 px-4 py-2 text-sm " +
                          (child.archived ? "opacity-60" : "")
                        }
                      >
                        <div>
                          <span className="text-zinc-700 dark:text-zinc-300">
                            {top.name} › {child.name}
                          </span>
                          <span className="ml-1 text-xs text-zinc-500">
                            · {c} tx{c === 1 ? "" : "s"}
                          </span>
                          {child.archived ? (
                            <span className="ml-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                              archived
                            </span>
                          ) : null}
                        </div>
                        <ArchiveToggle
                          id={child.id}
                          archived={child.archived}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </section>
    </main>
  );
}

function ArchiveToggle({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const action = archived ? unarchiveCategoryAction : archiveCategoryAction;
  return (
    <form action={action.bind(null, id)}>
      <button
        type="submit"
        className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
      >
        {archived ? "Restore" : "Archive"}
      </button>
    </form>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "ok" | "err";
  children: React.ReactNode;
}) {
  const cls =
    kind === "ok"
      ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200";
  return (
    <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}
