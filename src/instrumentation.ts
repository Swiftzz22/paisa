/**
 * Next.js startup hook. Runs once when the server boots — used to kick off
 * the in-process background sync (fetches new bank emails + processes them
 * into expenses on a 60-second cadence).
 *
 * Guarded to only run in the Node.js runtime (not Edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // On Vercel, serverless instances are ephemeral and warm ones fire this
  // setInterval repeatedly (and redundantly across instances), continuously
  // burning the Gemini free-tier quota — which starves interactive features
  // like Ask. Production sync is handled by the daily Vercel cron
  // (/api/cron/sync). Only run the in-process loop in a persistent local dev
  // server.
  if (process.env.VERCEL) return;
  const { startBackgroundSync } = await import("@/lib/background");
  startBackgroundSync();
}
