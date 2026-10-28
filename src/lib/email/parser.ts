import "server-only";
import { GoogleGenAI } from "@google/genai";

// Email extraction + recategorize run on NVIDIA's free OpenAI-compatible API
// (build.nvidia.com), the same place the chat moved to — Gemini's free tier
// kept rate-limiting. The statement importers still use Gemini directly
// (multimodal PDF/image) and bring their own client + callGeminiWithBackoff.
// Bank-alert extraction falls back to Gemini when NVIDIA is unavailable — see
// jsonArrayWithFallback.
// Not the same model as lib/agent/loop.ts any more: the one Ask moved to
// (nemotron-3.5-lightning) read ₹20.00 as 2000 here. See the note there on
// NVIDIA pulling serving capacity from models it still lists.
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "openai/gpt-oss-20b";
// Was 45s, which on its own could consume a whole sync tick's budget and get
// the function killed. A healthy call returns in a couple of seconds; this is
// only a guard against the model going unresponsive, as llama-3.1-8b did.
// Overridable only so scripts/test-email-fallback.mts can time out quickly.
const NVIDIA_TIMEOUT_MS = Number(process.env.NVIDIA_TIMEOUT_MS) || 25_000;

// The second provider for bank-alert extraction and recategorize. On 26-27
// Oct 2026 every NVIDIA call timed out for two days and no alerts were parsed.
// Same model as statement-universal.
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";
/**
 * Which provider is tried first. Gemini while NVIDIA's gpt-oss-20b is down
 * (since 26 Oct 2026); set EMAIL_AI_PRIMARY=nvidia in Vercel and redeploy to
 * put NVIDIA back in front once it answers again. Read per call so a test can
 * flip it.
 */
function primaryProvider(): "gemini" | "nvidia" {
  return process.env.EMAIL_AI_PRIMARY === "nvidia" ? "nvidia" : "gemini";
}
const GEMINI_FALLBACK_TIMEOUT_MS = 20_000;
/** Below this there is no point starting a fallback call; leave it pending. */
const GEMINI_FALLBACK_MIN_MS = 5_000;
/**
 * After NVIDIA fails, skip it for a while and go straight to Gemini. Without
 * this an outage costs a full 25s timeout per batch before every fallback,
 * which is most of a sync tick. A retired model (410) won't come back, so it
 * is skipped for longer. Module state, so it only lasts while the instance is
 * warm — enough to stop one tick paying the timeout over and over.
 */
const NVIDIA_COOLDOWN_MS = 10 * 60_000;
const NVIDIA_GONE_COOLDOWN_MS = 6 * 60 * 60_000;
let nvidiaSkipUntil = 0;

// Throttle between calls. With batching of up to BATCH_SIZE emails per call,
// 4.5s between calls = ~13 calls/min × 5 emails = ~65 emails/min effective.
const MIN_INTERVAL_MS = 4500;
let lastCallAt = 0;

/** Max emails sent in a single Gemini request. */
/**
 * Emails per model call.
 *
 * Ten is too many. With low reasoning effort a batch of ten lands around 21s
 * against a 25s cap, so roughly one batch in three overran and took nine good
 * emails down with it — 185 failures across a 450-email drain. Five measures
 * at 9-15s, which leaves room for a slow one. Fewer emails per call, but a
 * call that finishes beats a bigger one that does not.
 */
export const BATCH_SIZE = 5;

/**
 * Raised when the caller's time budget is spent. Pending emails stay pending,
 * so the next tick simply picks them up.
 */
export class OutOfTimeError extends Error {
  constructor() {
    super("Ran out of time before the batch could be parsed.");
  }
}

/**
 * Neutralise the markers this prompt uses to separate one email from the next.
 *
 * Email bodies are written by whoever sent them. Left alone, text that mimics
 * the "--- EMAIL n of m ---" / "email_id:" framing can pose as another entry in
 * the batch and overwrite or suppress a real transaction's result. Breaking the
 * markers costs the model nothing — it still reads the words either way.
 */
