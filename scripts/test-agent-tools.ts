/**
 * Session 1 verification: call each of the 5 agent tools with realistic args
 * and print the shapes so we can see they return what the LLM will need.
 *
 *   npx tsx scripts/test-agent-tools.ts
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

// Inline the tool implementations from src/lib/agent/tools.ts since that file
// imports "server-only" (which only resolves inside the Next.js bundler).
// Keep this in sync with src/lib/agent/tools.ts during development; the
// production agent uses the original module.

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.error("No user in DB. Run db:seed first.");
    process.exit(1);
  }
  console.log(`User: ${user.email} (${user.id})\n`);

  // ---- 5. getContext (call first so we have category/mode names) -----------
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const cats = await prisma.category.findMany({
    where: { userId: user.id, parentId: null, archived: false },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  const modes = await prisma.paymentMode.findMany({
    where: { userId: user.id, archived: false },
    select: { value: true, label: true },
  });
  const oldest = await prisma.transaction.findFirst({
    where: { userId: user.id },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });
  console.log("=== getContext() ===");
  console.log({
    today: todayStr,
    currencyCode: "INR",
    categories: cats.map((c) => c.name),
    paymentModes: modes,
    earliest: oldest?.occurredAt.toISOString().slice(0, 10) ?? null,
  });
  console.log();

  // Set up a date range for the other tests: this month.
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

  // ---- 1. queryTransactions ------------------------------------------------
  console.log("=== queryTransactions({ from: this month start, type: debit, limit: 5 }) ===");
  const txs = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      type: "debit",
      occurredAt: { gte: monthStart, lte: monthEnd },
    },
    include: {
      lines: { include: { category: { include: { parent: true } } } },
    },
    orderBy: { occurredAt: "desc" },
    take: 5,
  });
  console.log({
    rowCount: txs.length,
    sample: txs.map((t) => {
      const cat = t.lines[0]?.category ?? null;
      const parent = cat?.parent ?? null;
      return {
        date: t.occurredAt.toISOString().slice(0, 10),
        merchant: t.merchant,
        amount: Number(t.amount),
        category: parent?.name ?? cat?.name ?? "Uncategorized",
        leaf: parent ? cat?.name ?? null : null,
        mode: t.paymentMode,
        type: t.type,
      };
    }),
  });
  console.log();

  // ---- 2. aggregateByCategory ----------------------------------------------
  console.log("=== aggregateByCategory({ from: month start, to: today, type: debit }) ===");
  const agg = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      type: "debit",
      occurredAt: { gte: monthStart, lte: monthEnd },
    },
    include: {
      lines: { include: { category: { include: { parent: true } } } },
    },
  });
  const catMap = new Map<string, { totalInr: number; txCount: number }>();
  for (const t of agg) {
    const cat = t.lines[0]?.category ?? null;
    const parent = cat?.parent ?? null;
    const key = parent?.name ?? cat?.name ?? "Uncategorized";
    const a = Number(t.amount);
    const cur = catMap.get(key);
    if (cur) {
      cur.totalInr += a;
      cur.txCount++;
    } else catMap.set(key, { totalInr: a, txCount: 1 });
  }
  const catRows = Array.from(catMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.totalInr - a.totalInr);
  console.log({ rows: catRows.slice(0, 6) });
  console.log();

  // ---- 3. aggregateByMerchant ----------------------------------------------
  console.log("=== aggregateByMerchant({ from: month start, type: debit, limit: 5 }) ===");
  const grouped = await prisma.transaction.groupBy({
    by: ["merchant"],
    where: {
      userId: user.id,
      type: "debit",
      occurredAt: { gte: monthStart, lte: monthEnd },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const top = grouped
    .map((g) => ({
      merchant: g.merchant,
      totalInr: Number(g._sum.amount ?? 0),
      txCount: g._count._all,
    }))
    .sort((a, b) => b.totalInr - a.totalInr)
    .slice(0, 5);
  console.log(top);
  console.log();

  // ---- 4. monthlyTotals ----------------------------------------------------
  console.log("=== monthlyTotals({ fromMonth: 6 months ago, toMonth: this month }) ===");
  const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  const monthlyTxs = await prisma.transaction.findMany({
    where: { userId: user.id, type: "debit", occurredAt: { gte: start, lte: end } },
    select: { amount: true, occurredAt: true },
  });
  const months = new Map<string, { totalInr: number; txCount: number }>();
  const cursor = new Date(start);
  while (cursor <= end) {
    months.set(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      { totalInr: 0, txCount: 0 }
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const t of monthlyTxs) {
    const d = t.occurredAt;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const r = months.get(k);
    if (r) {
      r.totalInr += Number(t.amount);
      r.txCount++;
    }
  }
  console.log(
    Array.from(months.entries()).map(([month, v]) => ({ month, ...v }))
  );
  console.log();

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
