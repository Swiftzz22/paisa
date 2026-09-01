/**
 * Create the MerchantAlias table.
 *
 * Applied as DDL rather than through `prisma migrate` because this project's
 * migrations folder has drifted from the live schema, and `migrate dev` wants
 * to reset the database to reconcile it. Run against local AND Turso before
 * deploying code that reads the table — shipping the code first is what took
 * production down once already.
 *
 *   npx tsx scripts/apply-merchant-alias-ddl.ts          # local dev.db
 *   npx tsx scripts/apply-merchant-alias-ddl.ts --turso  # production
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "MerchantAlias" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "userId" TEXT NOT NULL,
     "matchValue" TEXT NOT NULL,
     "displayName" TEXT NOT NULL,
     "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" DATETIME NOT NULL,
     CONSTRAINT "MerchantAlias_userId_fkey" FOREIGN KEY ("userId")
       REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MerchantAlias_userId_matchValue_key"
     ON "MerchantAlias"("userId", "matchValue")`,
  `CREATE INDEX IF NOT EXISTS "MerchantAlias_userId_idx"
     ON "MerchantAlias"("userId")`,
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

  for (const sql of STATEMENTS) {
    await client.execute(sql);
  }

  const cols = await client.execute(`PRAGMA table_info("MerchantAlias")`);
  console.log("columns:", cols.rows.map((r) => r.name).join(", "));
  const count = await client.execute(`SELECT COUNT(*) AS n FROM "MerchantAlias"`);
  console.log("rows:", count.rows[0].n);
  const txs = await client.execute(`SELECT COUNT(*) AS n FROM "Transaction"`);
  console.log("transactions still present:", txs.rows[0].n);
  client.close();
}
main();