function defuse(text: string): string {
  return text
    .replace(/-{3,}\s*EMAIL/gi, "- EMAIL")
    .replace(/^\s*email_id\s*:/gim, "email id -")
    .replace(/^\s*(From|Subject|Body)\s*:/gim, "$1 -");
}

/** Milliseconds left for one model call, leaving room to finish the response. */
function remainingBudget(deadline?: number): number {
  if (deadline === undefined) return NVIDIA_TIMEOUT_MS;
  return Math.min(NVIDIA_TIMEOUT_MS, deadline - Date.now() - 2_000);
}

async function throttle(
  minIntervalMs: number = MIN_INTERVAL_MS,
  deadline?: number
): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < minIntervalMs) {
    const wait = minIntervalMs - elapsed;
    // Waiting past the deadline just guarantees the function is killed mid-call.
    if (deadline !== undefined && Date.now() + wait >= deadline) {
      throw new OutOfTimeError();
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
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

/**
 * NVIDIA could not answer at all: timed out, network failure, 5xx, or 410
 * (model retired). Callers that have another provider fall back on this; it
 * is still an Error with the same message as before for everyone else. 429 is
 * deliberately not one of these — that stays a GeminiRateLimitError.
 */
export class NvidiaUnavailableError extends Error {
  constructor(
    message: string,
    public reason: "timeout" | "network" | "server" | "gone"
  ) {
    super(message);
    this.name = "NvidiaUnavailableError";
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
  opts?: { maxAttempts?: number; minIntervalMs?: number; deadline?: number }
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const deadline = opts?.deadline;
  /** True when `ms` of waiting would leave no room to actually retry. */
  const cannotAfford = (ms: number) =>
    deadline !== undefined && Date.now() + ms >= deadline;

  let lastRetrySec = 60;
  let overloadRetries = 0;
  const MAX_OVERLOAD_RETRIES = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await throttle(opts?.minIntervalMs, deadline);
    try {
      return await makeRequest();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Transient model overload (503 UNAVAILABLE / "high demand") — Google-side
      // spikes that are usually brief. Retry quickly a couple of times without
      // consuming the rate-limit attempt budget; if it persists, surface a clean
      // message instead of the raw error JSON.
      if (e instanceof OutOfTimeError) throw e;
      if (/\b503\b|UNAVAILABLE|overloaded|high demand/i.test(msg)) {
        // Each retry is another full-length model call, so only take one if
        // there is genuinely room for it.
        if (overloadRetries < MAX_OVERLOAD_RETRIES && !cannotAfford(1500)) {
          overloadRetries++;
          attempt--;
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        if (cannotAfford(1500)) throw new OutOfTimeError();
        throw new Error(
          "The AI model is briefly overloaded on Google's side. Please try again in a few seconds."
        );
      }
      const retrySec = parseRetryAfter(msg);
      if (retrySec === null) throw e; // not a 429 — propagate as a real error
      lastRetrySec = retrySec;
      if (attempt === maxAttempts) break;
      const sleepMs = Math.min(retrySec + 3, 90) * 1000;
      // This sleep can be up to 90s — longer than a serverless function is
      // allowed to live. Give up cleanly rather than being killed mid-wait.
      if (cannotAfford(sleepMs)) throw new OutOfTimeError();
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

export function isGeminiConfigured(): boolean {
  // Email extraction + recategorize run on Gemini or NVIDIA (whichever is
  // primary, with the other as fallback), so either key is enough. (Name kept
  // so the 5 call sites don't churn.)
  return Boolean(process.env.GOOGLE_GEMINI_API_KEY || process.env.NVIDIA_API_KEY);
}

/**
 * Call NVIDIA (OpenAI-compatible) in JSON mode and return the array of results.
 * We ask the model for `{ "results": [...] }` and unwrap it. Throws
 * GeminiRateLimitError on 429 so callers keep their rate-limit handling.
 */
export async function nvidiaJsonObject(
  systemPrompt: string,
  userContent: string,
  opts?: { deadline?: number; maxTokens?: number }
): Promise<unknown> {
  const deadline = opts?.deadline;
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NVIDIA_API_KEY is not set. Get a free key at https://build.nvidia.com"
    );
  }
  // Never outlast the caller's budget. A serverless sync gets 60s in total, so
  // a call that ran the full 25s on top of retries was enough to have the whole
  // function killed — and a killed function reports nothing at all.
  const budget = remainingBudget(deadline);
  if (budget <= 0) throw new OutOfTimeError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  let res: Response;
  try {
    res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0,
        max_tokens: opts?.maxTokens ?? 4096,
        response_format: { type: "json_object" },
        // gpt-oss is a reasoning model, and left to itself it thinks at length
        // about what is a mechanical extraction. Measured on the ten emails
        // that had been stuck since 16 September: a batch of ten took 47s at
        // the default effort and 21s at "low", with identical results and half
        // the completion tokens. Since the call is capped at 25s, the default
        // meant every full batch timed out and nothing ever drained.
        reasoning_effort: "low",
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new NvidiaUnavailableError(
        `NVIDIA request timed out after ${Math.round(budget / 1000)}s.`,
        "timeout"
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new NvidiaUnavailableError(`NVIDIA request failed: ${msg}`, "network");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after")) || 20;
    throw new GeminiRateLimitError(ra);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const message = `NVIDIA API ${res.status}: ${text.slice(0, 400)}`;
    if (res.status === 410) throw new NvidiaUnavailableError(message, "gone");
    if (res.status >= 500) throw new NvidiaUnavailableError(message, "server");
    throw new Error(message);
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("NVIDIA returned no content.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const cleaned = content
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  }
  return parsed;
}

/**
 * The same call, unwrapped to the array callers usually want. Kept because
 * every existing caller asks for `{ "results": [...] }` and only wants the
 * rows; the statement parser needs the surrounding object too, which is why
 * the two are now separate.
 */
async function nvidiaJsonArray(
  systemPrompt: string,
  userContent: string,
  deadline?: number
): Promise<unknown[]> {
  const parsed = await nvidiaJsonObject(systemPrompt, userContent, { deadline });
  return unwrapResults(parsed);
}

function unwrapResults(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  const obj = (parsed ?? {}) as Record<string, unknown>;
  for (const key of ["results", "transactions", "items", "data"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [parsed];
}

/**
 * The same prompt and `{ "results": [...] }` shape, answered by Gemini. A
 * persistent 429 surfaces as GeminiRateLimitError via callGeminiWithBackoff,
 * like everywhere else.
 */
async function geminiJsonArray(
  systemPrompt: string,
  userContent: string,
  deadline: number | undefined,
  minIntervalMs: number
): Promise<unknown[]> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set.");
  const budget =
    deadline === undefined
      ? GEMINI_FALLBACK_TIMEOUT_MS
      : Math.min(GEMINI_FALLBACK_TIMEOUT_MS, deadline - Date.now() - 2_000);
  if (budget < GEMINI_FALLBACK_MIN_MS) throw new OutOfTimeError();
  const callDeadline = Date.now() + budget;

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const response = await callGeminiWithBackoff(
      () =>
        ai.models.generateContent({
          model: GEMINI_FALLBACK_MODEL,
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            temperature: 0,
            thinkingConfig: { thinkingBudget: 0 },
            abortSignal: controller.signal,
          },
        }),
      { deadline: callDeadline, minIntervalMs, maxAttempts: 2 }
    );
    const content = response.text ?? "";
    if (!content) throw new Error("Gemini returned no content.");
    return unwrapResults(JSON.parse(content));
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`Gemini request timed out after ${Math.round(budget / 1000)}s.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * NVIDIA, tried if it hasn't failed recently. Returns null when the caller
 * should move on to Gemini: NVIDIA is unavailable (timeout, network, 5xx,
 * 410), in its cooldown, or has no key. 429, OutOfTimeError and bad answers
 * are not outages and are thrown.
 */
async function tryNvidia(
  systemPrompt: string,
  userContent: string,
  deadline: number | undefined,
  label: string,
  role: "primary" | "fallback",
  errors: string[]
): Promise<unknown[] | null> {
  if (!process.env.NVIDIA_API_KEY) {
    errors.push("NVIDIA_API_KEY is not set.");
    return null;
  }
  if (Date.now() < nvidiaSkipUntil) {
    console.log(
      `[email-parse] ${label}: skipping nvidia (unavailable recently, retry after ${new Date(nvidiaSkipUntil).toISOString()})`
    );
    errors.push("NVIDIA skipped (recently unavailable).");
    return null;
  }
  const startedAt = Date.now();
  try {
    const rows = await nvidiaJsonArray(systemPrompt, userContent, deadline);
    console.log(
      `[email-parse] ${label}: provider=nvidia model=${NVIDIA_MODEL} (${role}) ${Date.now() - startedAt}ms`
    );
    return rows;
  } catch (e) {
    if (!(e instanceof NvidiaUnavailableError)) throw e;
    nvidiaSkipUntil =
      Date.now() + (e.reason === "gone" ? NVIDIA_GONE_COOLDOWN_MS : NVIDIA_COOLDOWN_MS);
    console.warn(`[email-parse] ${label}: nvidia unavailable (${e.reason}): ${e.message}`);
    errors.push(e.message);
    return null;
  }
}

/**
 * Gemini. Returns null when the caller should move on to NVIDIA: no key, or
 * Gemini failed for a reason other than a rate limit or the clock. A 429 is
 * thrown as GeminiRateLimitError (the batch stays pending), never retried on
 * the other provider.
 */
async function tryGemini(
  systemPrompt: string,
  userContent: string,
  deadline: number | undefined,
  label: string,
  role: "primary" | "fallback",
  errors: string[]
): Promise<unknown[] | null> {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    errors.push("GOOGLE_GEMINI_API_KEY is not set.");
    return null;
  }
  const startedAt = Date.now();
  try {
    // As primary it's called batch after batch, so keep the usual spacing to
    // stay under the free tier's per-minute limit. As a fallback the previous
    // call went to NVIDIA, so there is nothing to space from.
    const rows = await geminiJsonArray(
      systemPrompt,
      userContent,
      deadline,
      role === "primary" ? MIN_INTERVAL_MS : 0
    );
    console.log(
      `[email-parse] ${label}: provider=gemini model=${GEMINI_FALLBACK_MODEL} (${role}) ${Date.now() - startedAt}ms`
    );
    return rows;
  } catch (e) {
    if (e instanceof OutOfTimeError || e instanceof GeminiRateLimitError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email-parse] ${label}: gemini failed: ${msg}`);
    errors.push(`Gemini failed: ${msg}`);
    return null;
  }
}

/**
 * The primary provider (see primaryProvider), then the other one if the first
 * is unavailable. Logs which provider answered each batch so an outage shows
 * up in the Vercel logs.
 */
async function jsonArrayWithFallback(
  systemPrompt: string,
  userContent: string,
  opts: { deadline?: number; label: string }
): Promise<unknown[]> {
  const { deadline, label } = opts;
  const errors: string[] = [];
  const order = primaryProvider() === "gemini" ? [tryGemini, tryNvidia] : [tryNvidia, tryGemini];
  for (const [i, attempt] of order.entries()) {
    const rows = await attempt(
      systemPrompt,
      userContent,
      deadline,
      label,
      i === 0 ? "primary" : "fallback",
      errors
    );
    if (rows) return rows;
  }
  console.error(`[email-parse] ${label}: no provider answered: ${errors.join(" ")}`);
  // Both messages end up in parseError, which is what you want to read.
  throw new Error(errors.join(" "));
}

/** For tests: forget that NVIDIA was unavailable. */
export function resetProviderStateForTests(): void {
  nvidiaSkipUntil = 0;
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
  * Indian digit grouping is lakh/crore, NOT thousands: commas fall after the
    last three digits and then every two. So "63,60,145.00" is 6360145, not
    63600145, and "1,23,456" is 123456. Delete the commas and read the digits
    that remain — never pad a group out to three digits. Getting this wrong
    turned a 63 lakh fixed deposit into 6.3 crore of spending.
  * The figure you want is the amount moved, never the "Available Balance" or
    "available balance in your account", which appears in the same email.
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

Output: a JSON object with a single key "results" whose value is an array —
one object per input email, in the same order. Each element includes the
email_id from the input plus the extracted fields. The results array length
MUST equal the number of input emails. payment_mode and kind are lowercase.`;

/**
 * Extract transaction details from a batch of emails in one Gemini call.
 * Returns the same number of results as inputs, indexed by email_id.
 */
export async function extractTransactionBatch(params: {
  emails: EmailInput[];
  categories: CategoryChoice[];
  /** Epoch ms the caller must return by; the model call is capped to fit. */
  deadline?: number;
}): Promise<Map<string, ExtractedTransaction>> {
  if (params.emails.length === 0) return new Map();

  const labels = params.categories.map((c) => c.label);

  const emailsBlock = params.emails
    .map((e, i) => {
      const body = defuse(pickBody(e.bodyText, e.rawHtml).slice(0, 4000));
      return [
        `--- EMAIL ${i + 1} of ${params.emails.length} ---`,
        `email_id: ${e.id}`,
        `From: ${defuse(e.fromAddress)}`,
        `Subject: ${defuse(e.subject)}`,
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

  const rawArray = (await jsonArrayWithFallback(BASE_PROMPT, userContent, {
    deadline: params.deadline,
    label: `batch of ${params.emails.length}`,
  })) as BatchExtraction[];

  // Only ids we actually sent are accepted. Without this, an id conjured from
  // injected body text could attach a fabricated transaction to another email.
  const sentIds = new Set(params.emails.map((e) => e.id));

  const out = new Map<string, ExtractedTransaction>();
  for (const item of rawArray) {
    if (!item || typeof item.email_id !== "string") continue;
    if (!sentIds.has(item.email_id)) continue;
    const pm =
      typeof item.payment_mode === "string"
        ? item.payment_mode.toLowerCase()
        : null;
    const cleaned: ExtractedTransaction = {
      is_transaction: Boolean(item.is_transaction),
      amount_inr: item.amount_inr ?? null,
      merchant: item.merchant ?? null,
      payment_mode:
        pm === "upi" || pm === "card" || pm === "bank_transfer" ? pm : null,
      note: item.note ?? null,
      category_label: item.category_label ?? null,
      kind:
        String((item as { kind?: string }).kind).toLowerCase() === "credit"
          ? "credit"
          : "debit",
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
  const labels = params.categories.map((c) => c.label);

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

Return a JSON object with a single key "results" whose value is an array with
one entry per input merchant, in the same order — each entry
{ "merchant": <exact input string>, "category_label": <one label> }.`;

  const userContent = [
    "Merchants:",
    ...params.merchants.map((m, i) => `${i + 1}. ${m}`),
    "",
    "Available category labels:",
    labels.join("\n"),
  ].join("\n");

  // A 429 from either provider throws GeminiRateLimitError, which the
  // recategorize caller reports gracefully.
  const arr = (await jsonArrayWithFallback(prompt, userContent, {
    label: `recategorize ${params.merchants.length} merchants`,
  })) as Array<{
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
