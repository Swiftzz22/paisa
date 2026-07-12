import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { AGENT_TOOLS, getContext } from "@/lib/agent/tools";
import { FUNCTION_DECLARATIONS } from "@/lib/agent/declarations";

/** Map tool name → array of expected canonical parameter names. */
const EXPECTED_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  FUNCTION_DECLARATIONS.map((d) => [
    d.name,
    d.parameters?.properties ? Object.keys(d.parameters.properties) : [],
  ])
);
import { callGeminiWithBackoff } from "@/lib/email/parser";

// gemini-2.0-flash: free-tier, more capable than the -lite models, and far
// more stable — 2.5-flash-lite kept returning 503 "high demand" overloads.
// Generous free quota (15 RPM / 1500 RPD). coerceArgs() below normalises any
// mangled parameter names, so flash-family models are safe to use.
const MODEL = "gemini-2.0-flash";
// Each step is one Gemini round-trip. Most questions resolve in 2–3; capping
// lower bounds worst-case calls (easier on the free-tier rate limit) while
// still leaving room for a tool retry or a two-part question.
const MAX_STEPS = 5;
/** Hard cap on the JSON size of a tool result before going back to the LLM. */
const MAX_RESULT_BYTES = 50_000;

export type TraceEntry = {
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
  ms: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  trace?: TraceEntry[];
};

export type AgentResult = {
  answer: string;
  trace: TraceEntry[];
  steps: number;
};

type DateAnchors = {
  today: string;
  weekday: string;
  yesterday: string;
  thisWeek: string; // "YYYY-MM-DD to YYYY-MM-DD"
  lastWeek: string;
  thisMonth: string;
  lastMonth: string;
  thisYear: string;
  lastWeekdayDates: Record<string, string>; // "Monday" -> "YYYY-MM-DD"
};

/**
 * Pre-compute concrete date ranges in IST so the model never has to do date
 * arithmetic (flash-lite is unreliable at "what date was last Monday?"). India
 * has no DST, so IST is a fixed UTC+5:30 offset.
 */
function computeDateAnchors(now: Date = new Date()): DateAnchors {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const dow = ist.getUTCDay(); // 0=Sun..6=Sat
  const WEEKDAYS = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];

  const iso = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  const shift = (days: number) => {
    const t = new Date(Date.UTC(y, m, d));
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  };

  const today = iso(y, m, d);
  const mondayOffset = (dow + 6) % 7; // days since Monday (Mon=0 … Sun=6)

  const lastWeekdayDates: Record<string, string> = {};
  for (let i = 0; i < 7; i++) {
    let delta = (dow - i + 7) % 7; // days back to weekday i
    if (delta === 0) delta = 7; // "last <today's weekday>" = the previous one
    lastWeekdayDates[WEEKDAYS[i]] = shift(-delta);
  }

  return {
    today,
    weekday: WEEKDAYS[dow],
    yesterday: shift(-1),
    thisWeek: `${shift(-mondayOffset)} to ${today}`,
    lastWeek: `${shift(-mondayOffset - 7)} to ${shift(-mondayOffset - 1)}`,
    thisMonth: `${iso(y, m, 1)} to ${today}`,
    lastMonth: `${iso(y, m - 1, 1)} to ${iso(y, m, 0)}`,
    thisYear: `${iso(y, 0, 1)} to ${today}`,
    lastWeekdayDates,
  };
}

