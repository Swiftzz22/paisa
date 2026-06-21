import "server-only";
import * as XLSX from "xlsx";

export type ParsedRow = {
  /** Calendar date the transaction occurred (00:00 local). */
  date: Date;
  /** Raw narration column, kept for reference. */
  narration: string;
  /** Cleaned merchant name extracted from the narration. */
  merchant: string;
  /** Unique reference number from the statement — used as external_id for dedup. */
  externalId: string;
  /** Always 'upi' for v1; we only parse UPI rows. */
  paymentMode: "upi";
  /** Amount in INR (positive number — sign comes from `type`). */
  amount: number;
  /** Spending (debit) or income (credit). */
  type: "debit" | "credit";
};

export type ParseStatementResult = {
  bank: "HDFC" | "UNKNOWN";
  totalRows: number;
  upiDebits: number;
  upiCredits: number;
  parsed: ParsedRow[];
  skipped: Array<{ reason: string; row: unknown[] }>;
};

/**
 * Parse an HDFC bank statement (.xls) and return the UPI debit rows.
 * Non-UPI rows (NEFT, IMPS, ATM, etc.) and credits are skipped — by design,
 * since v1 covers UPI only (per user spec).
 */
export function parseHdfcStatement(buffer: Buffer): ParseStatementResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  // Find the header row (the one with "Date" + "Narration" + "Withdrawal Amt.").
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (
      Array.isArray(row) &&
      row[0] === "Date" &&
      row[1] === "Narration" &&
      typeof row[4] === "string" &&
      row[4].toLowerCase().includes("withdrawal")
    ) {
      headerIdx = i;
      break;
    }
  }

  const result: ParseStatementResult = {
    bank: headerIdx >= 0 ? "HDFC" : "UNKNOWN",
    totalRows: 0,
    upiDebits: 0,
    upiCredits: 0,
    parsed: [],
    skipped: [],
  };

  if (headerIdx < 0) return result;

  // Skip the separator row right after the header.
  const dataStart = headerIdx + 2;
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.every((c) => c == null || c === "")) continue;

    result.totalRows++;
    const [dateRaw, narrationRaw, refRaw, , withdrawalRaw, depositRaw] = row;
    const narration = typeof narrationRaw === "string" ? narrationRaw.trim() : "";
    const withdrawalStr = withdrawalRaw == null ? "" : String(withdrawalRaw).trim();
    const depositStr = depositRaw == null ? "" : String(depositRaw).trim();

    const isDebit = !!withdrawalStr;
    const isCredit = !isDebit && !!depositStr;
    if (!isDebit && !isCredit) {
      result.skipped.push({ reason: "No amount", row });
      continue;
    }

    const isUpi = narration.toUpperCase().startsWith("UPI-");
    // For now, only UPI rows are parsed — for both debits and credits. NEFT/IMPS
    // and IB Funds Transfer credits are skipped (could be added later).
    if (!isUpi) {
      result.skipped.push({ reason: "Not a UPI row", row });
      continue;
    }

    const date = parseHdfcDate(typeof dateRaw === "string" ? dateRaw : "");
    if (!date) {
      result.skipped.push({ reason: "Unparseable date", row });
      continue;
    }

    const amount = parseAmount(isDebit ? withdrawalStr : depositStr);
    if (!(amount > 0)) {
      result.skipped.push({ reason: "Unparseable amount", row });
      continue;
    }

    const externalId = (typeof refRaw === "string" ? refRaw.trim() : String(refRaw ?? "")).trim();
    if (!externalId) {
      result.skipped.push({ reason: "Missing reference number", row });
      continue;
    }

    result.parsed.push({
      date,
      narration,
      merchant: cleanMerchant(narration),
      externalId,
      paymentMode: "upi",
      amount,
      type: isDebit ? "debit" : "credit",
    });
    if (isDebit) result.upiDebits++;
    else result.upiCredits++;
  }

  return result;
}

/** HDFC dates are "DD/MM/YY" (or sometimes DD/MM/YYYY). */
function parseHdfcDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const d = new Date(year, month, day, 12, 0, 0, 0); // noon to avoid TZ drift
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAmount(s: string): number {
  const cleaned = s.replace(/,/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Extract a usable merchant name from the HDFC narration.
 * Format: "UPI-MERCHANT NAME-vpa@bank-IFSC-REF#-DESCRIPTION"
 * We take the part right after "UPI-" up to the first dash that's followed by
 * a vpa-shaped token (text@text).
 */
function cleanMerchant(narration: string): string {
  // Strip prefix.
  let s = narration.replace(/^UPI-/i, "");

  // Split on "-" then find the first segment that looks like a vpa (contains "@")
  // and take everything before it.
  const parts = s.split("-");
  const merchantParts: string[] = [];
  for (const p of parts) {
    if (p.includes("@")) break;
    merchantParts.push(p);
  }
  s = (merchantParts.join("-") || parts[0] || "").trim();

  // Final tidy: title-case if it's ALL CAPS (HDFC narrations usually are).
  if (s === s.toUpperCase()) {
    s = s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return s.trim();
}
