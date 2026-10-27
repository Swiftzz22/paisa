/**
 * Add bill splitting: three nullable columns on Transaction and the Person,
 * SplitShare and Settlement tables.
 *
 * Purely additive — no table is rebuilt, nothing existing is touched, and the
 * code already in production never notices. (paidByPersonId is deliberately
 * not a foreign key: in SQLite adding one would mean rebuilding Transaction.)
 * As with every DDL script here: run against local AND Turso *before*
 * deploying code that reads these, never after.
 *
 *   npx tsx scripts/apply-splits-ddl.ts          # local dev.db
 *   npx tsx scripts/apply-splits-ddl.ts --turso  # production
 *
 * Safe to run twice.
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

const COLUMNS: [name: string, type: string][] = [
  ["splitTotal", "DECIMAL"],
  ["splitMode", "TEXT"],
  ["paidByPersonId", "TEXT"],
];

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "Person" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "userId" TEXT NOT NULL,
     "name" TEXT NOT NULL,
     "phone" TEXT,
     "upiId" TEXT,
     "archived" BOOLEAN NOT NULL DEFAULT false,
     "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS "SplitShare" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "transactionId" TEXT NOT NULL,
     "personId" TEXT,
     "amount" DECIMAL NOT NULL,
     "weight" DECIMAL NOT NULL,
     CONSTRAINT "SplitShare_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
     CONSTRAINT "SplitShare_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS "Settlement" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "userId" TEXT NOT NULL,
     "personId" TEXT NOT NULL,
     "amount" DECIMAL NOT NULL,
     "direction" TEXT NOT NULL,
     "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "note" TEXT,
     "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "Settlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
     CONSTRAINT "Settlement_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "Person_userId_idx" ON "Person"("userId")`,
  `CREATE INDEX IF NOT EXISTS "SplitShare_transactionId_idx" ON "SplitShare"("transactionId")`,
  `CREATE INDEX IF NOT EXISTS "SplitShare_personId_idx" ON "SplitShare"("personId")`,
  `CREATE INDEX IF NOT EXISTS "Settlement_userId_idx" ON "Settlement"("userId")`,
  `CREATE INDEX IF NOT EXISTS "Settlement_personId_idx" ON "Settlement"("personId")`,
];

async function main() {
  const useTurso = process.argv.includes("--turso");
  const client = useTurso
    ? createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      })
    : createClient({ url: process.env.DATABASE_URL ?? "file:dev.db" });

  console.log(`applying to ${useTurso ? "TURSO (production)" : "local dev.db"}`);

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
  for (const sql of STATEMENTS) await client.execute(sql);
  console.log("  Person, SplitShare, Settlement ready");

  const txs = await client.execute(`SELECT COUNT(*) AS n FROM "Transaction"`);
  console.log("transactions still present:", txs.rows[0].n);
  client.close();
}
main();
