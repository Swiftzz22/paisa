/**
 * Diagnostic: query Gmail with NO sender filter for the Jan–March window,
 * then report the top 30 senders by count. Helps figure out which bank /
 * UPI domains we're missing from FINANCIAL_DOMAIN_PATTERNS.
 */
import { google } from "googleapis";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDecipheriv } from "node:crypto";
import "dotenv/config";

function decrypt(ciphertextB64: string): string {
  const hex = process.env.TOKEN_ENCRYPTION_KEY!;
  const key = Buffer.from(hex, "hex");
  const blob = Buffer.from(ciphertextB64, "base64");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const account = await prisma.emailAccount.findFirst({
    select: { refreshTokenEnc: true, accountEmail: true },
  });
  if (!account) {
    console.log("No connected email account. Connect Gmail first.");
    return;
  }
  const refreshToken = decrypt(account.refreshTokenEnc);

  const oauth = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  });
  oauth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth });

  const q = "after:2026/01/01 before:2026/04/01";
  console.log(`Listing all messages for q = "${q}" …\n`);

  const senderCounts = new Map<string, number>();
  let pageToken: string | undefined;
  let totalSeen = 0;
  const HARD_CAP = 1000; // safety

  while (totalSeen < HARD_CAP) {
    const list = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: 500,
      pageToken,
    });
    const ids = list.data.messages ?? [];
    if (ids.length === 0) break;

    for (const ref of ids) {
      if (!ref.id) continue;
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: ref.id,
        format: "metadata",
        metadataHeaders: ["From"],
      });
      const from = msg.data.payload?.headers?.find((h) => h.name === "From")
        ?.value;
      if (from) {
        const cleaned = cleanSender(from);
        senderCounts.set(cleaned, (senderCounts.get(cleaned) ?? 0) + 1);
      }
      totalSeen++;
    }

    if (!list.data.nextPageToken) break;
    pageToken = list.data.nextPageToken;
  }

  console.log(`Inspected ${totalSeen} messages.\n`);
  console.log("Top 30 senders in Jan–Mar 2026:");
  const sorted = Array.from(senderCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [sender, count] of sorted.slice(0, 30)) {
    console.log(`  ${count.toString().padStart(4)} × ${sender}`);
  }

  await prisma.$disconnect();
}

function cleanSender(raw: string): string {
  const m = /<([^>]+)>/.exec(raw);
  const addr = m ? m[1] : raw;
  const at = addr.indexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : addr.toLowerCase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
