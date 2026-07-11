import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/user";
import { runAgentLoop, type ChatMessage } from "@/lib/agent/loop";
import { GeminiRateLimitError } from "@/lib/email/parser";
import { checkAndRecord } from "@/lib/agent/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The agent loop makes several Gemini + DB tool calls per question; the default
// ~10s function cap can cut it off mid-loop and leave the UI stuck on
// "Thinking…". Give it real headroom.
export const maxDuration = 60;

const RequestBody = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .max(40)
    .optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Bad request: " + parsed.error.message },
      { status: 400 }
    );
  }

  const user = await getCurrentUser();

  // Burn one slot off the rate buckets *before* spinning up Gemini.
  const limit = checkAndRecord(user.id);
  if (!limit.ok) {
    return Response.json(
      {
        error: limit.message,
        reason: limit.reason,
        retryAfter: limit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  // Only retain {role, content} from history — past traces stay in the client.
  const history: ChatMessage[] = (parsed.data.history ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const result = await runAgentLoop({
      userId: user.id,
      history,
      userMessage: parsed.data.message,
    });
    return Response.json({
      answer: result.answer,
      trace: result.trace,
      steps: result.steps,
    });
  } catch (e) {
    if (e instanceof GeminiRateLimitError) {
      return Response.json(
        {
          error: `Gemini rate-limited. Try again in ${e.retryAfterSeconds}s — no quota was lost.`,
          retryAfter: e.retryAfterSeconds,
        },
        { status: 429 }
      );
    }
    console.error("[api/ask] failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
