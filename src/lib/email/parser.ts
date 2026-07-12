import "server-only";
import { GoogleGenAI, Type } from "@google/genai";

// gemini-2.5-flash-lite has separate (more generous) free-tier quota than
// gemini-2.5-flash, which we burned through earlier with retry loops.
// Quality is fine for short structured-extraction tasks like bank emails.
// gemini-2.0-flash: free-tier, stable (2.5-flash-lite was 503-ing under load),
// and strong at the structured JSON extraction this path relies on.
const MODEL = "gemini-2.0-flash";

// Throttle between calls. With batching of up to BATCH_SIZE emails per call,
// 4.5s between calls = ~13 calls/min × 5 emails = ~65 emails/min effective.
const MIN_INTERVAL_MS = 4500;
let lastCallAt = 0;

/** Max emails sent in a single Gemini request. */
export const BATCH_SIZE = 10;

async function throttle(minIntervalMs: number = MIN_INTERVAL_MS): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < minIntervalMs) {
    await new Promise((resolve) =>
      setTimeout(resolve, minIntervalMs - elapsed)
    );
  }
  lastCallAt = Date.now();
}

/** Thrown when Gemini returns 429 and patient retry didn't recover. */
export class GeminiRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Gemini rate limited; retry after ${retryAfterSeconds}s`);
    this.name = "GeminiRateLimitError";
  }
}

function parseRetryAfter(msg: string): number | null {
  const sMatch = /retry in ([\d.]+)s/i.exec(msg);
  if (sMatch) return Math.ceil(parseFloat(sMatch[1]));
  const msMatch = /retry in ([\d.]+)ms/i.exec(msg);
  if (msMatch) return Math.ceil(parseFloat(msMatch[1]) / 1000);
  if (/"code":\s*429|RESOURCE_EXHAUSTED/.test(msg)) return 30;
  return null;
}

/**
 * Wait patiently through Gemini rate limits. On 429, sleep for the
 * server-suggested retry-after (capped at 90s) and try again, up to
 * 3 attempts total. Only throws GeminiRateLimitError if every attempt
 * still hits 429 — at which point the daily quota is probably exhausted.
 */
export async function callGeminiWithBackoff<T>(
  makeRequest: () => Promise<T>,
  opts?: { maxAttempts?: number; minIntervalMs?: number }
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  let lastRetrySec = 60;
  let overloadRetries = 0;
  const MAX_OVERLOAD_RETRIES = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await throttle(opts?.minIntervalMs);
    try {
      return await makeRequest();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Transient model overload (503 UNAVAILABLE / "high demand") — Google-side
      // spikes that are usually brief. Retry quickly a couple of times without
      // consuming the rate-limit attempt budget; if it persists, surface a clean
      // message instead of the raw error JSON.
      if (/\b503\b|UNAVAILABLE|overloaded|high demand/i.test(msg)) {
        if (overloadRetries < MAX_OVERLOAD_RETRIES) {
          overloadRetries++;
          attempt--;
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw new Error(
          "The AI model is briefly overloaded on Google's side. Please try again in a few seconds."
        );
      }
      const retrySec = parseRetryAfter(msg);
      if (retrySec === null) throw e; // not a 429 — propagate as a real error
      lastRetrySec = retrySec;
      if (attempt === maxAttempts) break;
      const sleepMs = Math.min(retrySec + 3, 90) * 1000;
      console.log(
        `[gemini] 429 (attempt ${attempt}/${maxAttempts}), waiting ${sleepMs}ms`
      );
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }
  throw new GeminiRateLimitError(lastRetrySec);
}

export type ExtractedTransaction = {
  is_transaction: boolean;
  amount_inr: number | null;
  merchant: string | null;
  payment_mode: "card" | "upi" | "bank_transfer" | null;
  transacted_at: string | null; // ISO 8601 date
  note: string | null;
  category_label: string | null; // matches one of the labels we sent in
  kind: "debit" | "credit"; // 'debit' = spending; 'credit' = refund / money received
};

export type EmailInput = {
  id: string; // our DB id; used to map results back to the right email
  fromAddress: string;
  subject: string;
  bodyText: string | null;
  rawHtml: string;
  emailReceivedAt: Date;
};

export type BatchExtraction = ExtractedTransaction & { email_id: string };

export type CategoryChoice = {
  /** Label as shown to the LLM (e.g. "Food › Coffee" or "Entertainment"). */
  label: string;
  /** ID we map back to after the LLM picks. */
  id: string;
};

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey"
    );
  }
  return new GoogleGenAI({ apiKey });
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GEMINI_API_KEY);
}

const BASE_PROMPT = `You are extracting Indian bank, UPI, or credit/debit card transaction
details from multiple emails IN ONE CALL. Reply with a JSON array — one
object per input email, in the same order — and treat each email
INDEPENDENTLY.

