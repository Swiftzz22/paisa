/**
 * Next.js startup hook. Runs once when the server boots — used to kick off
 * the in-process background sync (fetches new bank emails + processes them
 * into expenses on a 60-second cadence).
 *
 * Guarded to only run in the Node.js runtime (not Edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackgroundSync } = await import("@/lib/background");
  startBackgroundSync();
}
