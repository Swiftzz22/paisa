import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchRecent } from "@/lib/email/gmail";
import { getRefreshToken, markSynced } from "@/lib/email/account";
import { processPendingForUser } from "@/lib/email/process";
import { isGeminiConfigured } from "@/lib/email/parser";

export type FetchAndStoreOptions = {
  limit: number;
  after?: Date;
  before?: Date;
};

/**
 * Pull recent financial-sender emails via Gmail API, persist new ones as
 * 'pending', then hand off to the batched processor in one go.
 */
export async function fetchAndStoreRecent(
  userId: string,
  optsOrLimit: number | FetchAndStoreOptions
) {
  const opts: FetchAndStoreOptions =
    typeof optsOrLimit === "number" ? { limit: optsOrLimit } : optsOrLimit;

  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) throw new Error("Gmail is not connected. Connect on /settings/email.");

  const messages = await fetchRecent(refreshToken, {
    limit: opts.limit,
    after: opts.after,
    before: opts.before,
  });

  let inserted = 0;
  let skipped = 0;

  for (const m of messages) {
    if (!m.messageId) {
      skipped++;
      continue;
    }
    const existing = await prisma.receivedEmail.findFirst({
      where: { userId, messageId: m.messageId },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.receivedEmail.create({
      data: {
        userId,
        messageId: m.messageId,
        fromAddress: m.fromAddress,
        subject: m.subject,
        rawHtml: m.html,
        bodyText: m.text,
        receivedAt: m.receivedAt,
        parseStatus: "pending",
      },
    });
    inserted++;
  }

  await markSynced(userId);

  // Process via the batched pipeline so every fetch immediately turns
  // transaction emails into expenses (and ignored ones get filtered out).
  let parsed = 0;
  let ignored = 0;
  let failed = 0;
  let rateLimitedAfter: number | null = null;
  if (isGeminiConfigured() && inserted > 0) {
    const r = await processPendingForUser(userId);
    parsed = r.parsed;
    ignored = r.ignored;
    failed = r.failed;
    rateLimitedAfter = r.rateLimitedAfter;
  }

  return {
    fetched: messages.length,
    inserted,
    skipped,
    parsed,
    ignored,
    failed,
    rateLimitedAfter,
  };
}
