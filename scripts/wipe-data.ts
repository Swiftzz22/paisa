import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const txCount = await prisma.transaction.count();
  const emailCount = await prisma.receivedEmail.count();

  // ExpenseLines cascade from Transaction deletion. Emails are wiped explicitly.
  const txResult = await prisma.transaction.deleteMany({});
  const emailResult = await prisma.receivedEmail.deleteMany({});

  console.log(`Deleted ${txResult.count} of ${txCount} transactions (lines cascaded).`);
  console.log(`Deleted ${emailResult.count} of ${emailCount} received emails.`);
  console.log("Kept: users, categories, categorization rules, email account.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
