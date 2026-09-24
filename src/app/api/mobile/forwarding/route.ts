import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import {
  getForwardingStatus,
  getInboundAddress,
  rotateInboundAddress,
} from "@/lib/email/inbound";
import { buildGmailForwardingFilter } from "@/lib/email/classify";

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

  // Everything the setup screen needs in one call: the address, the filter to
  // paste, the code Gmail is waiting on, and whether anything has arrived.
  // Four round trips on a phone is four chances to show a half-built screen.
  const [address, status] = await Promise.all([
    getInboundAddress(user.id),
    getForwardingStatus(user.id),
  ]);

  return Response.json({
    address,
    filter: buildGmailForwardingFilter(),
    pendingCode: status.pendingCode,
    lastReceivedAt: status.lastReceivedAt?.toISOString() ?? null,
    recentCount: status.recentCount,
  });
}

/** Replace it, revoking the old one. */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  return Response.json({ address: await rotateInboundAddress(user.id) });
}
