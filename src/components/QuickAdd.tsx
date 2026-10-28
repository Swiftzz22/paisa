"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseQuickAdd, type QuickAddContext } from "@/lib/quick-add";
import { formatINR } from "@/lib/format";

/**
 * One line instead of a form: "chai 20 cash". What it understood shows as
 * chips as you type. When everything is there, Add saves it; when something
 * is missing, the same button hands what it has to the full form below, with
 * the gap left for the person to fill.
 */
export function QuickAdd({
  action,
  categories,
  paymentModes,
  merchantCategories,
}: {
  action: (form: FormData) => void | Promise<void>;
  categories: QuickAddContext["categories"];
  paymentModes: QuickAddContext["paymentModes"];
  merchantCategories: Record<string, string>;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(
    () =>
      text.trim()
        ? parseQuickAdd(text, { categories, paymentModes, merchantCategories, today: new Date() })
        : null,
    [text, categories, paymentModes, merchantCategories]
  );
  const complete = Boolean(
    parsed?.amount && parsed.merchant && parsed.categoryId && parsed.paymentMode
  );
  const categoryLabel = categories.find((c) => c.id === parsed?.categoryId)?.label ?? null;
  const modeLabel = paymentModes.find((m) => m.value === parsed?.paymentMode)?.label ?? null;
  // en-CA formats as YYYY-MM-DD, the same shape the parser returns.
  const today = new Date().toLocaleDateString("en-CA");
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString("en-CA");
  const dayLabel = (d: string) => (d === today ? "Today" : d === yesterday ? "Yesterday" : d);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    if (!complete) {
      // Hand over what was understood; the form asks for the rest.
      const q = new URLSearchParams();
      if (parsed.amount) q.set("amount", String(parsed.amount));
      if (parsed.merchant) q.set("merchant", parsed.merchant);
      if (parsed.categoryId) q.set("categoryId", parsed.categoryId);
      if (parsed.paymentMode) q.set("paymentMode", parsed.paymentMode);
      if (parsed.withWho) q.set("note", `with ${parsed.withWho}`);
      q.set("date", parsed.date);
      q.set("type", parsed.type);
      router.replace(`/transactions/new?${q}`);
      return;
    }
    const form = new FormData();
    form.set("amount", String(parsed.amount));
    form.set("merchant", parsed.merchant!);
    form.set("categoryId", parsed.categoryId!);
    form.set("paymentMode", parsed.paymentMode!);
    form.set("occurredAt", parsed.date);
    form.set("type", parsed.type);
    if (parsed.withWho) form.set("note", `with ${parsed.withWho}`);
    // The action redirects to the dashboard when it has saved.
    startTransition(() => action(form));
  }

  const chip = (label: string, value: string | null) => (
    <span
      key={label}
      className={
        value
          ? "rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-100"
          : "rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
      }
    >
      <span className="mr-1 opacity-60">{label}</span>
      {value ?? "?"}
    </span>
  );

  return (
    <form
      onSubmit={submit}
      className="mb-8 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <label htmlFor="quick-add" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Quick add
      </label>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Type it like a text: &ldquo;chai 20 cash&rdquo; or &ldquo;uber 186 upi yesterday&rdquo;.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          id="quick-add"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input"
          placeholder="chai 20 cash"
          autoComplete="off"
          autoCapitalize="none"
          enterKeyHint="done"
        />
        <button
          type="submit"
          disabled={!parsed || pending}
          className="btn-primary shrink-0 disabled:opacity-50"
        >
          {pending ? "Adding…" : complete ? "Add" : "Fill in the rest"}
        </button>
      </div>
      {parsed ? (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-live="polite">
          {chip("amount", parsed.amount ? formatINR(parsed.amount) : null)}
          {chip("merchant", parsed.merchant)}
          {chip("category", categoryLabel)}
          {chip("paid by", modeLabel)}
          {chip(parsed.type === "credit" ? "received" : "on", dayLabel(parsed.date))}
          {parsed.withWho ? chip("with", parsed.withWho) : null}
        </div>
      ) : null}
    </form>
  );
}
