import "server-only";
import { prisma } from "@/lib/prisma";

export type CategoryOption = {
  id: string;
  label: string; // e.g. "Food" or "Food > Restaurants"
  depth: 0 | 1;
};

/**
 * Returns categories as a flat list of options, with each leaf prefixed by its parent.
 * Order: parent immediately followed by its children. Suitable for a <select>.
 */
export async function getCategoryOptions(userId: string): Promise<CategoryOption[]> {
  const tops = await prisma.category.findMany({
    where: { userId, parentId: null, archived: false },
    include: {
      children: {
        where: { archived: false },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const options: CategoryOption[] = [];
  for (const top of tops) {
    options.push({ id: top.id, label: top.name, depth: 0 });
    for (const child of top.children) {
      options.push({
        id: child.id,
        label: `${top.name} › ${child.name}`,
        depth: 1,
      });
    }
  }
  return options;
}

/**
 * Sync fallback for displaying a payment-mode value when we don't have the DB
 * label handy. Use `paymentModeLabelFor()` from @/lib/payment-modes for the
 * authoritative label.
 */
export function paymentModeLabel(mode: string): string {
  const builtins: Record<string, string> = {
    upi: "UPI",
    card: "Card",
    cash: "Cash",
    bank_transfer: "Bank transfer",
  };
  if (builtins[mode]) return builtins[mode];
  return mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
