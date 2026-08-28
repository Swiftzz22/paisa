import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { createGmailConnectTicket } from "@/lib/auth/mobile-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mobile/gmail-ticket
 *
 * Trades the app's bearer token for a short-lived ticket that identifies the
 * user to the browser-based Gmail consent flow.
 *
 * The browser carries no bearer token, and putting one in a URL would leak it
 * into system logs — so the token is exchanged here, over HTTPS, and only the
 * ticket travels onward.
 */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  return Response.json({ ticket: await createGmailConnectTicket(user.id) });
}
