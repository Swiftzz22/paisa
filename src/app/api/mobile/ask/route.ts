import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { runAgentLoop, type ChatMessage } from "@/lib/agent/loop";
import { GeminiRateLimitError } from "@/lib/email/parser";
import { checkAndRecord } from "@/lib/agent/rate-limit";
import { checkAllowance, consume, paywallResponse } from "@/lib/billing";

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

/**
 * The model writes Markdown — **bold**, # headings, - bullets — and the app
 * shows answers as plain text, so the symbols came through literally: a
 * reviewer saw "**₹62,400.00**" with the asterisks still on. Strip the syntax
 * and keep the words. Done here rather than in the agent because the website
 * renders the same answers and is free to keep the formatting.
 */
function plainText(answer: string): string {
  return answer
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

  // Metered: every answer is a model call. Checked before the work and only
  // consumed after it succeeds, so a failed answer costs nobody an allowance.
  const tz = Number(new URL(req.url).searchParams.get("tzOffset") ?? 0);
  const allowance = await checkAllowance(user.id, "ask", tz);
  if (!allowance.allowed) return paywallResponse(allowance, "questions");

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
    await consume(user.id, "ask", tz);
    return Response.json({ answer: plainText(result.answer) });
  } catch (e) {
    if (e instanceof GeminiRateLimitError) {
      return Response.json(
        { error: `The chat is busy. Try again in ${e.retryAfterSeconds}s.` },
        { status: 429 }
      );
    }
    // Log the real reason, return a safe one. Upstream messages can carry
    // provider internals, and now that strangers share this deployment they
    // are not the caller's to read.
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[mobile/ask] failed:", detail);
    return Response.json(
      { error: "Couldn't answer that just now. Please try again." },
      { status: 500 }
    );
  }
}
