/**
 * Give every account that existed before the paywall permanent paisa. plus.
 *
 * These are the people who used paisa. when it had no business model. Taking a
 * feature away from them to maybe earn a subscription is a bad trade at any
 * scale, and at this one it is a handful of accounts costing almost nothing.
 *
 * Run once, immediately after the guards ship — until it runs, everyone who
 * already had Gmail sync is locked out of it.
 *
 *   npx tsx scripts/grant-founding-plus.ts          # local dev.db
 *   npx tsx scripts/grant-founding-plus.ts --turso  # production
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

/** Far enough away to mean "forever" without needing a nullable special case. */
const FOREVER = "2099-12-31T00:00:00.000Z";

async function main() {
  const useTurso = process.argv.includes("--turso");
  const client = useTurso
    ? createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      })
    : createClient({ url: process.env.DATABASE_URL ?? "file:dev.db" });

  console.log(useTurso ? "→ Turso (production)" : "→ local dev.db");

  const before = await client.execute(
    `SELECT email, plusUntil FROM "User" ORDER BY createdAt`
  );
  for (const r of before.rows) {
    console.log(`  ${String(r.email).padEnd(40)} plusUntil=${r.plusUntil ?? "null"}`);
  }

  // Only accounts with nothing set. Re-running must never overwrite a real
  // subscription's expiry with FOREVER.
  const res = await client.execute({
    sql: `UPDATE "User" SET plusUntil = ? WHERE plusUntil IS NULL`,
    args: [FOREVER],
  });
  console.log(`\ngranted to ${res.rowsAffected} account(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
