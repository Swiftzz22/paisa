import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  // Any "failed" with a 429 / quota / RESOURCE_EXHAUSTED message becomes pending.
  const result = await prisma.receivedEmail.updateMany({
    where: {
      parseStatus: "failed",
      parseError: { contains: "RESOURCE_EXHAUSTED" },
    },
    data: { parseStatus: "pending", parseError: null },
  });
  console.log(`Reset ${result.count} rate-limited 'failed' emails to 'pending'.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
