// Shown during navigations to routes without their own loading UI — above all
// the dashboard, whenever you tap a range tab, a month bar, or a category.
//
// This used to be a centred spinner, which blanked the entire screen on every
// tap: the layout vanished and came back, so a fast navigation still read as a
// jarring one. A skeleton in the shape of the page keeps the furniture in
// place, so the eye only waits for the numbers.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-lg sm:pt-6">
      {/* Header: greeting + avatar */}
      <div className="mb-4 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-5 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="h-9 w-9 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
      </div>

      {/* Hero: total + month bars */}
      <section className="rounded-3xl border border-zinc-200/60 bg-white p-5 dark:border-zinc-800/70 dark:bg-zinc-900">
        <div className="h-3 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-9 w-44 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-4 flex items-end gap-1.5">
          {[16, 28, 40, 22, 12, 30].map((h, i) => (
            <div key={i} className="flex flex-1 flex-col gap-1">
              <div
                className="w-full animate-pulse rounded-t-md bg-zinc-200 dark:bg-zinc-700"
                style={{ height: `${h}px` }}
              />
              <div className="h-2 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </section>

      {/* Range control */}
      <div className="mt-3 h-11 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />

      {/* Two stat tiles */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>

      {/* Transaction rows */}
      <div className="mt-5 space-y-3">
        <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-2/5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
            <div className="h-3.5 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>

      <span className="sr-only" role="status">
        Loading…
      </span>
    </main>
  );
}
