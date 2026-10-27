import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { isPlus, plusOnlyResponse } from "@/lib/billing";
import { SPLIT_MODES, SplitError, applySplit, removeSplit } from "@/lib/splits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  paidBy: z.string().min(1).nullable(),
  mode: z.enum(SPLIT_MODES),
  entries: z
    .array(z.object({ personId: z.string().min(1).nullable(), weight: z.number().min(0).max(100_000_000) }))
    .min(1)
    .max(50),
});

/**
 * PUT /api/mobile/transactions/:id/split — split an expense, or change how.
 * The app sends what was entered; the server works out the rupees.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlus(user.id))) return plusOnlyResponse("Splitting bills");
  const { id } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid split." }, { status: 400 });
  }
  try {
    await applySplit(user.id, id, parsed.data);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof SplitError) {
      return Response.json({ error: e.message }, { status: e.message === "Not found." ? 404 : 400 });
    }
    throw e;
  }
}

/**
 * DELETE — stop splitting it; the expense is the whole bill again. Not gated:
 * undoing is always allowed.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await removeSplit(user.id, id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof SplitError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
