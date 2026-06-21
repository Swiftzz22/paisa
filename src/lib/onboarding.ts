import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Default categories + payment modes for a brand-new user. Kept in sync with
 * prisma/seed.ts (which seeds the original local user). This runtime version
 * is what onboards users who sign in via Google.
 */
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

const PAYMENT_MODES: Array<{ value: string; label: string; sortOrder: number }> = [
  { value: "upi", label: "UPI", sortOrder: 0 },
  { value: "card", label: "Card", sortOrder: 1 },
  { value: "cash", label: "Cash", sortOrder: 2 },
  { value: "bank_transfer", label: "Bank transfer", sortOrder: 3 },
];

/**
 * Seed defaults for a user. Idempotent — skips anything that already exists,
 * so it's safe to call on every login if we ever want to backfill.
 */
export async function seedDefaultsForUser(userId: string): Promise<void> {
  const existingCats = await prisma.category.count({ where: { userId } });
  if (existingCats === 0) {
    for (const top of CATEGORY_TREE) {
      const parent = await prisma.category.create({
        data: { userId, name: top.name, icon: top.icon ?? null },
      });
      for (const childName of top.children ?? []) {
        await prisma.category.create({
          data: { userId, name: childName, parentId: parent.id },
        });
      }
    }
  }

  const existingModes = await prisma.paymentMode.count({ where: { userId } });
  if (existingModes === 0) {
    for (const pm of PAYMENT_MODES) {
      await prisma.paymentMode.create({
        data: {
          userId,
          value: pm.value,
          label: pm.label,
          sortOrder: pm.sortOrder,
          builtin: true,
        },
      });
    }
  }
}
