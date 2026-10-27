import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/mobile/settlements/:id — undo a settlement recorded by mistake. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { count } = await prisma.settlement.deleteMany({ where: { id, userId: user.id } });
  if (!count) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}
