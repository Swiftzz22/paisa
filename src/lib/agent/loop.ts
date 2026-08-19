import "server-only";
import { AGENT_TOOLS, getContext } from "@/lib/agent/tools";
import { FUNCTION_DECLARATIONS } from "@/lib/agent/declarations";
import { GeminiRateLimitError } from "@/lib/email/parser";

/** Map tool name → array of expected canonical parameter names. */
const EXPECTED_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  FUNCTION_DECLARATIONS.map((d) => [
    d.name,
    d.parameters?.properties ? Object.keys(d.parameters.properties) : [],
  ])
);

// NVIDIA's build platform exposes an OpenAI-compatible endpoint. Get a key
// (nvapi-…) at https://build.nvidia.com. Model availability there is not
// stable: meta/llama-3.1-8b-instruct stopped serving entirely (every
// completions call hung past 30s while /v1/models still listed it), and
// llama-3.3-70b and the nemotron-nano-8b variants time out the same way.
// gpt-oss-20b answers in well under a second with clean OpenAI-format tool
// calls; mistralai/mistral-nemotron is the verified backup if this one goes
// dark. If the agent starts timing out again, re-test before assuming the key.
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";
/** Per-call cap so a rare slow/queued response can't eat the whole 60s budget. */
const CALL_TIMEOUT_MS = 18_000;
// Each step is one model round-trip. Most questions resolve in 2–3.
const MAX_STEPS = 5;
/** Hard cap on the JSON size of a tool result before going back to the model. */
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
 * arithmetic (small models are unreliable at "what date was last Monday?").
 * India has no DST, so IST is a fixed UTC+5:30 offset.
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
- DEBIT vs CREDIT: spending/expense questions ("biggest transaction", "most I spent", "how much on X", "top merchants") use type "debit". Use "credit" ONLY when the user explicitly asks about money received, income, refunds, or credits.
- Payment-mode values are lowercase: upi, card, cash, bank_transfer.

TOOL CALL DISCIPLINE:
- Use the EXACT parameter names from the schemas (monthlyTotals takes "fromMonth"/"toMonth" — not "from1Month" or "from_month").
- If a tool returns a parameter error, READ it, fix the name/value, and CALL AGAIN. You have up to ${MAX_STEPS} steps — spend them recovering, don't give up after one failed call.
- Dates are YYYY-MM-DD, months YYYY-MM. Never include a time.
- When you have enough data to answer, reply in plain text with NO further tool calls.

WORKED EXAMPLES:
- "biggest UPI transaction this week" → queryTransactions({ type:"debit", paymentMode:"upi", from:"${weekStart}", to:"${a.today}", limit:1 })
- "how much did I spend last Monday" → aggregateByCategory({ from:"${a.lastWeekdayDates.Monday}", to:"${a.lastWeekdayDates.Monday}" }), then sum the returned categories.

CURRENT STATE (no need to call getContext):
- Top-level categories: ${ctx.categories.join(", ")}
- Payment modes: ${ctx.modes.map((m) => `${m.value} (${m.label})`).join(", ")}

If a question truly can't be answered with the tools, say so plainly rather than improvising.`;
}

/**
 * Coerce model-supplied argument names to the canonical names the tool expects.
 * Small models sometimes emit "from_month" / "from1Month" instead of
 * "fromMonth"; normalise each key (lowercase + strip non-letters) and match it
 * against the canonical schema keys under the same normalisation.
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
      out[incoming] = value;
      continue;
    }
    const matched = canonicalByNorm.get(norm(incoming));
    const target = matched ?? incoming;
    if (!(target in out)) out[target] = value;
  }
  return out;
}

/** 8B occasionally uppercases enum values ("UPI", "DEBIT"); lowercase the known
 * enum fields so they match stored values. */
function normalizeEnums(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const k of ["paymentMode", "type"]) {
    if (typeof out[k] === "string") out[k] = (out[k] as string).toLowerCase();
  }
  return out;
}

