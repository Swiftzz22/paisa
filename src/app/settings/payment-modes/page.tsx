import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { getAllPaymentModes } from "@/lib/payment-modes";
import {
  addPaymentModeAction,
  archivePaymentModeAction,
  unarchivePaymentModeAction,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PaymentModesSettings({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; label?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const modes = await getAllPaymentModes(user.id);

  // Usage counts so the user can see which modes are actually in use.
  const usage = await prisma.transaction.groupBy({
    by: ["paymentMode"],
    where: { userId: user.id },
    _count: { _all: true },
  });
  const usageByValue = new Map<string, number>(
    usage.map((u) => [u.paymentMode, u._count._all])
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
          Payment modes
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Methods that show up in the &quot;Paid via&quot; dropdown. Add your
          own (Wallet, Gift card, BNPL, etc.). Built-in modes (UPI, Card, Cash,
          Bank transfer) can be archived but not deleted.
        </p>
      </header>

      {params.status === "added" ? (
        <Banner kind="ok">Added "{params.label}".</Banner>
      ) : null}
      {params.status === "archived" ? (
        <Banner kind="ok">Payment mode archived.</Banner>
      ) : null}
      {params.status === "err" ? (
        <Banner kind="err">{params.error ?? "Something went wrong."}</Banner>
      ) : null}

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Add payment mode
        </h2>
        <form action={addPaymentModeAction} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col min-w-[180px]">
            <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Label
            </span>
            <input
              name="label"
              type="text"
              required
              maxLength={32}
              className="input"
              placeholder="e.g. Wallet, Gift card"
            />
          </label>
          <button type="submit" className="btn-primary">
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {modes.map((m) => {
            const used = usageByValue.get(m.value) ?? 0;
            return (
              <li
                key={m.id}
                className={
                  "flex items-center justify-between gap-3 px-4 py-3 text-sm " +
                  (m.archived ? "opacity-60" : "")
                }
              >
                <div>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {m.label}
                  </span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {used} tx{used === 1 ? "" : "s"}
                  </span>
                  {m.builtin ? (
                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                      built-in
                    </span>
                  ) : null}
                  {m.archived ? (
                    <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      archived
                    </span>
                  ) : null}
                </div>
                <ArchiveToggle id={m.id} archived={m.archived} builtin={m.builtin} />
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function ArchiveToggle({
  id,
  archived,
  builtin,
}: {
  id: string;
  archived: boolean;
  builtin: boolean;
}) {
  // Built-in modes can still be archived (hidden from new transactions).
  const action = archived ? unarchivePaymentModeAction : archivePaymentModeAction;
  if (builtin && !archived) {
    return (
      <form action={action.bind(null, id)}>
        <button
          type="submit"
          className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
          title="Hide this built-in mode from the Paid via dropdown."
        >
          Hide
        </button>
      </form>
    );
  }
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
