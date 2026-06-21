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

  const food = await prisma.category.findFirst({
    where: { userId: user.id, name: "Food", parentId: null },
    include: { children: { where: { name: "Delivery" } } },
  });
  const category = food?.children[0];
  if (!category) throw new Error("Expected Food > Delivery to exist.");

  await prisma.categorizationRule.upsert({
    where: {
      userId_matcherType_matcherValue: {
        userId: user.id,
        matcherType: "merchant",
        matcherValue: "swiggy",
      },
    },
    update: { categoryId: category.id },
    create: {
      userId: user.id,
      matcherType: "merchant",
      matcherValue: "swiggy",
      categoryId: category.id,
    },
  });
  console.log("Upserted rule: merchant contains 'swiggy' → Food > Delivery");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
