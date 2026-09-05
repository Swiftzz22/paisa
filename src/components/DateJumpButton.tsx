"use client";

/**
 * A calendar button that jumps the dashboard to whichever date you choose.
 *
 * The date input *is* the button: it sits at full size on top of the calendar
 * icon at zero opacity, so a tap lands on a real `<input type="date">` and the
 * browser opens its own picker. No showPicker(), no click handler, nothing that
 * depends on hydration having finished — an earlier version called
 * showPicker() from an onClick on a 0x0 input, which needs the API to exist,
 * a live user gesture, and React to have hydrated, and quietly did nothing
 * when any of those was missing.
 *
 * Choosing a date submits the form. That part is JavaScript, so the form also
 * keeps a real submit control for the case where it hasn't loaded.
 */
export function DateJumpButton({ grain }: { grain: string }) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <>
      <input type="hidden" name="grain" value={grain} />
      <label
        htmlFor="jump"
        title="Choose a date"
        className="relative flex h-11 w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-zinc-200 text-lg hover:bg-zinc-500/10 dark:border-zinc-800"
      >
        <span aria-hidden>📅</span>
        <input
          id="jump"
          type="date"
          name="on"
          defaultValue={iso}
          max={iso}
          aria-label="Jump to a date"
          // Covers the whole button so the tap target is the input itself.
          // Opacity rather than visibility/display: a hidden input cannot be
          // clicked, and that was the bug.
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        />
      </label>
      {/* Only visible if the auto-submit above never wires up. */}
      <noscript>
        <button
          type="submit"
          className="ml-2 min-h-[44px] rounded-lg border border-zinc-300 px-3 text-xs font-medium dark:border-zinc-700"
        >
          Go
        </button>
      </noscript>
    </>
  );
}
