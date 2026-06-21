import "server-only";

// Domains we know send Indian bank / UPI / card transaction notifications.
// Substring match against the from address — generous on purpose, the LLM
// is the final judge.
export const FINANCIAL_DOMAIN_PATTERNS = [
  // Banks
  "hdfcbank",
  "icicibank",
  "sbi.co.in",
  "alerts.sbi",
  "sbicard",
  "axisbank",
  "kotak",
  "hsbc",
  "amex",
  "americanexpress",
  "citibank",
  "idfc",
  "yesbank",
  "rbl",
  "indusind",
  "federalbank",
  "bandhanbank",
  "boi.co.in",
  "bankofbaroda",
  "pnbindia",
  "canarabank",
  "unionbankofindia",
  "iob.in",
  "aubank",
  "dcbbank",
  // UPI / wallets
  "phonepe",
  "paytm",
  "googlepay",
  "google.com", // GPay receipts come from no-reply@google.com
  "bhim",
  "cred.club",
  "amazonpay",
  // Aggregators / cards
  "hdfcsec",
  "icicidirect",
  "razorpay",
  "billdesk",
];

// Positive signal: subject suggests an actual transaction event — either
// money out (debits) OR money in (credits / refunds / received).
const TRANSACTION_KEYWORDS =
  /\b(debited|credited|txn|payment|spent|purchase|charged|withdrawal|paid|used|transferred|upi|refund|reversal|received|reversed)\b/i;

// Hard negatives — applied even to known bank senders. Anything matching
// here is reliably non-transactional and saves an LLM call.
const HARD_NEGATIVE_KEYWORDS =
  /\b(otp|verification|verify|newsletter|webinar|congratulations|reward|welcome|economics|outlook|analysis|research|investment weekly|relationship manager|insight|opinion|preview|forecast|mark your calendar|kindly validate)\b/i;

// Soft negatives — additional filters for emails from UNKNOWN senders. These
// terms are too aggressive for bank emails (HDFC uses "Account update" for
// real credit/debit notifications) but help filter promos from non-bank
// senders that somehow slipped past the Gmail-side filter.
const SOFT_NEGATIVE_KEYWORDS =
  /\b(statement|reminder|offer|exclusive|usage|miss|monthly|premier|holding|important update)\b/i;

// Positive signal — used only when the sender ISN'T a known financial domain.

/**
 * Build a Gmail `q:` filter that matches only emails from our known financial
 * senders. Used to skip promos / newsletters / OTPs before they even hit our
 * server. Result looks like: `from:(hdfcbank OR icicibank OR hsbc OR ...)`.
 */
export function buildFinancialSenderQuery(): string {
  const tokens = FINANCIAL_DOMAIN_PATTERNS.map((p) => `from:${p}`);
  return `(${tokens.join(" OR ")})`;
}

/**
 * Cheap pre-filter to decide whether an email is worth sending to the LLM.
 *
 * - Known financial senders (hdfcbank, icicibank, hsbc, …) pass through unless
 *   the subject matches a HARD negative (OTP / newsletter / etc.). Bank emails
 *   use phrasing like "View: Account update for your HDFC Bank A/c" for real
 *   credit/debit notifications — we trust the LLM to discern.
 * - Unknown senders are gated by SOFT negatives + a positive keyword.
 */
export function looksLikeTransactionEmail(params: {
  fromAddress: string;
  subject: string;
}): boolean {
  const subject = params.subject ?? "";
  const from = (params.fromAddress ?? "").toLowerCase();

  if (HARD_NEGATIVE_KEYWORDS.test(subject)) return false;

  const isFinancialSender = FINANCIAL_DOMAIN_PATTERNS.some((pat) =>
    from.includes(pat)
  );
  if (isFinancialSender) return true;

  if (SOFT_NEGATIVE_KEYWORDS.test(subject)) return false;
  return TRANSACTION_KEYWORDS.test(subject);
}
