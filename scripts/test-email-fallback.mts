/**
 * Shows the bank-alert parser falling back from NVIDIA to Gemini.
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
const { extractTransactionBatch, GeminiRateLimitError, OutOfTimeError, resetProviderStateForTests } =
  parser;

type NvidiaMode = "ok" | "timeout" | "503" | "410" | "429" | "400";
let nvidiaMode: NvidiaMode = "ok";
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
const answer = (provider: string) =>
  JSON.stringify({
    results: [
      {
        email_id: EMAIL.id,
        is_transaction: true,
        amount_inr: 250,
        merchant: provider === "nvidia" ? "Swiggy" : "Swiggy (gemini)",
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
        return Response.json({ choices: [{ message: { content: answer("nvidia") } }] });
    }
  }
  if (url.includes("generativelanguage.googleapis.com")) {
    geminiCalls++;
    if (LIVE) return realFetch(input, init);
    return Response.json({
      candidates: [
        { content: { role: "model", parts: [{ text: answer("gemini") }] }, finishReason: "STOP" },
      ],
    });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
}) as typeof fetch;

async function run(mode: NvidiaMode, opts: { reset?: boolean; deadline?: number } = {}) {
  if (opts.reset ?? true) resetProviderStateForTests();
  nvidiaMode = mode;
  nvidiaCalls = 0;
  geminiCalls = 0;
  return extractTransactionBatch({
    emails: [EMAIL],
    categories: CATEGORIES,
    deadline: opts.deadline,
  });
}

const cases: Array<[string, () => Promise<void>]> = [
  [
    "healthy NVIDIA answers, Gemini untouched",
    async () => {
      const r = await run("ok");
      assert.equal(r.get(EMAIL.id)?.merchant, "Swiggy");
      assert.deepEqual([nvidiaCalls, geminiCalls], [1, 0]);
    },
  ],
  [
    "NVIDIA timeout falls back to Gemini",
    async () => {
      const r = await run("timeout");
      const tx = r.get(EMAIL.id);
      assert.equal(tx?.is_transaction, true);
      assert.equal(tx?.amount_inr, 250);
      assert.equal(tx?.kind, "debit");
      if (!LIVE) assert.equal(tx?.merchant, "Swiggy (gemini)");
      else console.log("     live Gemini said:", tx);
      assert.deepEqual([nvidiaCalls, geminiCalls], [1, 1]);
    },
  ],
  [
    "NVIDIA 503 falls back to Gemini",
    async () => {
      const r = await run("503");
      assert.equal(r.get(EMAIL.id)?.amount_inr, 250);
      assert.deepEqual([nvidiaCalls, geminiCalls], [1, 1]);
    },
  ],
  [
    "NVIDIA 410 falls back, and the next batch skips NVIDIA",
    async () => {
      await run("410");
      assert.deepEqual([nvidiaCalls, geminiCalls], [1, 1]);
      const r = await run("ok", { reset: false });
      assert.equal(r.get(EMAIL.id)?.amount_inr, 250);
      assert.deepEqual([nvidiaCalls, geminiCalls], [0, 1]);
    },
  ],
  [
    "NVIDIA 429 stays a rate limit, no fallback",
    async () => {
      await assert.rejects(run("429"), (e) => e instanceof GeminiRateLimitError && e.retryAfterSeconds === 7);
      assert.deepEqual([nvidiaCalls, geminiCalls], [1, 0]);
    },
  ],
  [
    "NVIDIA 400 is a real error, no fallback",
    async () => {
      await assert.rejects(run("400"), /NVIDIA API 400/);
      assert.deepEqual([nvidiaCalls, geminiCalls], [1, 0]);
    },
  ],
  [
    "timeout with too little budget left leaves the batch pending",
    async () => {
      // 2.5s left: NVIDIA gets 300ms, then ~2.2s remain — under Gemini's 5s floor.
      await assert.rejects(run("timeout", { deadline: Date.now() + 2_500 }), (e) => e instanceof OutOfTimeError);
      assert.deepEqual([nvidiaCalls, geminiCalls], [1, 0]);
    },
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  if (LIVE && !name.includes("timeout falls back")) continue;
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
