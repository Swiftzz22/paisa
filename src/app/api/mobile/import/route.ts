import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { importUniversalStatement } from "@/lib/statement-import";

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
export async function POST(req: NextRequest) {
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

  try {
    const result = await importUniversalStatement({
      userId: user.id,
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      filename,
    });
    return Response.json({
      ok: true,
      added: result.inserted,
      duplicates: result.skippedByRef + result.skippedByFuzzy,
      failed: result.failed,
      rows: result.totalRows,
    });
  } catch (e) {
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
