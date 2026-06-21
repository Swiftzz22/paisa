import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  // Grab 3 recent "Account update" emails and show their bodies.
  const emails = await prisma.receivedEmail.findMany({
    where: {
      fromAddress: "alerts@hdfcbank.bank.in",
      subject: { contains: "Account update" },
    },
    orderBy: { receivedAt: "desc" },
    take: 3,
    select: { receivedAt: true, subject: true, bodyText: true, rawHtml: true },
  });

  for (const e of emails) {
    console.log(`\n=== ${e.receivedAt.toISOString()}  ${e.subject} ===`);
    const body = e.bodyText && e.bodyText.trim().length > 0
      ? e.bodyText
      : e.rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(body.slice(0, 1500));
  }

  await prisma.$disconnect();
}
main();
