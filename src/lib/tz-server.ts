import "server-only";
import { cookies } from "next/headers";
import { TZ_COOKIE, clampTzOffset } from "@/lib/time";

/**
 * The viewer's UTC offset for the current web request.
 *
 * Kept apart from lib/time.ts so that file stays free of `server-only` and
 * `next/headers` — its date maths is also used from modules that are not
 * request-scoped.
 *
 * The value comes from a cookie written by TimezoneSync, since a server
 * component cannot otherwise discover the browser's timezone. Missing means
 * UTC, which is what the app did before any of this existed.
 */
export async function getTzOffset(): Promise<number> {
  try {
    const jar = await cookies();
    return clampTzOffset(jar.get(TZ_COOKIE)?.value);
  } catch {
    // Outside a request scope (scripts, background jobs) — assume UTC.
    return 0;
  }
}
