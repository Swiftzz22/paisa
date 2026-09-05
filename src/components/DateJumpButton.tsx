"use client";

import { useRef } from "react";

/**
 * A calendar button that jumps the dashboard to whichever date you choose.
 *
 * The date input is real but visually collapsed to nothing: an exposed
 * `<input type="date">` renders a raw "01-01-2026" and needed a separate Go
 * button beside it, which read as a form to fill in rather than a control to
 * press. The button opens the browser's own calendar and the choice applies
 * immediately.
 *
 * Defaults to today every time it opens, so the calendar always starts from
 * the present rather than from wherever you happen to have navigated to.
 */
export function DateJumpButton({ grain }: { grain: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function open() {
    const el = inputRef.current;
    if (!el) return;
    // showPicker is the only way to open the calendar without the user hitting
    // the input's own tiny icon. Not everywhere yet, so fall back to focusing
    // the field, which opens it on most mobile browsers.
    try {
      (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      el.focus();
    }
  }

  return (
    <>
      <input type="hidden" name="grain" value={grain} />
      <input
        ref={inputRef}
        id="jump"
        type="date"
        name="on"
        defaultValue={iso}
        max={iso}
        aria-label="Jump to a date"
        // Kept in the layout (not display:none) so it stays focusable and the
        // native picker has something to anchor to, but takes no space.
        className="absolute h-0 w-0 opacity-0"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      <button
        type="button"
        onClick={open}
        aria-label="Choose a date"
        title="Choose a date"
        className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-zinc-200 text-lg text-zinc-500 hover:bg-zinc-500/10 dark:border-zinc-800 dark:text-zinc-400"
      >
        📅
      </button>
    </>
  );
}
