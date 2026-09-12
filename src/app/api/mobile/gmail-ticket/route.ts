import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { createGmailConnectTicket } from "@/lib/auth/mobile-login";
import { isPlus, plusOnlyResponse } from "@/lib/billing";

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

  // Refuse before the consent screen, not after. A free user who granted Gmail
  // access and then found they could not sync would have spent one of the 100
  // grants Google allows an unverified app on a restricted scope — the scarcest
  // resource this project has, and not one to burn on someone who cannot use it.
  if (!(await isPlus(user.id))) {
    return plusOnlyResponse("Connecting Gmail");
  }

  return Response.json({ ticket: await createGmailConnectTicket(user.id) });
}
