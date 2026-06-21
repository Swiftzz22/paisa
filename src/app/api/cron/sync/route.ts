import { runSyncTick } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A sync tick can fetch + LLM-parse a batch; give it room.
export const maxDuration = 60;

/**
 * Serverless cron entrypoint for the email sync.
 *
 * On Vercel, the in-process setInterval in background.ts does NOT run (functions
 * are stateless and torn down between requests). Instead an external scheduler
 * (Vercel Cron, GitHub Actions, or cron-job.org) hits this endpoint on a
 * schedule, and each hit runs exactly one sync tick across all connected users.
 *
 * Protected by CRON_SECRET: the caller must send `Authorization: Bearer <secret>`.
 * Vercel Cron sends this header automatically when CRON_SECRET is set in the
 * project's env vars. Locally (no secret set) it's allowed so you can test.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Never run an unprotected cron in production.
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }

  const startedAt = new Date().toISOString();
  try {
    await runSyncTick();
    return Response.json({ ok: true, startedAt });
  } catch (e) {
    console.error("[cron/sync] failed:", e);
    return Response.json(
      { ok: false, startedAt, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