function buildSystemPrompt(
  ctx: {
    earliest: string | null;
    categories: string[];
    modes: Array<{ value: string; label: string }>;
  },
  a: DateAnchors
): string {
  const weekStart = a.thisWeek.split(" to ")[0];
  return `You are paisa.'s assistant for Sania, a college student in India tracking her personal spending. Help her answer questions about her own financial data using ONLY the tools you've been given.

GROUND RULES (non-negotiable):
1. All numbers MUST come from tool calls. Never invent, estimate, or guess. If a tool returns no rows, say "I don't see any data for that" plainly.
2. Today is ${a.today} (${a.weekday}), IST. The earliest transaction on file is ${ctx.earliest ?? "unknown"}.
3. Money is in INR. Format as ₹1,23,456.78 (Indian comma grouping).
4. Be concise — one short paragraph plus a small list at most. No filler, no disclaimers.
5. ALL TOOLS ARE READ-ONLY. Never claim to have changed, created, or set anything.
6. When users mention a category, map to one of the EXACT top-level category names listed under CURRENT STATE.

DATE ANCHORS (IST — use these dates directly, do NOT compute your own):
- Yesterday: ${a.yesterday}
- This week (Mon–today): ${a.thisWeek}
- Last week (Mon–Sun): ${a.lastWeek}
- This month (1st–today): ${a.thisMonth}
- Last month: ${a.lastMonth}
- This year: ${a.thisYear}
- Most recent past weekday → date: ${Object.entries(a.lastWeekdayDates)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")}

TIME FILTERS (this is where you tend to slip — be strict):
- If the question mentions ANY time period ("this week", "last month", "yesterday", "on Friday", "last Monday"), you MUST pass the matching from/to (or fromMonth/toMonth) from the anchors above. NEVER answer a time-scoped question with all-time data.
- "last <weekday>" is a SINGLE day: set from = to = that date.
- "how much did I spend [period]" → aggregateByCategory over that range, then sum the categories for the total.
- "biggest/largest single transaction [period]" → queryTransactions with from/to and limit 1.

TOOL CALL DISCIPLINE:
- Use the EXACT parameter names from the schemas (monthlyTotals takes "fromMonth"/"toMonth" — not "from1Month" or "from_month").
- If a tool returns a parameter error, READ it, fix the name/value, and CALL AGAIN. You have up to ${MAX_STEPS} steps — spend them recovering, don't give up after one failed call.
- Dates are YYYY-MM-DD, months YYYY-MM. Never include a time.

WORKED EXAMPLES:
- "biggest UPI transaction this week" → queryTransactions({ type:"debit", paymentMode:"upi", from:"${weekStart}", to:"${a.today}", limit:1 })
- "how much did I spend last Monday" → aggregateByCategory({ from:"${a.lastWeekdayDates.Monday}", to:"${a.lastWeekdayDates.Monday}" }), then sum the returned categories.

CURRENT STATE (no need to call getContext):
- Top-level categories: ${ctx.categories.join(", ")}
- Payment modes: ${ctx.modes.map((m) => `${m.value} (${m.label})`).join(", ")}

If a question truly can't be answered with the tools, say so plainly rather than improvising.`;
}

/**
 * Coerce LLM-supplied argument names to the canonical names the tool expects.
 *
 * Real-world failure we hit: gemini-2.5-flash repeatedly emits "from1Month"
 * instead of "fromMonth" for `monthlyTotals`, and prompt nudges don't fix it
 * — the typo's in the model's weights. Rather than fight it, we normalise
 * each incoming key (lowercase + strip non-letters) and match it against the
 * canonical schema keys with the same normalisation.
 *
 *   "fromMonth"   → "frommonth"
 *   "from1Month"  → "frommonth"   ✓ unifies with the canonical
 *   "from_month"  → "frommonth"   ✓
 *   "monthFrom"   → "monthfrom"   ✗ doesn't match — left alone, will Zod-fail
 *
 * If two incoming keys normalise to the same canonical key, we keep the first
 * one (don't try to be clever about merging).
 */
function coerceArgs(
  args: Record<string, unknown>,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (!args || typeof args !== "object") return args;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const canonicalSet = new Set(expectedKeys);
  const canonicalByNorm = new Map(expectedKeys.map((k) => [norm(k), k]));
  const out: Record<string, unknown> = {};
  for (const [incoming, value] of Object.entries(args)) {
    if (canonicalSet.has(incoming)) {
      // Already a canonical key — preserve.
      out[incoming] = value;
      continue;
    }
    const matched = canonicalByNorm.get(norm(incoming));
    const target = matched ?? incoming;
    if (!(target in out)) out[target] = value;
  }
  return out;
}

/**
 * Prep a tool result for Gemini's functionResponse.response field.
 *
 *   • Gemini's proto requires `response` to be an object, not an array — so
 *     bare arrays get wrapped under `{ rows: [...] }`.
 *   • Then truncate the JSON serialisation if it's larger than the cap so a
 *     runaway query can't blow the LLM's context window.
 */
function prepResponse(value: unknown): Record<string, unknown> {
  let normalised: unknown = value;
  if (Array.isArray(value)) normalised = { rows: value };
  else if (value === null || typeof value !== "object") {
    normalised = { value };
  }
  const json = JSON.stringify(normalised);
  if (json.length <= MAX_RESULT_BYTES) {
    return normalised as Record<string, unknown>;
  }
  // Truncate. Return a marker object so the LLM knows what happened.
  return {
    _truncated: true,
    _originalBytes: json.length,
    _maxBytes: MAX_RESULT_BYTES,
    head: json.slice(0, MAX_RESULT_BYTES),
  };
}

