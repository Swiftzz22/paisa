/**
 * Verify the app's runtime path (Prisma + libSQL adapter) reads Turso correctly.
 * Mirrors src/lib/prisma.ts's Turso branch. Checks typed reads incl. Decimal,
 * DateTime, and a relation include.
 *
 *   npx tsx scripts/verify-turso-read.ts
 */
import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const adapter = new PrismaLibSql({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.findFirst({
    select: { email: true, name: true, createdAt: true },
  });
  console.log("user:", user);

  const [txCount, catCount] = await Promise.all([
    prisma.transaction.count(),
    prisma.category.count(),
  ]);
  console.log(`transactions: ${txCount}, categories: ${catCount}`);

  const recent = await prisma.transaction.findMany({
    take: 3,
    orderBy: { occurredAt: "desc" },
    include: { lines: { include: { category: { include: { parent: true } } } } },
  });
  console.log("\n3 most recent transactions (Decimal + DateTime + relation):");
  for (const t of recent) {
    const cat = t.lines[0]?.category;
    const label = cat ? (cat.parent ? `${cat.parent.name} › ${cat.name}` : cat.name) : "—";
    console.log(
      `  ${t.occurredAt.toISOString().slice(0, 10)}  ₹${t.amount.toString().padStart(9)}  ${t.type.padEnd(6)}  ${label.padEnd(22)}  ${t.merchant.slice(0, 30)}`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
