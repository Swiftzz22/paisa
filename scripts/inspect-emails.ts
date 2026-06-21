import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const byStatus = await prisma.receivedEmail.groupBy({
    by: ["parseStatus"],
    _count: { _all: true },
  });
  console.log("Status counts:");
  for (const row of byStatus) console.log(`  ${row.parseStatus}: ${row._count._all}`);

  console.log("\nFailed emails (latest 10) — sender + first 200 chars of error:");
  const failed = await prisma.receivedEmail.findMany({
    where: { parseStatus: "failed" },
    orderBy: { receivedAt: "desc" },
    take: 10,
    select: {
      fromAddress: true,
      subject: true,
      receivedAt: true,
      parseError: true,
    },
  });
  for (const e of failed) {
    console.log(`\n  [${e.receivedAt.toISOString().slice(0, 16)}] ${e.fromAddress}`);
    console.log(`    subject: ${e.subject.slice(0, 80)}`);
    console.log(`    error:   ${(e.parseError ?? "(none)").slice(0, 600)}`);
  }

  console.log("\nIgnored emails (latest 10) — to see what's noise:");
  const ignored = await prisma.receivedEmail.findMany({
    where: { parseStatus: "ignored" },
    orderBy: { receivedAt: "desc" },
    take: 10,
    select: { fromAddress: true, subject: true },
  });
  for (const e of ignored) {
    console.log(`  ${e.fromAddress} — ${e.subject.slice(0, 60)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