/**
 * Run one agent turn. Loops the LLM + tool execution until the model emits a
 * text-only response or we hit MAX_STEPS.
 *
 * Conversation history is passed in as plain {role, content} pairs — past
 * tool calls are NOT replayed (saves prompt tokens). The agent can re-call
 * tools if it needs to.
 */
export async function runAgentLoop(params: {
  userId: string;
  history: ChatMessage[];
  userMessage: string;
}): Promise<AgentResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey"
    );
  }
  const ai = new GoogleGenAI({ apiKey });

  // Resolve context up front and bake it into the system prompt — saves a
  // tool call per session.
  const ctx = await getContext(params.userId);
  const systemPrompt = buildSystemPrompt(
    {
      earliest: ctx.earliestTransactionDate,
      categories: ctx.availableCategories,
      modes: ctx.availablePaymentModes,
    },
    computeDateAnchors()
  );

  // Build the Contents array. Each ChatMessage becomes one Content turn.
  const contents: Content[] = params.history.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));
  contents.push({
    role: "user",
    parts: [{ text: params.userMessage }],
  });

  const trace: TraceEntry[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await callGeminiWithBackoff(
      () =>
        ai.models.generateContent({
          model: MODEL,
          contents,
          config: {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ functionDeclarations: FUNCTION_DECLARATIONS as unknown as never }],
            temperature: 0,
          },
        }),
      // Interactive path: this loop makes several sequential calls, so the
      // 4.5s batch throttle would alone blow the function timeout. Use a light
      // gap, and fail fast on a 429 (surface "try again" in ~1s instead of
      // sleeping ~90s and 504-ing).
      { maxAttempts: 1, minIntervalMs: 400 }
    );

    const candidate = response.candidates?.[0];
    const parts: Part[] = candidate?.content?.parts ?? [];
    const functionCalls = parts
      .map((p) => p.functionCall)
      .filter((fc): fc is NonNullable<typeof fc> => Boolean(fc));

    if (functionCalls.length === 0) {
      // Final text answer.
      const text = response.text?.trim();
      return {
        answer: text || "I don't have an answer for that.",
        trace,
        steps: step + 1,
      };
    }

    // Append the model's function-call turn verbatim.
    contents.push({
      role: "model",
      parts: parts.map((p) => {
        if (p.functionCall) return { functionCall: p.functionCall };
        if (p.text) return { text: p.text };
        return p;
      }),
    });

    // Execute each call, gather results, send back as a single user turn.
    const responseParts: Part[] = [];
    for (const call of functionCalls) {
      const name = call.name as keyof typeof AGENT_TOOLS;
      const rawArgs = (call.args ?? {}) as Record<string, unknown>;
      const expected = EXPECTED_KEYS[name as string] ?? [];
      const args = coerceArgs(rawArgs, expected);
      const tool = AGENT_TOOLS[name];
      const t0 = performance.now();
      if (!tool) {
        const error = `Unknown tool: ${String(name)}`;
        trace.push({ name: String(name), args, error, ms: 0 });
        responseParts.push({
          functionResponse: {
            name: String(name),
            response: { error },
          },
        });
        continue;
      }
      try {
        // getContext takes no args (userId only); others take args.
        const result = await (name === "getContext"
          ? (tool.run as unknown as (uid: string) => Promise<unknown>)(
              params.userId
            )
          : (tool.run as unknown as (
              uid: string,
              a: unknown
            ) => Promise<unknown>)(params.userId, args));
        const ms = Math.round(performance.now() - t0);
        trace.push({ name: String(name), args, result, ms });
        responseParts.push({
          functionResponse: {
            name: String(name),
            response: prepResponse(result),
          },
        });
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        const error = e instanceof Error ? e.message : String(e);
        trace.push({ name: String(name), args, error, ms });
        responseParts.push({
          functionResponse: {
            name: String(name),
            response: { error },
          },
        });
      }
    }
    contents.push({ role: "user", parts: responseParts });
  }

  return {
    answer:
      "I couldn't reach a confident answer in the step budget. Try rephrasing or narrowing the question.",
    trace,
    steps: MAX_STEPS,
  };
}
