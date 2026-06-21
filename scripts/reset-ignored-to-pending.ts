/**
 * One-shot: reset every ReceivedEmail currently in 'ignored' status back to
 * 'pending'. The pre-filter + new (credit-aware) Gemini prompt will then
 * re-evaluate them. Truly non-transaction emails get cheaply re-ignored;
 * credits that were missed under the old (debit-only) prompt get captured.
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const ignoredBefore = await prisma.receivedEmail.count({
    where: { parseStatus: "ignored" },
  });
  console.log(`Currently 'ignored': ${ignoredBefore}`);

  const result = await prisma.receivedEmail.updateMany({
    where: { parseStatus: "ignored" },
    data: { parseStatus: "pending", parseError: null },
  });
  console.log(`Reset ${result.count} -> 'pending'.`);

  const breakdown = await prisma.receivedEmail.groupBy({
    by: ["parseStatus"],
    _count: { _all: true },
  });
  console.log("Status after reset:");
  for (const row of breakdown) {
    console.log(`  ${row.parseStatus}: ${row._count._all}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
