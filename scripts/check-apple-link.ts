/**
 * Who would the new Apple email-match rule recognise?
 *
 * Read-only. Prints, for every account, whether a Sign in with Apple carrying
 * that verified real address would now land in it rather than making a second
 * empty account — and flags the rows where email casing would have made the
 * lookup miss.
 *
 *   npx tsx scripts/check-apple-link.ts          # local dev.db
 *   npx tsx scripts/check-apple-link.ts --turso  # production
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

  console.log(useTurso ? "→ Turso (production)" : "→ local dev.db");

  const res = await client.execute(
    `SELECT email, name, googleSub, appleSub FROM "User" ORDER BY createdAt`
  );

  for (const r of res.rows) {
    const email = String(r.email);
    const hasGoogle = r.googleSub !== null;
    const hasApple = r.appleSub !== null;
    const placeholder = email.endsWith("@appleid.local");
    const mixedCase = email !== email.toLowerCase();

    const verdict = placeholder
      ? "placeholder — Apple shell, not matchable"
      : hasApple
        ? "already has an Apple ID — left alone"
        : hasGoogle
          ? "WOULD LINK on a verified real address"
          : "no googleSub — not matchable";

    console.log(
      `  ${email.padEnd(38)} google=${hasGoogle ? "y" : "-"} apple=${hasApple ? "y" : "-"}` +
        `${mixedCase ? " [MIXED CASE]" : ""}  ${verdict}`
    );
  }
  console.log(`\n${res.rows.length} account(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
