"use client";

import { useEffect, useRef, useState } from "react";

type TraceEntry = {
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
  ms: number;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  trace?: TraceEntry[];
  steps?: number;
  errored?: boolean;
};

const EXAMPLES: string[] = [
  "How much did I spend on Subscriptions this month?",
  "Compare my May spend to April",
  "Top 5 merchants since Jan",
  "What's my biggest UPI transaction this week?",
];

export function AskChat({
  categories,
  containerClassName,
}: {
  categories: string[];
  /** Override the outer container sizing (e.g. for use inside a popover). */
  containerClassName?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom as messages stream in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  /** Find the most recent user message that hasn't yet got a successful reply. */
  function lastUserMessage(): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return null;
  }

  /** Re-send the last user message after dropping the errored assistant reply. */
  async function retryLast() {
    const last = lastUserMessage();
    if (!last || loading) return;
    // Drop the last assistant message (the error) so the retry doesn't see it.
    let trimmed = [...messages];
    if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") {
      trimmed = trimmed.slice(0, -1);
    }
    // Drop the trailing user message too — `send` will re-add it.
    if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "user") {
      trimmed = trimmed.slice(0, -1);
    }
    setMessages(trimmed);
    // Wait a tick so React commits before we mutate again.
    await new Promise((r) => setTimeout(r, 0));
    await send(last);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: Msg = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      // Read as text first: a timed-out or crashed function returns an HTML /
      // plain-text platform error page, not JSON. res.json() would throw a
      // cryptic "Unexpected token 'A'…" — parse defensively instead.
      const raw = await res.text();
      let data:
        | { error?: string; answer?: string; trace?: TraceEntry[]; steps?: number }
        | null = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data) {
        const friendly =
          res.status === 504 || res.status === 408
            ? "That took too long to answer. Try a narrower question and ask again."
            : res.status >= 500
              ? "The assistant hit a snag on the server. Give it a moment and try again."
              : `Server returned ${res.status}.`;
        setMessages([
          ...nextMessages,
          {
            role: "assistant",
            content: data?.error ?? friendly,
            errored: true,
          },
        ]);
      } else {
        setMessages([
          ...nextMessages,
          {
            role: "assistant",
            content: data.answer ?? "I don't have an answer for that.",
            trace: data.trace,
            steps: data.steps,
          },
        ]);
      }
    } catch (e) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: e instanceof Error ? e.message : String(e),
          errored: true,
        },
      ]);
    } finally {
      setLoading(false);
      // Refocus the textarea once the answer arrives.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div
      className={
        containerClassName ??
        "flex h-[calc(100dvh-7rem)] w-full flex-col sm:h-[calc(100dvh-3rem)]"
      }
    >
      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {messages.length === 0 ? (
          <EmptyState
            categories={categories}
            onExample={(q) => send(q)}
            disabled={loading}
          />
        ) : (
          messages.map((m, i) => {
            const isLastAssistantError =
              m.role === "assistant" &&
              m.errored === true &&
              i === messages.length - 1;
            return (
              <MessageBubble
                key={i}
                msg={m}
                onRetry={isLastAssistantError ? retryLast : undefined}
                retrying={loading}
              />
            );
          })
        )}
        {loading ? (
          <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
              Thinking…
            </span>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 flex items-end gap-2 border-t border-zinc-200 bg-white pt-3 dark:border-zinc-800 dark:bg-black"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your spending…"
          rows={1}
          className="input min-h-[44px] max-h-32 flex-1 resize-none"
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          {loading ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  msg,
  onRetry,
  retrying,
}: {
  msg: Msg;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900 sm:max-w-[75%]">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className={
          "w-full max-w-[95%] rounded-2xl border px-4 py-3 text-sm sm:max-w-[85%] " +
          (msg.errored
            ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            : "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50")
        }
      >
        <div className="whitespace-pre-wrap">{msg.content}</div>
        {onRetry ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-900 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900/40"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}
        {msg.trace && msg.trace.length > 0 ? (
          <Trace trace={msg.trace} steps={msg.steps} />
        ) : null}
      </div>
    </div>
  );
}

function Trace({
  trace,
  steps,
}: {
  trace: TraceEntry[];
  steps?: number;
}) {
  // Open by default in dev so we can debug; collapsed in prod so end users
  // see clean answers. NODE_ENV is inlined at build time.
  const [open, setOpen] = useState(
    process.env.NODE_ENV !== "production"
  );
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800"
    >
      <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wide text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
        Trace · {trace.length} tool call{trace.length === 1 ? "" : "s"}
        {steps ? ` · ${steps} step${steps === 1 ? "" : "s"}` : ""}
      </summary>
      <ol className="mt-2 space-y-2 text-[11px]">
        {trace.map((t, i) => (
          <li
            key={i}
            className="rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-zinc-700 dark:text-zinc-200">
              {t.name}({" "}
              <span className="text-zinc-500 dark:text-zinc-400">
                {JSON.stringify(t.args)}
              </span>{" "}
              ){" "}
              <span className="text-zinc-400 dark:text-zinc-500">
                · {t.ms}ms
              </span>
            </div>
            {t.error ? (
              <div className="mt-1 text-red-600 dark:text-red-400">
                error: {t.error}
              </div>
            ) : (
              <details className="mt-1">
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                  result
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-200">
                  {JSON.stringify(t.result, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function EmptyState({
  categories,
  onExample,
  disabled,
}: {
  categories: string[];
  onExample: (q: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Ask anything about your spending.
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Powered by Gemini + a small set of read-only query tools over your
          transactions. The agent never writes, edits, or moves money — it
          only answers questions.
        </p>
        {categories.length > 0 ? (
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Known categories: {categories.join(", ")}
          </p>
        ) : null}
      </div>
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Examples
        </p>
        <ul className="space-y-1.5">
          {EXAMPLES.map((q) => (
            <li key={q}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onExample(q)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
