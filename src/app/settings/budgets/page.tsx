import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { getCategoryOptions } from "@/lib/categories";
import { getBudgetProgress } from "@/lib/budgets";
import { getTzOffset } from "@/lib/tz-server";
import { formatINR } from "@/lib/format";
import {
  upsertBudgetAction,
  deleteBudgetAction,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function BudgetsSettings({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const tzOffset = await getTzOffset();

  const [categories, summary] = await Promise.all([
    getCategoryOptions(user.id),
    getBudgetProgress(user.id, new Date(), tzOffset),
  ]);

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
          Monthly budgets
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Soft monthly spending caps per category. The home page will show
          progress bars and warn when you cross 80%. Budgets are not
          enforced — they're just visibility.
        </p>
      </header>

      {params.status === "saved" ? (
        <Banner kind="ok">Budget saved.</Banner>
      ) : null}
      {params.status === "deleted" ? (
        <Banner kind="ok">Budget removed.</Banner>
      ) : null}
      {params.status === "err" ? (
        <Banner kind="err">{params.error ?? "Something went wrong."}</Banner>
      ) : null}

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Add or update a budget
        </h2>
        <form
          action={upsertBudgetAction}
          className="grid gap-3 sm:grid-cols-[1fr_140px_auto]"
        >
          <label className="flex flex-col">
            <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Category
            </span>
            <select name="categoryId" required defaultValue="" className="input">
              <option value="" disabled>
                Select…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Monthly cap (₹)
            </span>
            <input
              name="amountInr"
              type="number"
              min="1"
              step="1"
              required
              className="input"
              placeholder="3000"
              inputMode="decimal"
            />
          </label>
          <button type="submit" className="btn-primary self-end">
            Save
          </button>
        </form>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Setting a budget on a parent (e.g. <em>Food</em>) tracks spend across
          all its children. Setting on a leaf (e.g. <em>Food › Coffee</em>)
          tracks only that one.
        </p>
      </section>

      {summary.progress.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No budgets yet. Pick a category and a monthly cap above to add your
            first one.
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Progress for {summary.monthLabel} · Day {summary.daysElapsed} of{" "}
            {summary.daysInMonth}
          </p>
          {summary.progress.map((p) => (
            <BudgetRow key={p.budgetId} p={p} />
          ))}
        </section>
      )}
    </main>
  );
}

function BudgetRow({
  p,
}: {
  p: {
    budgetId: string;
    categoryId: string;
    label: string;
    icon: string | null;
    spent: number;
    cap: number;
    percent: number;
  };
}) {
  const pct = Math.min(p.percent, 1.2);
  const barColor =
    p.percent >= 1
      ? "bg-red-500"
      : p.percent >= 0.8
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">
          {p.icon ? <span className="mr-1">{p.icon}</span> : null}
          {p.label}
        </span>
        <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
          <strong className="text-zinc-900 dark:text-zinc-50">
            {formatINR(p.spent)}
          </strong>{" "}
          / {formatINR(p.cap)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{Math.round(p.percent * 100)}% used</span>
        <form action={deleteBudgetAction.bind(null, p.budgetId)}>
          <button
            type="submit"
            className="text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Remove
          </button>
        </form>
      </div>
    </div>
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
