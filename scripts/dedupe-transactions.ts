/**
 * Find and remove duplicate transactions.
 *
 * Duplicate = same user + same type (debit/credit) + same amount + same
 * calendar day + similar merchant (fuzzy: either is substring of the other,
 * case/punctuation-insensitive, length ≥ 3).
 *
 * For each cluster, keep the most informative row and delete the rest:
 *   1. Prefer the row with an externalId (statement ref / Gmail msg id).
 *   2. Then prefer email-sourced (has emailId — links to the source).
 *   3. Then prefer the oldest createdAt (the row we logged first).
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

type Row = {
  id: string;
  userId: string;
  occurredAt: Date;
  merchant: string;
  amount: number;
  type: string;
  source: string;
  externalId: string | null;
  emailId: string | null;
  createdAt: Date;
};

function normMerchant(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fuzzyMatch(a: string, b: string): boolean {
  const na = normMerchant(a);
  const nb = normMerchant(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  return shorter.length >= 3 && longer.includes(shorter);
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function rank(t: Row): number {
  // Lower rank = preferred (kept).
  if (t.externalId) return 0;
  if (t.emailId) return 1;
  return 2;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });

  const txs = (await prisma.transaction.findMany({
    select: {
      id: true,
      userId: true,
      occurredAt: true,
      merchant: true,
      amount: true,
      type: true,
      source: true,
      externalId: true,
      emailId: true,
      createdAt: true,
    },
  })).map((t) => ({ ...t, amount: Number(t.amount) })) as Row[];

  console.log(`Scanning ${txs.length} transactions for duplicates...\n`);

  // Bucket by (userId, type, amount.toFixed(2), day) for cheap candidate match.
  const buckets = new Map<string, Row[]>();
  for (const t of txs) {
    const k = `${t.userId}|${t.type}|${t.amount.toFixed(2)}|${dayKey(t.occurredAt)}`;
    const arr = buckets.get(k) ?? [];
    arr.push(t);
    buckets.set(k, arr);
  }

  // Within each bucket, group by fuzzy merchant match.
  const toDelete: Row[] = [];
  const clusters: Array<{ keep: Row; remove: Row[] }> = [];

  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    const used = new Set<string>();
    for (let i = 0; i < arr.length; i++) {
      if (used.has(arr[i].id)) continue;
      const cluster = [arr[i]];
      used.add(arr[i].id);
      for (let j = i + 1; j < arr.length; j++) {
        if (used.has(arr[j].id)) continue;
        if (fuzzyMatch(arr[i].merchant, arr[j].merchant)) {
          cluster.push(arr[j]);
          used.add(arr[j].id);
        }
      }
      if (cluster.length > 1) {
        cluster.sort((a, b) => {
          const r = rank(a) - rank(b);
          if (r !== 0) return r;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });
        const [keep, ...rest] = cluster;
        clusters.push({ keep, remove: rest });
        toDelete.push(...rest);
      }
    }
  }

  if (clusters.length === 0) {
    console.log("No duplicates found. ✓");
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${clusters.length} duplicate clusters (${toDelete.length} rows to remove):\n`);
  for (const c of clusters.slice(0, 30)) {
    const date = c.keep.occurredAt.toISOString().slice(0, 10);
    const sign = c.keep.type === "credit" ? "+" : "-";
    console.log(`  ${date} ${sign}₹${c.keep.amount.toString().padStart(8)}  ${c.keep.merchant}`);
    console.log(`    KEEP   [${c.keep.source}] ${c.keep.id.slice(0, 8)} (ext=${c.keep.externalId?.slice(0, 12) ?? "—"})`);
    for (const r of c.remove) {
      console.log(`    DELETE [${r.source}] ${r.id.slice(0, 8)} merchant="${r.merchant}"`);
    }
  }
  if (clusters.length > 30) {
    console.log(`\n  ... ${clusters.length - 30} more clusters`);
  }

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to delete the ${toDelete.length} duplicate rows.`);
    await prisma.$disconnect();
    return;
  }

  // Apply: delete in chunks. ExpenseLines cascade via the FK.
  const ids = toDelete.map((t) => t.id);
  const result = await prisma.transaction.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDeleted ${result.count} duplicate transactions.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
