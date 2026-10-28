/**
 * The one thing paisa. does, shown rather than described: a bank alert email
 * arrives and settles into a sorted transaction. Pure CSS, so it costs nothing
 * on the server and runs before any JavaScript has loaded.
 *
 * The alert text mirrors the real HDFC format the parser sees most often, so
 * someone who banks there recognises their own inbox in it.
 */
export function AlertDemo() {
  return (
    <div
      className="relative mx-auto w-full max-w-sm"
      role="img"
      aria-label="A bank alert for ₹249 to Swiggy becomes a transaction filed under Food."
    >
      <div className="alert-demo-mail night-card p-4 font-mono text-[12px] leading-relaxed text-[var(--nl-muted)]">
        <p className="mb-1 font-sans text-[13px] font-semibold text-[var(--nl-ink)]">
          HDFC Bank Alert
        </p>
        Rs.249.00 debited from a/c **4821 to VPA swiggy@icici on 28-10-26.
      </div>

      <div className="relative mx-auto h-10 w-px">
        <div className="alert-demo-beam absolute inset-0 bg-gradient-to-b from-[var(--nl-hi)] to-transparent" />
      </div>

      <div className="alert-demo-tx night-card flex items-center justify-between p-4 text-sm">
        <span className="flex items-center gap-2">
          <span className="font-medium text-[var(--nl-ink)]">Swiggy</span>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-[var(--nl-green)]">
            Food
          </span>
        </span>
        <span className="font-mono font-medium tabular-nums text-[var(--nl-ink)]">
          ₹249
        </span>
      </div>

      <div className="mt-6 text-xs text-[var(--nl-muted)]">
        Spent this month
        <span className="mt-0.5 block font-mono text-3xl font-medium tracking-tight tabular-nums text-[var(--nl-ink)]">
          ₹18,420
        </span>
      </div>
    </div>
  );
}
