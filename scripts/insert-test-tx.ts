import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.findUnique({ where: { email: "me@local" } });
  if (!user) throw new Error("Run db:seed first");

  // Find a leaf category for the test (Food > Delivery).
  const food = await prisma.category.findFirst({
    where: { userId: user.id, name: "Food", parentId: null },
    include: { children: { where: { name: "Delivery" } } },
  });
  const category = food?.children[0];
  if (!category) throw new Error("Expected Food > Delivery to exist after seeding.");

  const tx = await prisma.transaction.create({
    data: {
      userId: user.id,
      merchant: "Swiggy",
      amount: 487.5,
      occurredAt: new Date(),
      paymentMode: "upi",
      source: "manual",
      note: "Test row for end-to-end verification",
      lines: {
        create: [{ categoryId: category.id, amount: 487.5 }],
      },
    },
  });
  console.log(`Inserted transaction ${tx.id}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
