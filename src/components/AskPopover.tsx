"use client";

import { useEffect, useState } from "react";
import { AskChat } from "@/components/AskChat";

/**
 * Floating chat popover. Renders nothing on mobile (where the bottom nav
 * already exposes /ask as a dedicated full-screen page) — on desktop it
 * surfaces a FAB at the bottom-right that opens a sliding side panel with
 * the same chat experience as the /ask page.
 *
 * State is local to the component instance: closing the popover preserves
 * the chat for the rest of the session, but a hard reload starts fresh.
 * Persisting across reloads is a v1.x polish (localStorage).
 */
export function AskPopover({ categories }: { categories: string[] }) {
  const [open, setOpen] = useState(false);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock scroll on body when open (desktop only — mobile uses /ask).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    if (window.matchMedia("(min-width: 640px)").matches) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* FAB — visible on desktop only, hidden while panel is open. */}
      <button
        type="button"
        aria-label="Ask paisa."
        onClick={() => setOpen(true)}
        className={
          "fixed bottom-6 right-6 z-30 hidden h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg shadow-zinc-900/30 transition-transform hover:scale-105 active:scale-95 sm:flex dark:bg-zinc-50 dark:text-zinc-900 dark:shadow-zinc-50/20 " +
          (open ? "pointer-events-none opacity-0" : "opacity-100")
        }
      >
        <SparkleIcon />
      </button>

      {/* Backdrop — desktop only. */}
      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 hidden bg-black/30 backdrop-blur-[2px] sm:block"
        />
      ) : null}

      {/* Panel — desktop only. Mobile users use the bottom-nav Ask tab → /ask. */}
      {open ? (
        <aside
          aria-label="Ask paisa. chat"
          className="fixed right-6 top-6 bottom-6 z-50 hidden w-[420px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:flex dark:border-zinc-800 dark:bg-zinc-950"
        >
          <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Ask paisa.
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <div className="flex flex-1 flex-col px-4 pb-4">
            <AskChat
              categories={categories}
              containerClassName="flex flex-1 w-full flex-col min-h-0"
            />
          </div>
        </aside>
      ) : null}
    </>
  );
}

function SparkleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
