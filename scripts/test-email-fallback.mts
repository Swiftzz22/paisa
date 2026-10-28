/**
 * Shows the bank-alert parser moving between Gemini and NVIDIA.
 *
 * Gemini is tried first by default; EMAIL_AI_PRIMARY=nvidia puts NVIDIA in
 * front. Both orders are exercised here.
 *
 * Offline: both providers are faked by stubbing fetch, so nothing leaves the
 * machine and no database is touched.
 *
 *   npx tsx --conditions=react-server scripts/test-email-fallback.mts
 *
 * With --live, the Gemini half is real (needs GOOGLE_GEMINI_API_KEY in .env)
 * and reads one made-up HDFC alert; NVIDIA is still faked as timing out.
 *
 *   npx tsx --conditions=react-server scripts/test-email-fallback.mts --live
 *
 * --conditions=react-server makes "server-only" resolve to its empty stub.
 */
import assert from "node:assert/strict";

const LIVE = process.argv.includes("--live");
if (LIVE) {
  // Only the Gemini key is wanted from .env; nothing here reads the DB.
  const { config } = await import("dotenv");
  config({ quiet: true });
  if (!process.env.GOOGLE_GEMINI_API_KEY) throw new Error("--live needs GOOGLE_GEMINI_API_KEY");
} else {
  process.env.GOOGLE_GEMINI_API_KEY = "fake-gemini-key";
}
process.env.NVIDIA_API_KEY = "fake-nvidia-key";
process.env.NVIDIA_TIMEOUT_MS = "300";

const parser = await import("../src/lib/email/parser");
const {
  extractTransactionBatch,
  categorizeMerchantBatch,
  GeminiRateLimitError,
  OutOfTimeError,
  resetProviderStateForTests,
} = parser;

type NvidiaMode = "ok" | "timeout" | "503" | "410" | "429" | "400";
type GeminiMode = "ok" | "503" | "500" | "429";
let nvidiaMode: NvidiaMode = "ok";
let geminiMode: GeminiMode = "ok";
let nvidiaCalls = 0;
let geminiCalls = 0;

const EMAIL = {
  id: "email-1",
  fromAddress: "alerts@hdfcbank.net",
  subject: "You have done a UPI txn. Check details!",
  bodyText:
    "Dear Customer, Rs.250.00 has been debited from account **5571 to VPA swiggy@icici SWIGGY on 26-10-26. Your UPI transaction reference number is 123456789012.",
  rawHtml: "",
  emailReceivedAt: new Date("2026-10-26T13:05:00Z"),
};
const CATEGORIES = [
  { id: "c1", label: "Food › Delivery" },
  { id: "c2", label: "Misc" },
];
const answer = (provider: string, body: string) =>
  /Merchants:/.test(body)
    ? JSON.stringify({ results: [{ merchant: "Swiggy", category_label: "Food › Delivery" }] })
    : JSON.stringify({
        results: [
          {
            email_id: EMAIL.id,
            is_transaction: true,
            amount_inr: 250,
            merchant: `Swiggy (${provider})`,
            payment_mode: "upi",
            note: null,
            category_label: "Food › Delivery",
            kind: "debit",
          },
        ],
      });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init?.body === "string" ? init.body : "";
  if (url.includes("integrate.api.nvidia.com")) {
    nvidiaCalls++;
    switch (nvidiaMode) {
      case "timeout":
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        });
      case "503":
        return new Response("upstream unavailable", { status: 503 });
      case "410":
        return new Response('{"detail":"model openai/gpt-oss-20b is no longer available"}', {
          status: 410,
        });
      case "429":
        return new Response("slow down", { status: 429, headers: { "retry-after": "7" } });
      case "400":
        return new Response("bad request", { status: 400 });
      case "ok":
        return Response.json({ choices: [{ message: { content: answer("nvidia", body) } }] });
    }
  }
  if (url.includes("generativelanguage.googleapis.com")) {
    geminiCalls++;
    if (LIVE) return realFetch(input, init);
    switch (geminiMode) {
      case "503":
        return Response.json(
          { error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } },
          { status: 503 }
        );
      case "500":
        return Response.json(
          { error: { code: 500, message: "Internal error.", status: "INTERNAL" } },
          { status: 500 }
        );
      case "429":
        return Response.json(
          {
            error: {
              code: 429,
              message: "Quota exceeded. Please retry in 0.1s.",
              status: "RESOURCE_EXHAUSTED",
            },
          },
          { status: 429 }
        );
      case "ok":
        return Response.json({
          candidates: [
            {
              content: { role: "model", parts: [{ text: answer("gemini", body) }] },
              finishReason: "STOP",
            },
          ],
        });
    }
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
}) as typeof fetch;

async function run(
  primary: "gemini" | "nvidia",
  modes: { nvidia?: NvidiaMode; gemini?: GeminiMode },
  opts: { reset?: boolean; deadline?: number } = {}
) {
  if (opts.reset ?? true) resetProviderStateForTests();
  if (primary === "nvidia") process.env.EMAIL_AI_PRIMARY = "nvidia";
  else delete process.env.EMAIL_AI_PRIMARY;
  nvidiaMode = modes.nvidia ?? "ok";
  geminiMode = modes.gemini ?? "ok";
  nvidiaCalls = 0;
  geminiCalls = 0;
  return extractTransactionBatch({
    emails: [EMAIL],
    categories: CATEGORIES,
    deadline: opts.deadline,
  });
}