/** Truncate an oversized tool result so a runaway query can't blow the context. */
function prepResult(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (json.length <= MAX_RESULT_BYTES) return value ?? null;
  return {
    _truncated: true,
    _originalBytes: json.length,
    _maxBytes: MAX_RESULT_BYTES,
    head: json.slice(0, MAX_RESULT_BYTES),
  };
}

// ---- NVIDIA (OpenAI-compatible) tool schema + client ----------------------

/** Recursively lower-case JSON-Schema `type` values (Gemini uses UPPERCASE). */
function toJsonSchema(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "type" && typeof v === "string") {
      out[k] = v.toLowerCase();
    } else if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [
          pk,
          toJsonSchema(pv),
        ])
      );
    } else if (k === "items") {
      out[k] = toJsonSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const OPENAI_TOOLS = FUNCTION_DECLARATIONS.map((d) => ({
  type: "function" as const,
  function: {
    name: d.name,
    description: d.description,
    parameters: toJsonSchema(d.parameters),
  },
}));

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function nvidiaChat(
  apiKey: string,
  messages: ChatMsg[]
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: OPENAI_TOOLS,
        temperature: 0,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(
        `NVIDIA request timed out after ${CALL_TIMEOUT_MS / 1000}s.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after")) || 20;
    throw new GeminiRateLimitError(ra); // reuse: the UI auto-retries on this
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NVIDIA API ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message ?? {};
  return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [] };
}

/**
 * Run one agent turn. Loops the model + tool execution until it emits a
 * text-only response or we hit MAX_STEPS. History is plain {role, content}
 * pairs — past tool calls are not replayed.
 */
export async function runAgentLoop(params: {
  userId: string;
  history: ChatMessage[];
  userMessage: string;
}): Promise<AgentResult> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NVIDIA_API_KEY is not set. Get a free key at https://build.nvidia.com"
    );
  }

  const ctx = await getContext(params.userId);
  const systemPrompt = buildSystemPrompt(
    {
      earliest: ctx.earliestTransactionDate,
      categories: ctx.availableCategories,
      modes: ctx.availablePaymentModes,
    },
    computeDateAnchors()
  );

  const messages: ChatMsg[] = [{ role: "system", content: systemPrompt }];
  for (const m of params.history) {
    messages.push({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    });
  }
  messages.push({ role: "user", content: params.userMessage });

  const trace: TraceEntry[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await nvidiaChat(apiKey, messages);

    if (reply.toolCalls.length === 0) {
      const text = (reply.content ?? "").trim();
      return {
        answer: text || "I don't have an answer for that.",
        trace,
        steps: step + 1,
      };
    }

    // Record the assistant's tool-call turn, then answer each call.
    messages.push({
      role: "assistant",
      content: reply.content ?? null,
      tool_calls: reply.toolCalls,
    });

    for (const call of reply.toolCalls) {
      const name = call.function.name as keyof typeof AGENT_TOOLS;
      let rawArgs: Record<string, unknown> = {};
      try {
        rawArgs = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        rawArgs = {};
      }
      const expected = EXPECTED_KEYS[name as string] ?? [];
      const args = normalizeEnums(coerceArgs(rawArgs, expected));
      const tool = AGENT_TOOLS[name];
      const t0 = performance.now();
      let responseObj: unknown;

      if (!tool) {
        const error = `Unknown tool: ${String(name)}`;
        trace.push({ name: String(name), args, error, ms: 0 });
        responseObj = { error };
      } else {
        try {
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
          responseObj = prepResult(result);
        } catch (e) {
          const ms = Math.round(performance.now() - t0);
          const error = e instanceof Error ? e.message : String(e);
          trace.push({ name: String(name), args, error, ms });
          responseObj = { error };
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(responseObj),
      });
    }
  }

  return {
    answer:
      "I couldn't reach a confident answer in the step budget. Try rephrasing or narrowing the question.",
    trace,
    steps: MAX_STEPS,
  };
}