Rules for extraction:
- Set is_transaction=true if the email reports an ACTUAL completed transaction
  on the user's account — BOTH spending events AND incoming money count:
   * kind="debit" — the user paid something (UPI payment, card swipe, account
     debit, money sent).
   * kind="credit" — money arrived for the user (refund from a merchant,
     reversal of a previous charge, UPI/IMPS/NEFT credit, salary, allowance).
  Set is_transaction=false ONLY for: OTPs, statements, marketing, low-balance
  alerts, scheduled-payment reminders, balance enquiries, fraud alerts that
  don't represent a real money movement.
- amount_inr is the absolute rupee value of the movement (always positive —
  the direction comes from "kind").
- merchant: cleaned name of the OTHER party.
   * For debits: where the user paid (e.g. "Swiggy", "Uber", "Big Bazaar").
   * For credits: who paid the user (e.g. "Amazon refund", "Spotify refund",
     "Ashish Kothari" for a family transfer, "Salary" if obvious).
   * For UPI to/from a person's name (e.g. "SIDDHANT KEDIA") keep Title Case.
   * For UPI handles like "name@paytm" use the business name if discernible.
- payment_mode:
   "upi" for UPI
   "card" for credit/debit card swipes
   "bank_transfer" for NEFT/IMPS/RTGS/account-to-account credits & debits
- transacted_at: ISO 8601 date the transaction happened.
- note: optional, useful for context like "Card ending 8192" or "Refund ref 123".
- If you can't extract amount or merchant, set is_transaction=false.

Rules for category_label (pick exactly one label from the list, character-for-character):
- For debits:
   * UPI to a person's name → "Transfers › Friends" (Family/Self if obvious).
   * Unknown merchant → "Misc".
   * Else most specific child that fits (e.g. "Food › Coffee" not "Food").
- For credits:
   * Merchant refund/reversal → "Income › Refund".
   * Money from a family member → "Income › Allowance".
   * Anything else → "Income › Other".

