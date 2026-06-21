import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

const DEFAULT_USER_EMAIL = "me@local";

const DEFAULT_PAYMENT_MODES: Array<{ value: string; label: string; sortOrder: number }> = [
  { value: "upi", label: "UPI", sortOrder: 0 },
  { value: "card", label: "Card", sortOrder: 1 },
  { value: "cash", label: "Cash", sortOrder: 2 },
  { value: "bank_transfer", label: "Bank transfer", sortOrder: 3 },
];

const CATEGORY_TREE: Array<{ name: string; icon?: string; children?: string[] }> = [
  { name: "Food", icon: "🍽", children: ["Restaurants", "Delivery", "Coffee", "Cafeteria"] },
  { name: "Groceries", icon: "🛒" },
  { name: "Transport", icon: "🚕", children: ["Cab", "Fuel", "Public transit"] },
  { name: "Subscriptions", icon: "🔁", children: ["Streaming", "Magazine", "Gym", "Software"] },
  { name: "Entertainment", icon: "🎬" },
  { name: "Health", icon: "💊" },
  { name: "Shopping", icon: "🛍" },
  { name: "Education", icon: "📚" },
  { name: "Rent & Utilities", icon: "🏠" },
  { name: "Transfers", icon: "🔁", children: ["Friends", "Family", "Self"] },
  { name: "Income", icon: "💰", children: ["Refund", "Allowance", "Other"] },
  { name: "Misc", icon: "✨" },
];

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: { email: DEFAULT_USER_EMAIL },
  });
  console.log(`User: ${user.email} (${user.id})`);

  for (const top of CATEGORY_TREE) {
    const existing = await prisma.category.findFirst({
      where: { userId: user.id, name: top.name, parentId: null },
    });
    const parent =
      existing ??
      (await prisma.category.create({
        data: { userId: user.id, name: top.name, icon: top.icon ?? null },
      }));
    if (existing) {
      console.log(`  exists: ${parent.name}`);
    } else {
      console.log(`  created: ${parent.name}`);
    }

    for (const childName of top.children ?? []) {
      const childExists = await prisma.category.findFirst({
        where: { userId: user.id, name: childName, parentId: parent.id },
      });
      if (childExists) {
        console.log(`    exists: ${parent.name} > ${childName}`);
        continue;
      }
      await prisma.category.create({
        data: { userId: user.id, name: childName, parentId: parent.id },
      });
      console.log(`    created: ${parent.name} > ${childName}`);
    }
  }

  for (const pm of DEFAULT_PAYMENT_MODES) {
    const existing = await prisma.paymentMode.findFirst({
      where: { userId: user.id, value: pm.value },
    });
    if (existing) {
      console.log(`  exists: payment mode ${pm.label}`);
      continue;
    }
    await prisma.paymentMode.create({
      data: {
        userId: user.id,
        value: pm.value,
        label: pm.label,
        sortOrder: pm.sortOrder,
        builtin: true,
      },
    });
    console.log(`  created: payment mode ${pm.label}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
