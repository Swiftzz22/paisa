import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { importUniversalStatement } from "@/lib/statement-import";
import { OutOfTimeError } from "@/lib/email/parser";
import { checkAllowance, consume, paywallResponse } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Reading a statement means an LLM pass over the whole file.
export const maxDuration = 60;

/** Same ceiling the website uses. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED = [".csv", ".xlsx", ".xls", ".pdf", ".txt"];

/**
 * POST /api/mobile/import — upload a statement from the app.
 *
 * Runs the same universal importer the website uses, so a CSV, spreadsheet or
 * PDF all land through one path and get the same duplicate checks. This exists
 * because statement upload was previously web-only, which meant anyone whose
 * bank paisa. cannot read from email had to go find a browser.
 */
/**
 * Leave the model less time than the function has, so a slow parse comes back
 * as a sentence rather than a 504. Vercel kills this at 60s; stopping at 52
 * leaves room to write the response and tell the person what happened, while
 * giving a long PDF as much of the window as can safely be spared.
 */
const PARSE_BUDGET_MS = 52_000;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return Response.json({ error: "Couldn't read that upload." }, { status: 400 });
  }
  if (!file) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  const filename = file.name || "statement";
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED.includes(ext)) {
    return Response.json(
      { error: `Upload a ${ALLOWED.join(", ")} file.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "That file is over 10 MB." }, { status: 400 });
  }

  // Metered: reading a statement is a model pass over the whole file. Checked
  // last, after the cheap validation, so someone who uploaded a .docx is told
  // that rather than being charged an allowance for it.
  const tz = Number(new URL(req.url).searchParams.get("tzOffset") ?? 0);
  const allowance = await checkAllowance(user.id, "import", tz);
  if (!allowance.allowed) return paywallResponse(allowance, "statement imports");

  try {
    // Phase timings, because a 504 tells you only that something was slow.
    // The model, the database and the file read all live in here and a bare
    // timeout cannot say which one stalled.
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log(`[mobile/import] read ${buffer.length}B in ${Date.now() - startedAt}ms`);

    const result = await importUniversalStatement({
      userId: user.id,
      fileBuffer: buffer,
      filename,
      // A family credit card is issued in one parent's name with an add-on
      // card in the child's, and both appear on the same statement. Without
      // this the app imports the whole household's spending as the user's own.
      accountHolderName: user.name,
      deadline: startedAt + PARSE_BUDGET_MS,
    });
    console.log(`[mobile/import] done in ${Date.now() - startedAt}ms`);
    await consume(user.id, "import", tz);
    return Response.json({
      ok: true,
      added: result.inserted,
      duplicates: result.skippedByRef + result.skippedByFuzzy,
      failed: result.failed,
      rows: result.totalRows,
      // A scanned statement is read a page at a time, and a page can fail
      // without the rest of it failing. Saying which pages were missed is the
      // difference between a partial import and a wrong one.
      warnings: result.warnings ?? [],
    });
  } catch (e) {
    // Ran out of time waiting on the model — usually Gemini rate-limiting us.
    // Worth its own answer: nothing is wrong with the file, and trying again
    // shortly genuinely works, which "couldn't read that file" would deny.
    if (e instanceof OutOfTimeError) {
      console.error("[mobile/import] out of time waiting for the model");
      return Response.json(
        {
          error:
            "Reading that statement is taking longer than usual — the AI service is busy. Please try again in a minute.",
        },
        { status: 503 }
      );
    }
    console.error("[mobile/import] failed:", e);
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Couldn't read that file. Check it's a statement export.",
      },
      { status: 400 }
    );
  }
}
