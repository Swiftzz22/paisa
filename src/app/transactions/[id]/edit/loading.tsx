// Shown instantly on navigation while the (dynamic) edit page loads, so tapping
// a transaction feels responsive instead of frozen.
export default function EditLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mb-8 h-7 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-10 w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
          </div>
        ))}
      </div>
    </main>
  );
}
