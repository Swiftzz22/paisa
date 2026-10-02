import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import {
  deleteEmailAccount,
  getAccountsWithTokens,
} from "@/lib/email/account";
import { revokeToken } from "@/lib/email/google-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/mobile/email — disconnect every mailbox on this account.
 *
 * The app calls this when someone withdraws permission to send their data to
 * AI services. A connected mailbox is read on the server by the cron, not by
 * the phone, so withdrawing on the device alone would leave alerts still being
 * sent to the model — "off" would not mean off. Disconnecting is what makes
 * the withdrawal true.
 *
 * Revocation at Google is best-effort: a token that cannot be decrypted or
 * that Google has already forgotten must not leave the connection in place.
 */
export async function DELETE(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let revoked = 0;
  try {
    const accounts = await getAccountsWithTokens(user.id);
    for (const account of accounts) {
      if (account.provider !== "gmail") continue;
      try {
        await revokeToken(account.refreshToken);
        revoked++;
      } catch (e) {
        console.error("[mobile/email] revoke skipped:", e);
      }
    }
  } catch (e) {
    console.error("[mobile/email] could not read stored tokens:", e);
  }

  await deleteEmailAccount(user.id);

  // Alerts already fetched but not yet read would otherwise still go to the
  // model on the next cron tick. They are copies — reconnecting fetches them
  // from the mailbox again — so dropping them loses nothing.
  const { count: dropped } = await prisma.receivedEmail.deleteMany({
    where: { userId: user.id, parseStatus: { in: ["pending", "failed"] } },
  });

  return Response.json({ ok: true, revoked, dropped });
}