const calls = () => [nvidiaCalls, geminiCalls];

const cases: Array<[string, () => Promise<void>]> = [
  // --- Gemini first (the default) ---
  [
    "gemini primary: Gemini answers, NVIDIA untouched",
    async () => {
      const r = await run("gemini", {});
      const tx = r.get(EMAIL.id);
      assert.equal(tx?.is_transaction, true);
      assert.equal(tx?.amount_inr, 250);
      if (!LIVE) assert.equal(tx?.merchant, "Swiggy (gemini)");
      else console.log("     live Gemini said:", tx);
      assert.equal(nvidiaCalls, 0);
    },
  ],
  [
    "gemini primary: Gemini 503 falls back to NVIDIA",
    async () => {
      const r = await run("gemini", { gemini: "503" });
      assert.equal(r.get(EMAIL.id)?.merchant, "Swiggy (nvidia)");
      assert.equal(nvidiaCalls, 1);
    },
  ],
  [
    "gemini primary: Gemini 500 falls back to NVIDIA",
    async () => {
      const r = await run("gemini", { gemini: "500" });
      assert.equal(r.get(EMAIL.id)?.merchant, "Swiggy (nvidia)");
      assert.equal(nvidiaCalls, 1);
    },
  ],
  [
    "gemini primary: Gemini 429 stays a rate limit, no fallback",
    async () => {
      await assert.rejects(run("gemini", { gemini: "429" }), (e) => e instanceof GeminiRateLimitError);
      assert.equal(nvidiaCalls, 0);
    },
  ],
  [
    "gemini primary: both down gives one error naming both",
    async () => {
      await assert.rejects(run("gemini", { gemini: "500", nvidia: "timeout" }), (e: Error) => {
        assert.match(e.message, /Gemini failed/);
        assert.match(e.message, /NVIDIA request timed out/);
        return true;
      });
      assert.equal(nvidiaCalls, 1);
    },
  ],
  [
    "gemini primary: too little budget left leaves the batch pending",
    async () => {
      await assert.rejects(run("gemini", {}, { deadline: Date.now() + 4_000 }), (e) => e instanceof OutOfTimeError);
      assert.deepEqual(calls(), [0, 0]);
    },
  ],
  [
    "gemini primary: recategorize goes to Gemini too",
    async () => {
      resetProviderStateForTests();
      delete process.env.EMAIL_AI_PRIMARY;
      geminiMode = "ok";
      nvidiaCalls = 0;
      geminiCalls = 0;
      const r = await categorizeMerchantBatch({ merchants: ["Swiggy"], categories: CATEGORIES });
      if (!LIVE) assert.equal(r.get("Swiggy"), "Food › Delivery");
      assert.equal(nvidiaCalls, 0);
      assert.equal(geminiCalls >= 1, true);
    },
  ],

  // --- NVIDIA first (EMAIL_AI_PRIMARY=nvidia) ---
  [
    "nvidia primary: healthy NVIDIA answers, Gemini untouched",
    async () => {
      const r = await run("nvidia", {});
      assert.equal(r.get(EMAIL.id)?.merchant, "Swiggy (nvidia)");
      assert.deepEqual(calls(), [1, 0]);
    },
  ],
  [
    "nvidia primary: timeout falls back to Gemini",
    async () => {
      const r = await run("nvidia", { nvidia: "timeout" });
      assert.equal(r.get(EMAIL.id)?.amount_inr, 250);
      assert.deepEqual(calls(), [1, 1]);
    },
  ],
  [
    "nvidia primary: 503 falls back to Gemini",
    async () => {
      const r = await run("nvidia", { nvidia: "503" });
      assert.equal(r.get(EMAIL.id)?.amount_inr, 250);
      assert.deepEqual(calls(), [1, 1]);
    },
  ],
  [
    "nvidia primary: 410 falls back, and the next batch skips NVIDIA",
    async () => {
      await run("nvidia", { nvidia: "410" });
      assert.deepEqual(calls(), [1, 1]);
      const r = await run("nvidia", {}, { reset: false });
      assert.equal(r.get(EMAIL.id)?.amount_inr, 250);
      assert.deepEqual(calls(), [0, 1]);
    },
  ],
  [
    "nvidia primary: 429 stays a rate limit, no fallback",
    async () => {
      await assert.rejects(
        run("nvidia", { nvidia: "429" }),
        (e) => e instanceof GeminiRateLimitError && e.retryAfterSeconds === 7
      );
      assert.deepEqual(calls(), [1, 0]);
    },
  ],
  [
    "nvidia primary: 400 is a real error, no fallback",
    async () => {
      await assert.rejects(run("nvidia", { nvidia: "400" }), /NVIDIA API 400/);
      assert.deepEqual(calls(), [1, 0]);
    },
  ],
  [
    "nvidia primary: timeout with too little budget left leaves the batch pending",
    async () => {
      // 2.5s left: NVIDIA gets 300ms, then ~2.2s remain — under Gemini's 5s floor.
      await assert.rejects(
        run("nvidia", { nvidia: "timeout" }, { deadline: Date.now() + 2_500 }),
        (e) => e instanceof OutOfTimeError
      );
      assert.deepEqual(calls(), [1, 0]);
    },
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  if (LIVE && !/Gemini answers|recategorize/.test(name)) continue;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.stack : e}`);
  }
}
globalThis.fetch = realFetch;
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
