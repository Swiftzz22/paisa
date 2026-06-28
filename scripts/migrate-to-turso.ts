/**
 * One-shot migration: local SQLite (dev.db) → Turso/libSQL.
 *
 *   1. (Re)create the full schema on Turso from scripts/turso-schema.sql.
 *   2. Copy every row, table by table, in FK-safe order. Raw value pass-through
 *      (both ends are SQLite storage) so dates/decimals/booleans stay faithful.
 *   3. Verify source vs destination row counts.
 *
 * Idempotent: drops + recreates the tables each run, so re-running fully
 * refreshes Turso from the local file. The local dev.db is read-only here and
 * left untouched (your backup).
 *
 *   npx tsx scripts/migrate-to-turso.ts
 */
import "dotenv/config";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";

// FK-safe insert order. Category is self-referential (parentId), handled below.
const TABLE_ORDER = [
  "User",
  "Category",
  "PaymentMode",
  "EmailAccount",
  "ImportBatch",
  "ReceivedEmail",
  "Session",
  "Budget",
  "CategorizationRule",
  "Transaction",
  "ExpenseLine",
] as const;

function localDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (!tursoUrl) throw new Error("TURSO_DATABASE_URL not set");

  // ---- source (local SQLite, read-only) ----
  const src = new Database(localDbPath(), { readonly: true });

  // ---- destination (Turso) ----
  const dst = createClient({ url: tursoUrl, authToken: tursoToken });

  // ---- 1. (re)create schema ----
  let ddl = fs.readFileSync("scripts/turso-schema.sql", "utf8");
  if (ddl.charCodeAt(0) === 0xfeff) ddl = ddl.slice(1); // strip BOM

  console.log("Dropping existing tables on Turso (if any)…");
  // Drop in reverse FK order.
  for (const t of [...TABLE_ORDER].reverse()) {
    await dst.execute(`DROP TABLE IF EXISTS "${t}"`);
  }
  console.log("Creating schema on Turso…");
  await dst.executeMultiple(ddl);

  // ---- 2. copy data ----
  let grandTotal = 0;
  for (const table of TABLE_ORDER) {
    let rows = src.prepare(`SELECT * FROM "${table}"`).all() as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows`);
      continue;
    }
    // Category self-reference: insert top-level (parentId null) before children.
    if (table === "Category") {
      rows = [
        ...rows.filter((r) => r.parentId == null),
        ...rows.filter((r) => r.parentId != null),
      ];
    }

    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map(() => "?").join(", ");
    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;

    // Batch in chunks to keep request sizes reasonable.
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const stmts = slice.map((r) => ({
        sql,
        args: cols.map((c) => (r[c] === undefined ? null : r[c])) as never,
      }));
      await dst.batch(stmts, "write");
    }
    console.log(`  ${table}: ${rows.length} rows ✓`);
    grandTotal += rows.length;
  }

  // ---- 3. verify counts ----
  console.log("\nVerifying row counts (source → dest):");
  let mismatches = 0;
  for (const table of TABLE_ORDER) {
    const s = (
      src.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }
    ).c;
    const dRes = await dst.execute(`SELECT COUNT(*) AS c FROM "${table}"`);
    const d = Number(dRes.rows[0].c);
    const ok = s === d;
    if (!ok) mismatches++;
    console.log(`  ${table.padEnd(20)} ${s} → ${d} ${ok ? "✓" : "✗ MISMATCH"}`);
  }

  src.close();
  console.log(
    `\n${mismatches === 0 ? "✅ all tables match" : `❌ ${mismatches} mismatched`} · ${grandTotal} rows copied`
  );
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
