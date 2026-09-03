import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import {
  deleteAllTransactions,
  deleteImport,
  listImports,
} from "@/lib/data-removal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET — the statements this user has imported, newest first. */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const imports = await listImports(user.id);
  return Response.json({
    imports: imports.map((i) => ({
      ...i,
      importedAt: i.importedAt.toISOString(),
    })),
  });
}

const Body = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("import"), batchId: z.string().min(1) }),
  /**
   * Clearing everything asks for the word back, the way account deletion asks
   * for the email. It is not reversible and it sits one tap from the far
   * milder "remove one import".
   */
  z.object({ scope: z.literal("all"), confirm: z.string() }),
]);

/** DELETE — remove one import's transactions, or all of them. */
export async function DELETE(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  if (parsed.data.scope === "import") {
    const { deleted } = await deleteImport(user.id, parsed.data.batchId);
    return Response.json({ ok: true, deleted });
  }

  if (parsed.data.confirm.trim().toUpperCase() !== "DELETE") {
    return Response.json(
      { error: "Type DELETE to confirm. Nothing was removed." },
      { status: 400 }
    );
  }
  const result = await deleteAllTransactions(user.id);
  return Response.json({ ok: true, ...result });
}
