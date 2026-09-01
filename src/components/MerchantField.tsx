"use client";

import { useState } from "react";

/**
 * The merchant input, plus an offer to reuse the new name if it gets changed.
 *
 * The input and the offer live in one client component so the checkbox reacts
 * to the field's own state. An earlier version kept them apart and had the
 * checkbox find the input with getElementById, which never fired reliably —
 * owning the value removes the question entirely.
 *
 * The offer is ticked by default: someone who has just fixed
 * "DEVMAN VENTURES PRIVAT" almost always means everywhere, not only here.
 */
export function MerchantField({ originalName }: { originalName?: string }) {
  const original = (originalName ?? "").trim();
  const [value, setValue] = useState(originalName ?? "");

  const next = value.trim();
  const changed = original.length > 0 && next.length > 0 && next !== original;

  return (
    <>
      <label htmlFor="merchant" className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Merchant / person / description
        </span>
        <input
          id="merchant"
          name="merchant"
          type="text"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input"
          placeholder="Zomato, Joshika Reddy, Auto to college…"
        />
      </label>

      {changed ? (
        <label className="flex items-start gap-2.5 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <input
            id="saveAlias"
            name="saveAlias"
            type="checkbox"
            value="on"
            defaultChecked
            className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-50"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">Use this name everywhere.</span> Your
            bank calls this{" "}
            <span className="break-all font-mono text-xs">{original}</span> —
            rename it here, on the ones already saved, and on anything new that
            arrives under that name.
          </span>
        </label>
      ) : null}
    </>
  );
}
