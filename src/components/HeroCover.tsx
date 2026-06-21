import Link from "next/link";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { formatINR } from "@/lib/format";

export type HeroTile = {
  label: string;
  value: string;
  href: string;
  /** Tone changes the accent dot colour. */
  tone?: "neutral" | "good" | "warn";
};

export function HeroCover({
  monthLabel,
  monthTotal,
  deltaPct,
  deltaUp,
  hasDelta,
  tiles,
}: {
  monthLabel: string;
  monthTotal: number;
  deltaPct: number;
  deltaUp: boolean;
  hasDelta: boolean;
  tiles: HeroTile[];
}) {
  return (
    <section
      aria-label="This month at a glance"
      className="relative isolate mb-6 overflow-hidden rounded-2xl border border-zinc-200/60 bg-gradient-to-br from-zinc-50 to-white p-5 shadow-sm dark:border-zinc-800/60 dark:from-zinc-950 dark:to-zinc-900 sm:p-7"
    >
      <div className="hero-aurora" aria-hidden />

      <div className="relative">
        <Link
          href="/"
          className="inline-flex items-baseline gap-0.5 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          paisa<span className="text-zinc-400 dark:text-zinc-500">.</span>
        </Link>

        <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          Spent in {monthLabel}
        </p>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span className="text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            ₹<AnimatedNumber value={Math.round(monthTotal)} />
          </span>
          {hasDelta ? (
            <span
              className={
                "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums " +
                (deltaUp
                  ? "bg-red-500/15 text-red-700 dark:text-red-300"
                  : "bg-green-500/15 text-green-700 dark:text-green-300")
              }
              title="Compared to the same span last month"
            >
              {deltaUp ? "↑" : "↓"} {deltaPct}%
            </span>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          {tiles.map((tile) => (
            <HeroTileLink key={tile.label} tile={tile} />
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroTileLink({ tile }: { tile: HeroTile }) {
  const dotCls =
    tile.tone === "good"
      ? "bg-green-500"
      : tile.tone === "warn"
      ? "bg-amber-500"
      : "bg-zinc-400";
  return (
    <Link
      href={tile.href}
      className="group relative flex min-h-[64px] flex-col justify-between rounded-xl border border-zinc-200/70 bg-white/70 px-3 py-2.5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white active:scale-[0.98] dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:hover:border-zinc-700 dark:hover:bg-zinc-950"
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} aria-hidden />
        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {tile.label}
        </span>
      </div>
      <div className="truncate text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50 sm:text-base">
        {tile.value}
      </div>
    </Link>
  );
}

/**
 * Helper for callers — formats a rupee value for tile display, falling back
 * to a placeholder when the number is zero / unset.
 */
export function tileMoney(n: number): string {
  return n > 0 ? formatINR(n) : "—";
}
