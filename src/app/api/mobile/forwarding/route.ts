import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { getInboundAddress, rotateInboundAddress } from "@/lib/email/inbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * This device's forwarding address.
 *
 * `address: null` means the server has no inbound mail domain configured, so
 * the app hides the row rather than offering something that cannot work.
 */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  return Response.json({ address: await getInboundAddress(user.id) });
}

/** Replace it, revoking the old one. */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  return Response.json({ address: await rotateInboundAddress(user.id) });
}