Output: a JSON array. Each element includes the email_id from the input plus
the extracted fields. The array length MUST equal the number of input emails.`;

function buildItemSchema(labels: string[]) {
  return {
    type: Type.OBJECT,
    properties: {
      email_id: { type: Type.STRING },
      is_transaction: { type: Type.BOOLEAN },
      kind: {
        type: Type.STRING,
        enum: ["debit", "credit"],
      },
      amount_inr: { type: Type.NUMBER, nullable: true },
      merchant: { type: Type.STRING, nullable: true },
      payment_mode: {
        type: Type.STRING,
        enum: ["card", "upi", "bank_transfer"],
        nullable: true,
      },
      transacted_at: { type: Type.STRING, nullable: true },
      note: { type: Type.STRING, nullable: true },
      category_label: {
        type: Type.STRING,
        enum: labels,
        nullable: true,
      },
    },
    required: ["email_id", "is_transaction", "kind"],
    propertyOrdering: [
      "email_id",
      "is_transaction",
      "kind",
      "amount_inr",
      "merchant",
      "payment_mode",
      "transacted_at",
      "note",
      "category_label",
    ],
  };
}

/**
 * Extract transaction details from a batch of emails in one Gemini call.
 * Returns the same number of results as inputs, indexed by email_id.
 */
export async function extractTransactionBatch(params: {
  emails: EmailInput[];
  categories: CategoryChoice[];
}): Promise<Map<string, ExtractedTransaction>> {
  if (params.emails.length === 0) return new Map();

  const ai = getClient();
  const labels = params.categories.map((c) => c.label);
  const schema = {
    type: Type.ARRAY,
    items: buildItemSchema(labels),
  };

  const emailsBlock = params.emails
    .map((e, i) => {
      const body = pickBody(e.bodyText, e.rawHtml).slice(0, 4000);
      return [
        `--- EMAIL ${i + 1} of ${params.emails.length} ---`,
        `email_id: ${e.id}`,
        `From: ${e.fromAddress}`,
        `Subject: ${e.subject}`,
        `Email date: ${e.emailReceivedAt.toISOString()}`,
        "Body:",
        body,
      ].join("\n");
    })
    .join("\n\n");

  const userContent = [
    emailsBlock,
    "",
    "Available category labels (pick one exactly for each):",
    labels.join("\n"),
  ].join("\n");

  const response = await callGeminiWithBackoff(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: [
        { role: "user", parts: [{ text: BASE_PROMPT + "\n\n" + userContent }] },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
      },
    })
  );

  const text = response.text;
  if (!text) throw new Error("Gemini returned no content.");

  const rawArray = JSON.parse(text) as BatchExtraction[];
  if (!Array.isArray(rawArray)) {
    throw new Error("Gemini returned a non-array response.");
  }

  const out = new Map<string, ExtractedTransaction>();
  for (const item of rawArray) {
    if (!item || typeof item.email_id !== "string") continue;
    const cleaned: ExtractedTransaction = {
      is_transaction: Boolean(item.is_transaction),
      amount_inr: item.amount_inr ?? null,
      merchant: item.merchant ?? null,
      payment_mode: item.payment_mode ?? null,
      transacted_at: item.transacted_at ?? null,
      note: item.note ?? null,
      category_label: item.category_label ?? null,
      kind:
        (item as { kind?: string }).kind === "credit" ? "credit" : "debit",
    };
    if (cleaned.is_transaction) {
      if (typeof cleaned.amount_inr !== "number" || !(cleaned.amount_inr > 0)) {
        cleaned.is_transaction = false;
      }
      if (!cleaned.merchant || cleaned.merchant.trim().length === 0) {
        cleaned.is_transaction = false;
      }
    }
    out.set(item.email_id, cleaned);
  }
  return out;
}

/**
 * Lightweight: given a list of merchant names and a list of category labels,
 * ask Gemini to assign the best category label for each merchant.
 * Returns Map<merchant, category_label>. Merchants Gemini can't place
 * are returned with label = "Misc" or omitted (caller should fall back).
 */
export async function categorizeMerchantBatch(params: {
  merchants: string[];
  categories: CategoryChoice[];
}): Promise<Map<string, string>> {
  if (params.merchants.length === 0) return new Map();
  const ai = getClient();
  const labels = params.categories.map((c) => c.label);

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        merchant: { type: Type.STRING },
        category_label: { type: Type.STRING, enum: labels },
      },
      required: ["merchant", "category_label"],
    },
  };

  const prompt = `You're categorizing Indian merchant names into the user's
expense categories. For each merchant below, pick exactly one label from the
provided list — must match character-for-character.

Rules:
- For person names (e.g. "Rahul Sharma", "Md Arif") → "Transfers › Friends"
  unless the name is obviously a business.
- Pick the most specific child category that fits (e.g. "Food › Coffee" for
  Starbucks, "Food › Delivery" for Swiggy/Zomato/Blinkit, "Food › Restaurants"
  for sit-down restaurants, "Food › Cafeteria" for canteen / mess merchants).
- For brands like Spotify/Netflix → "Subscriptions › Streaming".
- Default to "Misc" only if you truly cannot tell.

Return one entry per input merchant, in the same order, using the exact
merchant string as provided.`;

  const userContent = [
    "Merchants:",
    ...params.merchants.map((m, i) => `${i + 1}. ${m}`),
    "",
    "Available category labels:",
    labels.join("\n"),
  ].join("\n");

  // Recategorize is triggered by a user click (a server action under a 60s
  // cap). Fail fast on a rate-limit — sleeping the patient ~90s×3 backoff here
  // would blow the timeout and 500 the page. The caller catches
  // GeminiRateLimitError and reports "rate-limited, try again" gracefully.
  const response = await callGeminiWithBackoff(
    () =>
      ai.models.generateContent({
        model: MODEL,
        contents: [
          { role: "user", parts: [{ text: prompt + "\n\n" + userContent }] },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0,
        },
      }),
    { maxAttempts: 1, minIntervalMs: 400 }
  );
  const text = response.text;
  if (!text) throw new Error("Gemini returned no content for category batch.");

  const arr = JSON.parse(text) as Array<{
    merchant: string;
    category_label: string;
  }>;
  const out = new Map<string, string>();
  for (const item of arr) {
    if (item?.merchant && item?.category_label) {
      out.set(item.merchant, item.category_label);
    }
  }
  return out;
}

function pickBody(text: string | null, html: string): string {
  if (text && text.trim().length > 0) return text;
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
