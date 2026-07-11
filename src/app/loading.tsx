// Shown during navigations to routes without their own loading UI (notably the
// dashboard when you tap a category/payment label or change the range). The
// page is dynamic + on free-tier hosting, so without this a slow render looks
// frozen. This gives instant feedback instead.
export default function Loading() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-3xl items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-zinc-500 dark:text-zinc-400">
        <span
          aria-hidden
          className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}
