/**
 * Add the billing columns and the usage counter table.
 *
 * Applied as DDL rather than through `prisma migrate` because this project's
 * migrations folder has drifted from the live schema, and `migrate dev` wants
 * to reset the database to reconcile it. Run against local AND Turso before
 * deploying code that reads them — shipping the code first is what took
 * production down once already.
 *
 *   npx tsx scripts/apply-billing-ddl.ts          # local dev.db
 *   npx tsx scripts/apply-billing-ddl.ts --turso  # production
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so the column adds are checked
 * against PRAGMA first rather than guarded by syntax. Everything else is
 * idempotent on its own.
 */
const NEW_COLUMNS: { name: string; ddl: string }[] = [
  { name: "plusUntil", ddl: `ALTER TABLE "User" ADD COLUMN "plusUntil" DATETIME` },
  {
    name: "billingCustomerId",
    ddl: `ALTER TABLE "User" ADD COLUMN "billingCustomerId" TEXT`,
  },
];

const STATEMENTS = [
  // Unique, but as an index rather than a column constraint: SQLite cannot add
  // a UNIQUE column to an existing table, and Prisma reads the index anyway.
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_billingCustomerId_key"
     ON "User"("billingCustomerId")`,
  `CREATE TABLE IF NOT EXISTS "UsageCounter" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "userId" TEXT NOT NULL,
     "month" TEXT NOT NULL,
     "kind" TEXT NOT NULL,
     "used" INTEGER NOT NULL DEFAULT 0,
     CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId")
       REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UsageCounter_userId_month_kind_key"
     ON "UsageCounter"("userId", "month", "kind")`,
  `CREATE INDEX IF NOT EXISTS "UsageCounter_userId_idx"
     ON "UsageCounter"("userId")`,
];

async function main() {
  const useTurso = process.argv.includes("--turso");
  const client = useTurso
    ? createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      })
    : createClient({ url: process.env.DATABASE_URL ?? "file:dev.db" });

  console.log(useTurso ? "→ Turso (production)" : "→ local dev.db");

  const info = await client.execute(`PRAGMA table_info("User")`);
  const existing = new Set(info.rows.map((r) => String(r.name)));

  for (const col of NEW_COLUMNS) {
    if (existing.has(col.name)) {
      console.log(`  User.${col.name} already present`);
      continue;
    }
    await client.execute(col.ddl);
    console.log(`  User.${col.name} added`);
  }

  for (const sql of STATEMENTS) {
    await client.execute(sql);
    console.log(`  ok: ${sql.replace(/\s+/g, " ").slice(0, 64)}…`);
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
