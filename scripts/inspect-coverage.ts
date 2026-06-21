import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const oldestEmail = await prisma.receivedEmail.findFirst({
    orderBy: { receivedAt: "asc" },
    select: { receivedAt: true, fromAddress: true, subject: true },
  });
  const newestEmail = await prisma.receivedEmail.findFirst({
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  const totalEmails = await prisma.receivedEmail.count();

  const oldestTx = await prisma.transaction.findFirst({
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true, merchant: true, amount: true },
  });
  const totalTx = await prisma.transaction.count();

  console.log("ReceivedEmail coverage:");
  console.log(`  Total emails: ${totalEmails}`);
  console.log(`  Oldest: ${oldestEmail?.receivedAt?.toISOString() ?? "—"}`);
  if (oldestEmail) {
    console.log(`    from: ${oldestEmail.fromAddress}`);
    console.log(`    subj: ${oldestEmail.subject.slice(0, 80)}`);
  }
  console.log(`  Newest: ${newestEmail?.receivedAt?.toISOString() ?? "—"}`);
  console.log("");
  console.log("Transaction coverage:");
  console.log(`  Total transactions: ${totalTx}`);
  console.log(`  Oldest: ${oldestTx?.occurredAt?.toISOString() ?? "—"}`);
  if (oldestTx) {
    console.log(`    ${oldestTx.merchant} — ₹${oldestTx.amount.toString()}`);
  }

  // Count emails per month
  const allEmails = await prisma.receivedEmail.findMany({
    select: { receivedAt: true },
  });
  const byMonth = new Map<string, number>();
  for (const e of allEmails) {
    const key = `${e.receivedAt.getFullYear()}-${String(e.receivedAt.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  console.log("");
  console.log("Emails per month:");
  for (const key of Array.from(byMonth.keys()).sort()) {
    console.log(`  ${key}: ${byMonth.get(key)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
