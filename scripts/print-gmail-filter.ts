/**
 * Print the Gmail search to build a forwarding filter from.
 *
 * Read out of classify.ts rather than imported, because that module is marked
 * server-only and refuses to load outside Next. Same single source of truth
 * either way: a bank added to the classifier appears here too, so the filter
 * and the parser cannot drift apart.
 *
 *   npx tsx scripts/print-gmail-filter.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Comments go first, and that is not tidiness.
 *
 * These arrays are heavily commented, and several comments quote a domain to
 * explain why it is NOT matched — a bare "google.com", an "airtel" that would
 * catch every mobile bill. Read naively, those quotes become entries, and the
 * filter forwards exactly what the comment was warning against.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function arrayOf(source: string, name: string): string[] {
  const match = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(
    stripComments(source)
  );
  if (!match) throw new Error(`Could not find ${name} in classify.ts`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

const source = readFileSync(
  join(process.cwd(), "src/lib/email/classify.ts"),
  "utf8"
);

// "@dbs.com" is anchored for substring matching on the server; Gmail matches
// sender text directly, where the "@" only gets in the way.
const senders = arrayOf(source, "FINANCIAL_DOMAIN_PATTERNS").map((p) =>
  p.replace(/^@/, "")
);
const marketing = arrayOf(source, "MARKETING_SENDER_PATTERNS");

console.log(
  `from:(${senders.join(" OR ")}) -from:(${marketing.join(" OR ")}) -category:promotions`
);
console.log(
  `\n${senders.length} senders, ${marketing.length} excluded sub-senders`
);
