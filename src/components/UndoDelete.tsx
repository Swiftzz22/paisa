"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const UNDO_MS = 5000;

/**
 * Deletes due to go out because their toast went away, keyed by id. Sent a
 * tick later rather than at once, so a toast that's only being re-mounted
 * (React does this on purpose in development) cancels its own send instead of
 * deleting something the person may still undo.
 */
const leaving = new Map<string, number>();

/**
 * "Deleted Swiggy · Undo", in place of an "Are you sure?" dialog.
 *
 * The transaction is only hidden while this is on screen; the delete itself
 * goes out when the five seconds run out, or straight away if the page is
 * left first. Undo is then just not sending it, so nothing has to be put
 * back. A dialog asks people to decide before they've seen the result, and
 * gets clicked through unread; this lets them see it and change their mind.
 */
export function UndoDelete({ id, merchant }: { id: string; merchant: string }) {
  const router = useRouter();
  const [state, setState] = useState<"pending" | "undone" | "done">("pending");
  const settled = useRef(false);

  useEffect(() => {
    window.clearTimeout(leaving.get(id));
    leaving.delete(id);

    function send() {
      if (settled.current) return;
      settled.current = true;
      void fetch(`/api/transactions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
    }
    const timer = window.setTimeout(() => {
      send();
      setState("done");
      // Totals and charts still include it until the page is rebuilt.
      router.replace("/");
      router.refresh();
    }, UNDO_MS);
    window.addEventListener("pagehide", send);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", send);
      // Navigating elsewhere inside the app counts as accepting the delete.
      if (!settled.current) leaving.set(id, window.setTimeout(send, 0));
    };
  }, [id, router]);

  function undo() {
    settled.current = true;
    setState("undone");
    router.replace("/");
  }

  if (state !== "pending") return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-[min(28rem,calc(100%-2rem))] items-center justify-between gap-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-100">
        Deleted {merchant}
      </span>
      <button
        type="button"
        onClick={undo}
        className="shrink-0 font-semibold text-blue-600 dark:text-blue-400"
      >
        Undo
      </button>
      <span
        aria-hidden
        className="undo-drain absolute inset-x-0 bottom-0 h-0.5 origin-left bg-blue-500"
        style={{ animationDuration: `${UNDO_MS}ms` }}
      />
    </div>
  );
}
