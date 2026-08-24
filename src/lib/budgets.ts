import "server-only";
import { prisma } from "@/lib/prisma";
import { daysInLocalMonth, localParts, monthRange } from "@/lib/time";

export type BudgetWithCategory = {
  id: string;
  amountInr: number;
  category: {
    id: string;
    name: string;
    parentName: string | null;
    icon: string | null;
  };
};

export async function getBudgets(userId: string): Promise<BudgetWithCategory[]> {
  const rows = await prisma.budget.findMany({
    where: { userId },
    include: { category: { include: { parent: true } } },
  });
  return rows
    .map((b) => ({
      id: b.id,
      amountInr: Number(b.amountInr),
      category: {
        id: b.category.id,
        name: b.category.name,
        parentName: b.category.parent?.name ?? null,
        icon: b.category.icon ?? b.category.parent?.icon ?? null,
      },
    }))
    .sort((a, b) => b.amountInr - a.amountInr);
}

export type BudgetProgress = {
  budgetId: string;
  categoryId: string;
  label: string; // "Food › Coffee" or just "Food"
  icon: string | null;
  spent: number;
  cap: number;
  percent: number; // 0..(>1 when over)
};

export type MonthlyBudgetSummary = {
  monthLabel: string; // "June 2026"
  daysInMonth: number;
  daysElapsed: number; // through today
  progress: BudgetProgress[];
  totalCap: number;
  totalSpent: number;
};

/**
 * For each user budget, compute spend in the calendar month containing `when`.
 * Spend rolls up: a budget on "Food" counts all transactions in Food or any
 * Food › child. A budget on a leaf (e.g. "Food › Coffee") counts only that leaf.
 */
export async function getBudgetProgress(
  userId: string,
  when: Date = new Date(),
  tzOffset = 0
): Promise<MonthlyBudgetSummary> {
  const month = monthRange(when, tzOffset);
  const monthStart = month.from;
  const monthEnd = month.to;
  const daysInMonth = daysInLocalMonth(when, tzOffset);
  const todayDay = Math.min(localParts(when, tzOffset).day, daysInMonth);

  const budgets = await getBudgets(userId);
  if (budgets.length === 0) {
    return {
      monthLabel: month.label,
      daysInMonth,
      daysElapsed: todayDay,
      progress: [],
      totalCap: 0,
      totalSpent: 0,
    };
  }

  // Pull all this-month debits with their categories so we can roll up.
  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      type: "debit",
      occurredAt: { gte: monthStart, lte: monthEnd },
    },
    include: {
      lines: { include: { category: { include: { parent: true } } } },
    },
  });

  // Map: categoryId -> rolled-up spend across this month.
  const spentByCategoryId = new Map<string, number>();
  // For "parent" budgets, also build a sum over all child categories.
  const spentByParentId = new Map<string, number>();

  for (const t of txs) {
    const amt = Number(t.amount);
    for (const line of t.lines) {
      const cat = line.category;
      if (!cat) continue;
      spentByCategoryId.set(
        cat.id,
        (spentByCategoryId.get(cat.id) ?? 0) + Number(line.amount || amt)
      );
      const parentId = cat.parentId ?? null;
      if (parentId) {
        spentByParentId.set(
          parentId,
          (spentByParentId.get(parentId) ?? 0) +
            Number(line.amount || amt)
        );
      }
    }
  }

  const progress: BudgetProgress[] = budgets.map((b) => {
    // Self-spend at this exact category + (if a top-level) any children's spend.
    const self = spentByCategoryId.get(b.category.id) ?? 0;
    const children = spentByParentId.get(b.category.id) ?? 0;
    const spent = self + children;
    const label = b.category.parentName
      ? `${b.category.parentName} › ${b.category.name}`
      : b.category.name;
    return {
      budgetId: b.id,
      categoryId: b.category.id,
      label,
      icon: b.category.icon,
      spent,
      cap: b.amountInr,
      percent: b.amountInr > 0 ? spent / b.amountInr : 0,
    };
  });

  return {
    monthLabel: month.label,
    daysInMonth,
    daysElapsed: todayDay,
    progress,
    totalCap: progress.reduce((s, p) => s + p.cap, 0),
    totalSpent: progress.reduce((s, p) => s + p.spent, 0),
  };
}

/**
 * Compute month-over-month delta for total debits.
 * Returns { thisMonth, lastMonth, deltaAbs, deltaPercent } where positive
 * delta means you spent MORE this month than last.
 */
export async function getMonthOverMonthDelta(
  userId: string,
  when: Date = new Date(),
  tzOffset = 0
) {
  const thisMonthRange = monthRange(when, tzOffset);
  const lastMonthRange = monthRange(when, tzOffset, -1);

  const [thisTxs, lastTxs] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        type: "debit",
        occurredAt: { gte: thisMonthRange.from, lte: thisMonthRange.to },
      },
      select: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        type: "debit",
        occurredAt: { gte: lastMonthRange.from, lte: lastMonthRange.to },
      },
      select: { amount: true },
    }),
  ]);

  const thisMonth = thisTxs.reduce((s, t) => s + Number(t.amount), 0);
  const lastMonth = lastTxs.reduce((s, t) => s + Number(t.amount), 0);
  const deltaAbs = thisMonth - lastMonth;
  const deltaPercent = lastMonth > 0 ? deltaAbs / lastMonth : null;

  return { thisMonth, lastMonth, deltaAbs, deltaPercent };
}
