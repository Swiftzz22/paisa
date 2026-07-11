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

// gemini-2.5-flash-lite: ~30 RPM (vs 10 on regular flash) and faster. We
// previously avoided it because it mangled parameter names like
// `from1Month`, but coerceArgs() below normalises those, so Lite is back on
// the menu — and the higher rate ceiling matters a lot for interactive chat.
const MODEL = "gemini-2.5-flash-lite";
const MAX_STEPS = 8;
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

function buildSystemPrompt(ctx: {
  today: string;
  earliest: string | null;
  categories: string[];
  modes: Array<{ value: string; label: string }>;
}): string {
  return `You are paisa.'s assistant for Sania, a college student in India tracking her personal spending. Help her answer questions about her own financial data using ONLY the tools you've been given.

GROUND RULES (non-negotiable):
1. All numbers MUST come from tool calls. Never invent, estimate, or guess. If a tool returns no rows, say "I don't see any data for that" plainly.
2. Today is ${ctx.today}. The earliest transaction on file is ${ctx.earliest ?? "unknown"}.
3. Money is in INR. Format as ₹1,23,456.78 (Indian comma grouping).
4. Be concise — one short paragraph plus a small list at most. No filler, no disclaimers.
5. If a question is ambiguous (e.g. "last month" — calendar vs fiscal), pick the obvious interpretation and state which.
6. ALL TOOLS ARE READ-ONLY. Never claim to have changed, created, or set anything.
7. When users mention a category, map to one of the EXACT top-level category names below.

TOOL CALL DISCIPLINE:
- Use the EXACT parameter names from the tool schemas (e.g. monthlyTotals takes "fromMonth" and "toMonth" — NOT "from1Month", "from_month", or "month_from").
- If a tool returns an error message about a parameter, READ the error, fix the parameter name or value, and CALL THE TOOL AGAIN. Do not give up after one failed call. You have up to ${MAX_STEPS} steps; spend them on recovery.
- Dates are YYYY-MM-DD. Months are YYYY-MM. Never include a time.

CURRENT STATE (no need to call getContext for this):
- Top-level categories: ${ctx.categories.join(", ")}
- Payment modes: ${ctx.modes.map((m) => `${m.value} (${m.label})`).join(", ")}

If a question can't be answered with the available tools, say so directly rather than improvising.`;
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
  const systemPrompt = buildSystemPrompt({
    today: ctx.today,
    earliest: ctx.earliestTransactionDate,
    categories: ctx.availableCategories,
    modes: ctx.availablePaymentModes,
  });

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
