import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  // Last 7 days
  const since = new Date();
  since.setDate(since.getDate() - 7);

  console.log(`\n=== Emails received since ${since.toISOString()} ===`);
  const emails = await prisma.receivedEmail.findMany({
    where: { receivedAt: { gte: since } },
    orderBy: { receivedAt: "desc" },
    take: 40,
    select: {
      receivedAt: true,
      fromAddress: true,
      subject: true,
      parseStatus: true,
      parseError: true,
    },
  });
  for (const e of emails) {
    const status = e.parseStatus.padEnd(8);
    const date = e.receivedAt.toISOString().slice(0, 16);
    console.log(`  [${status}] ${date}  ${e.fromAddress}`);
    console.log(`             ${e.subject.slice(0, 80)}`);
    if (e.parseStatus === "failed" && e.parseError) {
      console.log(`             err: ${e.parseError.slice(0, 100)}`);
    }
  }

  console.log(`\n=== Transactions occurredAt since ${since.toISOString()} ===`);
  const txs = await prisma.transaction.findMany({
    where: { occurredAt: { gte: since } },
    orderBy: { occurredAt: "desc" },
    take: 30,
    select: {
      occurredAt: true,
      merchant: true,
      amount: true,
      type: true,
      source: true,
      paymentMode: true,
    },
  });
  for (const t of txs) {
    const date = t.occurredAt.toISOString().slice(0, 16);
    const sign = t.type === "credit" ? "+" : "-";
    console.log(`  ${date}  ${sign}₹${t.amount.toString().padStart(8)}  [${t.source}/${t.paymentMode}]  ${t.merchant}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
