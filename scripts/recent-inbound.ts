/**
 * What has arrived lately, and what became of it.
 *
 * Read-only. Prints the most recent stored emails with their parse status, so
 * a forwarded alert can be traced without digging through request logs.
 *
 *   npx tsx scripts/recent-inbound.ts --turso
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const useTurso = process.argv.includes("--turso");
  const client = useTurso
    ? createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      })
    : createClient({ url: process.env.DATABASE_URL ?? "file:dev.db" });

  const emails = await client.execute(
    `SELECT fromAddress, subject, parseStatus, receivedAt, createdAt
       FROM "ReceivedEmail" ORDER BY createdAt DESC LIMIT 12`
  );
  console.log(`--- ${emails.rows.length} most recent stored emails ---`);
  for (const r of emails.rows) {
    console.log(
      `${String(r.createdAt).slice(0, 19)}  ${String(r.parseStatus).padEnd(8)} ${String(r.fromAddress).slice(0, 46).padEnd(46)} ${String(r.subject).slice(0, 60)}`
    );
  }

  const tx = await client.execute(
    `SELECT occurredAt, merchant, amount, type, source FROM "Transaction"
      ORDER BY createdAt DESC LIMIT 6`
  );
  console.log(`\n--- ${tx.rows.length} most recent transactions ---`);
  for (const r of tx.rows) {
    console.log(
      `${String(r.occurredAt).slice(0, 10)}  ${String(r.type).padEnd(6)} ${String(r.amount).padEnd(10)} ${String(r.merchant).slice(0, 40).padEnd(40)} ${r.source ?? ""}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
