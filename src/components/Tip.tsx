"use client";

import { useEffect, useState } from "react";

/**
 * One tip, once, at the moment it's useful — never a tour.
 *
 * Tips wait their turn in ORDER, so at most one is ever on screen: the next
 * appears only after the one before it was dismissed. Each also waits for a
 * number of dashboard visits, since a tip about filtering months means nothing
 * to someone who hasn't seen the months yet.
 *
 * Everything lives in this browser's storage. Losing it (private window,
 * cleared data) only means a tip may be shown again, which is harmless.
 */
const ORDER = ["month-bars", "ask", "custom-range"] as const;
export type TipId = (typeof ORDER)[number];

const SEEN_KEY = "paisa.tips.seen";
const VISITS_KEY = "paisa.tips.visits";

let countedThisLoad = false;

function read(): { seen: string[]; visits: number } {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    const visits = Number(localStorage.getItem(VISITS_KEY) ?? "0");
    return { seen: Array.isArray(seen) ? seen : [], visits: Number.isFinite(visits) ? visits : 0 };
  } catch {
    return { seen: [], visits: 0 };
  }
}

/** Counts a dashboard visit — once per page load, however many tips mount. */
function countVisit(): number {
  const { visits } = read();
  if (countedThisLoad) return visits;
  countedThisLoad = true;
  try {
    localStorage.setItem(VISITS_KEY, String(visits + 1));
  } catch {}
  return visits + 1;
}

export function Tip({
  id,
  afterVisits,
  children,
  className = "",
}: {
  id: TipId;
  /** Shown from this dashboard visit on (1 = the first). */
  afterVisits: number;
  children: React.ReactNode;
  className?: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const visits = countVisit();
    const { seen } = read();
    const turn = ORDER.find((t) => !seen.includes(t));
    // Reading storage can only happen after mount; this is that sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(turn === id && visits >= afterVisits);
  }, [id, afterVisits]);

  function dismiss() {
    setShow(false);
    const { seen } = read();
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen, id])]));
    } catch {}
  }

  if (!show) return null;
  return (
    <div
      role="note"
      className={
        "tip-in flex items-start justify-between gap-3 rounded-xl bg-blue-600 px-3 py-2.5 text-xs leading-relaxed text-white shadow-[0_10px_30px_-12px_rgba(37,99,235,0.9)] " +
        className
      }
    >
      <span className="min-w-0">{children}</span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-md bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30"
      >
        Got it
      </button>
    </div>
  );
}
