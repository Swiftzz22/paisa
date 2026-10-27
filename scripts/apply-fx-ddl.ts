/**
 * Add foreign-currency support: four nullable columns on Transaction and the
 * FxRateDay cache table.
 *
 * Purely additive, so the code already in production keeps working against a
 * database that has these — Prisma names its columns explicitly and never
 * notices extras. The reverse is what breaks: deploy code that reads these
 * columns before they exist and every transaction query fails. So, as with the
 * MerchantAlias DDL: run this against local AND Turso before deploying.
 *
 *   npx tsx scripts/apply-fx-ddl.ts          # local dev.db
 *   npx tsx scripts/apply-fx-ddl.ts --turso  # production
 *
 * Safe to run twice: existing columns are skipped, the table is IF NOT EXISTS.
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

const COLUMNS: [name: string, type: string][] = [
  ["originalAmount", "DECIMAL"],
  ["originalCurrency", "TEXT"],
  ["fxRate", "DECIMAL"],
  ["fxRateDate", "TEXT"],
];

async function main() {
  const useTurso = process.argv.includes("--turso");
  const client = useTurso
    ? createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      })
    : createClient({ url: process.env.DATABASE_URL ?? "file:dev.db" });

  const target = useTurso ? "TURSO (production)" : "local dev.db";
  console.log(`applying to ${target}`);

  // SQLite has no ADD COLUMN IF NOT EXISTS, so check first.
  const existing = await client.execute(`PRAGMA table_info("Transaction")`);
  const have = new Set(existing.rows.map((r) => String(r.name)));
  for (const [name, type] of COLUMNS) {
    if (have.has(name)) {
      console.log(`  Transaction.${name} already there`);
      continue;
    }
    await client.execute(`ALTER TABLE "Transaction" ADD COLUMN "${name}" ${type}`);
    console.log(`  added Transaction.${name}`);
  }

  await client.execute(`CREATE TABLE IF NOT EXISTS "FxRateDay" (
     "date" TEXT NOT NULL PRIMARY KEY,
     "rates" TEXT NOT NULL,
     "source" TEXT NOT NULL,
     "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`);
  console.log("  FxRateDay ready");

  const txs = await client.execute(`SELECT COUNT(*) AS n FROM "Transaction"`);
  console.log("transactions still present:", txs.rows[0].n);
  client.close();
}
main();
