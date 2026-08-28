/**
 * Loading skeletons shared by the route-level loading files.
 *
 * A dynamic route with no loading file is the slowest kind of navigation
 * Next.js has: prefetching is skipped entirely and the tap blocks on the
 * server with nothing on screen to show it registered. Every destination
 * reachable in one tap from the bottom bar has one of these now.
 */

function Line({ w, h = "h-3.5" }: { w: string; h?: string }) {
  return (
    <div
      className={`${h} ${w} animate-pulse rounded bg-zinc-200 dark:bg-zinc-800`}
    />
  );
}

/** Page heading: a back link and a title. */
export function HeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Line w="w-16" h="h-3" />
      <Line w="w-40" h="h-7" />
    </div>
  );
}

/** A list of rows with an icon, two lines of text, and a trailing figure. */
export function RowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-1.5">
            <Line w="w-2/5" />
            <Line w="w-1/4" h="h-2.5" />
          </div>
          <Line w="w-16" />
        </div>
      ))}
    </div>
  );
}

/** A grid of tappable cards, as on the settings index. */
export function CardsSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900"
        />
      ))}
    </div>
  );
}

/** Wrapper matching the standard page shell, plus a screen-reader status. */
export function PageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <HeaderSkeleton />
      {children}
      <span className="sr-only" role="status">
        Loading…
      </span>
    </main>
  );
}
