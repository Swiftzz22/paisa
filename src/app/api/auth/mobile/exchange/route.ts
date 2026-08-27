import { NextRequest } from "next/server";
import { z } from "zod";
import { createMobileToken } from "@/lib/auth/mobile";
import {
  pruneExpiredAuthCodes,
  redeemMobileAuthCode,
} from "@/lib/auth/mobile-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ code: z.string().min(16).max(200) });

/**
 * POST /api/auth/mobile/exchange
 *
 * Trades the one-time code from the sign-in redirect for a bearer token. The
 * code is single-use and expires in two minutes, so a leaked redirect URL is
 * worth nothing by the time anyone reads it out of a log.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const redeemed = await redeemMobileAuthCode(parsed.data.code);
  if (!redeemed) {
    // Used, expired, or never existed — all the same to the caller.
    return Response.json(
      { error: "That sign-in link has expired. Please try again." },
      { status: 401 }
    );
  }

  const token = await createMobileToken(redeemed.userId);

  // Cheap upkeep on a route that already writes: nothing else prunes this table.
  pruneExpiredAuthCodes().catch(() => {});

  return Response.json({ token });
}
