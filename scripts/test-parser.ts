import * as fs from "node:fs";
import * as XLSX from "xlsx";

const FILE = "C:\\Users\\sania\\Downloads\\Acct Statement_5571_18052026_15.53.24.xls";

// Inline copy of the parser (avoid `server-only` import).
type ParsedRow = {
  date: Date;
  narration: string;
  merchant: string;
  externalId: string;
  paymentMode: "upi";
  amount: number;
};

function parseHdfcDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const d = new Date(year, month, day, 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAmount(s: string): number {
  const cleaned = s.replace(/,/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function cleanMerchant(narration: string): string {
  let s = narration.replace(/^UPI-/i, "");
  const parts = s.split("-");
  const merchantParts: string[] = [];
  for (const p of parts) {
    if (p.includes("@")) break;
    merchantParts.push(p);
  }
  s = (merchantParts.join("-") || parts[0] || "").trim();
  if (s === s.toUpperCase()) {
    s = s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return s.trim();
}

function main() {
  const buf = fs.readFileSync(FILE);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1, raw: false, defval: null,
  });

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (
      Array.isArray(row) && row[0] === "Date" && row[1] === "Narration" &&
      typeof row[4] === "string" && row[4].toLowerCase().includes("withdrawal")
    ) { headerIdx = i; break; }
  }
  if (headerIdx < 0) { console.log("Header not found"); return; }

  const parsed: ParsedRow[] = [];
  const skipped: Array<{ reason: string; row: unknown[] }> = [];

  for (let i = headerIdx + 2; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.every((c) => c == null || c === "")) continue;
    const [dateRaw, narrationRaw, refRaw, , withdrawalRaw] = row;
    const narration = typeof narrationRaw === "string" ? narrationRaw.trim() : "";
    const withdrawalStr = withdrawalRaw == null ? "" : String(withdrawalRaw).trim();
    if (!withdrawalStr) { skipped.push({ reason: "credit", row }); continue; }
    if (!narration.toUpperCase().startsWith("UPI-")) { skipped.push({ reason: "non-UPI", row }); continue; }
    const date = parseHdfcDate(typeof dateRaw === "string" ? dateRaw : "");
    if (!date) { skipped.push({ reason: "bad date", row }); continue; }
    const amount = parseAmount(withdrawalStr);
    if (!(amount > 0)) { skipped.push({ reason: "bad amount", row }); continue; }
    const externalId = (typeof refRaw === "string" ? refRaw.trim() : String(refRaw ?? "")).trim();
    if (!externalId) { skipped.push({ reason: "no ref", row }); continue; }
    parsed.push({
      date, narration, merchant: cleanMerchant(narration),
      externalId, paymentMode: "upi", amount,
    });
  }

  console.log(`Parsed ${parsed.length} UPI debit rows. Skipped ${skipped.length}.\n`);
  console.log("First 15 parsed:");
  for (const p of parsed.slice(0, 15)) {
    console.log(`  ${p.date.toISOString().slice(0, 10)}  ₹${p.amount.toString().padStart(8)}  [${p.externalId.slice(-12)}]  ${p.merchant}`);
  }
  console.log("\nLast 5 parsed:");
  for (const p of parsed.slice(-5)) {
    console.log(`  ${p.date.toISOString().slice(0, 10)}  ₹${p.amount.toString().padStart(8)}  [${p.externalId.slice(-12)}]  ${p.merchant}`);
  }

  // Skip reasons summary
  const skipReasons = new Map<string, number>();
  for (const s of skipped) {
    skipReasons.set(s.reason, (skipReasons.get(s.reason) ?? 0) + 1);
  }
  console.log("\nSkip reasons:");
  for (const [r, n] of skipReasons) console.log(`  ${n} × ${r}`);
}

main();
