"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

/**
 * iOS-style segmented time control. The tapped segment highlights immediately
 * (optimistic state) and the whole control dims while the new range loads, so a
 * tap feels instant even though the page re-renders on the server.
 */
export function SegmentedRange({
  activePreset,
  fromInput,
  toInput,
  showPresets = true,
}: {
  activePreset: string;
  fromInput: string;
  toInput: string;
  /** False once the period arrows are shown — two pickers is one too many. */
  showPresets?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const current = optimistic ?? activePreset;

  // Once the navigation lands, drop the optimistic override.
  useEffect(() => {
    setOptimistic(null);
  }, [activePreset]);

  function go(id: string) {
    if (id === current) return;
    setOptimistic(id);
    startTransition(() => router.push(`/?range=${id}`));
  }

  return (
    <div className={showPresets ? "mt-4" : "mt-1.5"}>
      {showPresets ? (
      <div
        className={
          "flex gap-1 rounded-2xl border border-zinc-200/80 bg-zinc-100/70 p-1 transition-opacity dark:border-zinc-800 dark:bg-zinc-900/60 " +
          (pending ? "opacity-60" : "")
        }
      >
        {PRESETS.map((p) => {
          const active = current === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => go(p.id)}
              aria-current={active ? "page" : undefined}
              className={
                "flex-1 rounded-xl py-1.5 text-center text-[13px] font-medium transition-all active:scale-[0.96] " +
                (active
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-400")
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      ) : null}
      <details className="px-1">
        <summary className="cursor-pointer list-none text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          Custom range ›
        </summary>
        <form method="GET" action="/" className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
          <input type="date" name="from" defaultValue={fromInput} className="input" />
          <input type="date" name="to" defaultValue={toInput} className="input" />
          <button type="submit" className="btn-secondary">
            Go
          </button>
        </form>
      </details>
    </div>
  );
}
