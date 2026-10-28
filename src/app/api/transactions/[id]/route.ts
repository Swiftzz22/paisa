import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/transactions/:id — the web app's delete, sent by the undo toast
 * once its five seconds are up.
 *
 * A route rather than a server action because it has to survive the page
 * going away: the toast sends it with `keepalive` when someone navigates off
 * or closes the tab mid-countdown, and a server action can't be sent that way.
 * Cookie-authenticated; a cross-site page can't send a DELETE without a CORS
 * preflight this route never answers, and the session cookie is SameSite=Lax.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  // deleteMany scoped to the user: someone else's id deletes nothing, and a
  // second send of the same delete (pagehide after the timer) is harmless.
  const { count } = await prisma.transaction.deleteMany({ where: { id, userId: user.id } });
  return Response.json({ deleted: count });
}
