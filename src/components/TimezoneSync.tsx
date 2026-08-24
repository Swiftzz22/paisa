"use client";

import { useEffect } from "react";

/**
 * Publishes the browser's UTC offset as a cookie so server components can build
 * date ranges in the viewer's timezone.
 *
 * Server rendering happens on Vercel, which runs in UTC, so without this a
 * viewer in IST sees months and days that start at 05:30 their time. There is
 * no way for a server component to learn the timezone on its own — the browser
 * has to tell it, and a cookie is the only channel available before the first
 * render of the *next* navigation.
 *
 * A first visit therefore still renders in UTC; the cookie takes effect from
 * the following request, and we refresh once immediately after setting it so
 * the correction is not deferred until the user happens to navigate.
 */
export function TimezoneSync() {
  useEffect(() => {
    const offset = -new Date().getTimezoneOffset();
    const existing = document.cookie
      .split("; ")
      .find((c) => c.startsWith("tz_offset="))
      ?.split("=")[1];

    if (existing === String(offset)) return;

    // Lax so it rides along with normal navigation; a year is fine since a
    // change of zone rewrites it on the next load anyway.
    document.cookie = `tz_offset=${offset}; path=/; max-age=31536000; samesite=lax`;

    // Only reload when correcting a wrong value that was already used to
    // render — on a first visit there is nothing on screen worth re-fetching.
    if (existing !== undefined) window.location.reload();
  }, []);

  return null;
}
