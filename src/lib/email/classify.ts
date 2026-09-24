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
  // Remaining public sector banks.
  "idbibank",
  "indianbank",
  "centralbankofindia",
  "ucobank",
  "bankofmaharashtra",
  "mahabank",
  "punjabandsindbank",
  // Remaining private banks. Foreign banks operating in India are anchored on
  // "@" because their domains are short enough to appear inside an unrelated
  // one — the same trap that a bare "google.com" fell into above.
  "karnatakabank",
  "kvb.co.in",
  "southindianbank",
  "csb.co.in",
  "cityunionbank",
  "jkbank",
  "standardchartered",
  "@dbs.com",
  // Small finance banks.
  "equitas",
  "ujjivan",
  "janabank",
  "suryoday",
  "esafbank",
  // Payments banks. "airtelbank", not "airtel": the latter would match every
  // mobile bill and recharge receipt Airtel sends.
  "airtelbank",
  "jiopaymentsbank",
  "ippbonline",
  "finobank",
  // Neobanks and the newer cards, which send their own alerts rather than the
  // sponsor bank's.
  "fi.money",
  "jupiter.money",
  "sliceit",
  "getonecard",
  "uni.cards",
  "bajajfinserv",
  // UPI / wallets
  "phonepe",
  "paytm",
  "googlepay",
  // Narrowed from a bare "google.com": that also matched docs.google.com and
  // comments-noreply@google.com, so anyone who knew the address could push
  // attacker-written text (a doc share, a comment) into the parser's prompt.
  "no-reply@google.com",
  "payments-noreply@google.com",
  "payments.google.com",
  "bhim",
  "cred.club",
  "amazonpay",
  "mobikwik",
  "freecharge",
  // Aggregators / cards
  "hdfcsec",
  "icicidirect",
  "razorpay",
  "billdesk",
];

// Sub-senders that are ALWAYS marketing/newsletters even when the base domain
// is a known bank. Banks blast promos from dedicated communication subdomains
// (HSBC uses custcomm = customer communications, and informationservices for
// research/newsletters) while real transaction alerts come from a separate
// alerts address. Substring match against the from address.
export const MARKETING_SENDER_PATTERNS = [
  "custcomm", // HSBC promos: cmpadh…@custcomm.hsbc.co.in, HSBC@custcomm…
  "informationservices", // HSBC research / market outlook newsletters
  "google-noreply", // Google policy/account notices — GPay receipts use a different sender
  "newsletter",
  "campaign",
  "marketing",
  "promo", // matches promo / promotions / promotional
  "offers",
];

// Positive signal: subject suggests an actual transaction event — either
// money out (debits) OR money in (credits / refunds / received).
const TRANSACTION_KEYWORDS =
  /\b(debited|credited|txn|payment|spent|purchase|charged|withdrawal|paid|used|transferred|upi|refund|reversal|received|reversed)\b/i;

// Hard negatives — applied even to known bank senders. Anything matching
// here is reliably non-transactional and saves an LLM call.
const HARD_NEGATIVE_KEYWORDS =
  /\b(otp|verification|verify|newsletter|webinar|congratulations|reward|welcome|economics|outlook|analysis|research|investment weekly|relationship manager|insight|opinion|preview|forecast|mark your calendar|kindly validate|terms of service|privacy policy|policy update)\b/i;

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
  const positive = FINANCIAL_DOMAIN_PATTERNS.map((p) => `from:${p}`).join(" OR ");
  const marketing = MARKETING_SENDER_PATTERNS.map((p) => `from:${p}`).join(" OR ");
  // Keep only real transaction alerts: from a known bank/UPI sender, but NOT
  // from a marketing sub-sender (HSBC custcomm/informationservices, Google
  // policy notices) and not anything Gmail tabbed as Promotions. Bank txn
  // alerts land in Primary/Updates, never Promotions, so this won't drop
  // real transactions.
  return `(${positive}) -(${marketing}) -category:promotions`;
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

  // Marketing sub-senders are never transactions, even from a bank domain
  // (e.g. HSBC blasts promos from custcomm.hsbc.co.in). Reject before anything
  // else so these never reach the LLM.
  if (MARKETING_SENDER_PATTERNS.some((pat) => from.includes(pat))) return false;

  if (HARD_NEGATIVE_KEYWORDS.test(subject)) return false;

  const isFinancialSender = FINANCIAL_DOMAIN_PATTERNS.some((pat) =>
    from.includes(pat)
  );
  if (isFinancialSender) return true;

  if (SOFT_NEGATIVE_KEYWORDS.test(subject)) return false;
  return TRANSACTION_KEYWORDS.test(subject);
}

/**
 * Mail that exists to let someone finish setting forwarding up.
 *
 * Gmail will not forward to an address until it has sent a code there and had
 * it confirmed, and that mail comes from Google rather than a bank — so the
 * transaction filter above discards it, and the person is stuck: the address
 * cannot be verified, so nothing can ever be forwarded to it. The one piece of
 * mail that makes the feature usable was the one piece we threw away.
 *
 * Matched narrowly, on Google's own no-reply sender, because this bypasses the
 * filter that keeps the rest of someone's inbox out of the database.
 */
const VERIFICATION_SENDERS = [
  "forwarding-noreply@google.com",
  "noreply-forwarding@google.com",
];

export function isForwardingVerification(fromAddress: string): boolean {
  const from = (fromAddress ?? "").toLowerCase();
  return VERIFICATION_SENDERS.some((sender) => from.includes(sender));
}
