"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated integer counter. Counts from 0 → `value` over `duration` ms using
 * an ease-out-cubic curve. Reruns only when `value` changes. SSR-safe — first
 * paint shows the target value so the layout doesn't pop.
 */
export function AnimatedNumber({
  value,
  duration = 900,
}: {
  value: number;
  duration?: number;
}) {
  const [display, setDisplay] = useState<number>(value);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Skip if the user prefers reduced motion.
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplay(value);
      return;
    }

    // On first mount, start from 0 so the count-up is visible.
    const start = mountedRef.current ? display : 0;
    mountedRef.current = true;

    let raf = 0;
    const t0 = performance.now();
    const delta = value - start;

    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(start + delta * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <>
      {Math.round(display).toLocaleString("en-IN")}
    </>
  );
}
