import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { runAgentLoop, type ChatMessage } from "@/lib/agent/loop";
import { GeminiRateLimitError } from "@/lib/email/parser";
import { checkAndRecord } from "@/lib/agent/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
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

/** Bearer-authed "Ask paisa" chat for the native app. Mirrors /api/ask. */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const limit = checkAndRecord(user.id);
  if (!limit.ok) {
    return Response.json(
      { error: limit.message, retryAfter: limit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

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
    return Response.json({ answer: result.answer });
  } catch (e) {
    if (e instanceof GeminiRateLimitError) {
      return Response.json(
        { error: `The chat is busy. Try again in ${e.retryAfterSeconds}s.` },
        { status: 429 }
      );
    }
    return Response.json(
      { error: "Something went wrong answering that." },
      { status: 500 }
    );
  }
}
