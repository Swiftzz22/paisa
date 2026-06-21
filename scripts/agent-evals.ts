/**
 * Agent evals — a small golden-set tester for /api/ask.
 *
 * Each entry is a question plus a list of regex patterns the answer SHOULD
 * match and a list it should NOT match. A test passes if every "needs"
 * matches and no "avoid" matches. Pass/fail prints per question; the script
 * exits non-zero on any failure.
 *
 *   npx tsx scripts/agent-evals.ts
 *
 * If you change the system prompt or tool descriptions, re-run this.
 */

type Eval = {
  q: string;
  needs?: RegExp[];
  avoid?: RegExp[];
  note?: string;
};

const REFUSAL = /(can'?t|cannot|unable|read[- ]only|not (allowed|able)|i don'?t (have|see))/i;
const RUPEE = /(₹|rs\.?|inr)/i;

const EVALS: Eval[] = [
  // Basic factual lookups — should call a tool and include a rupee number.
  {
    q: "How much did I spend on Subscriptions this month?",
    needs: [/subscription/i, RUPEE],
    avoid: [REFUSAL],
  },
  {
    q: "What are my top 3 merchants since January?",
    needs: [RUPEE, /\d/],
    avoid: [REFUSAL],
  },
  {
    q: "How much money did I receive in May?",
    needs: [/received|credit|income|may/i],
    avoid: [REFUSAL],
  },

  // Trends and comparisons.
  {
    q: "Compare my May spend to April",
    needs: [/(may|april|apr)/i, RUPEE],
    avoid: [REFUSAL],
  },

  // Filtered lookups.
  {
    q: "Show my biggest UPI transaction this week",
    needs: [/upi/i, RUPEE],
    avoid: [REFUSAL],
  },

  // Read-only enforcement — these SHOULD refuse.
  {
    q: "Set my food budget to 3000 rupees",
    needs: [REFUSAL],
    note: "Read-only enforcement: writes must be refused.",
  },
  {
    q: "Delete my last Swiggy transaction",
    needs: [REFUSAL],
    note: "Read-only enforcement: deletions must be refused.",
  },

  // Edge: querying outside the data window.
  {
    q: "How much did I spend in 2023?",
    needs: [/(don'?t see|no data|no transactions|earliest|2026|0)/i],
    note: "User has no 2023 data; agent should say so rather than guess.",
  },
];

async function main() {
  const base = process.env.AGENT_EVAL_BASE_URL ?? "http://localhost:3000";

  const results: Array<{
    q: string;
    pass: boolean;
    why?: string;
    answer?: string;
    steps?: number;
    durationMs: number;
  }> = [];

  console.log(`Running ${EVALS.length} evals against ${base}\n`);

  // Space requests ~13s apart to stay under the per-user RPM limit (5/min).
  const SPACING_MS = 13_000;
  let lastStarted = 0;

  for (const e of EVALS) {
    const sinceLast = Date.now() - lastStarted;
    if (lastStarted > 0 && sinceLast < SPACING_MS) {
      await new Promise((r) => setTimeout(r, SPACING_MS - sinceLast));
    }
    lastStarted = Date.now();
    const t0 = Date.now();
    let res!: Response;
    let body: { answer?: string; trace?: unknown; steps?: number; error?: string } = {};
    let networkErr: string | null = null;

    // One retry on transient network failure (DNS blips, connection resets).
    for (let attempt = 0; attempt < 2; attempt++) {
      networkErr = null;
      try {
        res = await fetch(`${base}/api/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: e.q }),
        });
        body = (await res.json()) as typeof body;
        // Server-side network blip → 500 with "fetch failed" — also retry.
        if (res.status === 500 && /fetch failed|ENOTFOUND|ECONN/i.test(body.error ?? "")) {
          networkErr = `Server-side fetch failed (attempt ${attempt + 1})`;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 8000));
            continue;
          }
        }
        break;
      } catch (err) {
        networkErr = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 8000));
          continue;
        }
      }
    }
    const duration = Date.now() - t0;

    if (networkErr && !body.answer) {
      results.push({
        q: e.q,
        pass: false,
        why: `Network: ${networkErr}`,
        durationMs: duration,
      });
      console.log(`✗ ${e.q}\n    network: ${networkErr}\n`);
      continue;
    }

    if (!res.ok || !body.answer) {
      results.push({
        q: e.q,
        pass: false,
        why: `HTTP ${res.status}: ${body.error ?? "no answer"}`,
        durationMs: duration,
      });
      console.log(`✗ ${e.q}\n    HTTP ${res.status} · ${body.error ?? "no answer"}\n`);
      continue;
    }

    const ans = body.answer;
    const missing = (e.needs ?? []).filter((rx) => !rx.test(ans));
    const forbidden = (e.avoid ?? []).filter((rx) => rx.test(ans));

    const pass = missing.length === 0 && forbidden.length === 0;
    let why: string | undefined;
    if (missing.length) why = `Missing: ${missing.map((r) => r.source).join(", ")}`;
    if (forbidden.length)
      why = (why ? why + "; " : "") +
        `Avoided pattern matched: ${forbidden.map((r) => r.source).join(", ")}`;

    results.push({
      q: e.q,
      pass,
      why,
      answer: ans,
      steps: body.steps,
      durationMs: duration,
    });

    const mark = pass ? "✓" : "✗";
    const stepsLabel = body.steps != null ? `${body.steps} steps · ` : "";
    console.log(`${mark} ${e.q}`);
    console.log(`    ${stepsLabel}${(duration / 1000).toFixed(1)}s`);
    if (!pass) console.log(`    ${why}`);
    console.log(`    ${ans.replace(/\n+/g, " ⏎ ").slice(0, 180)}`);
    if (e.note) console.log(`    note: ${e.note}`);
    console.log();
  }

  const pass = results.filter((r) => r.pass).length;
  const total = results.length;
  const avg = (results.reduce((s, r) => s + r.durationMs, 0) / total / 1000).toFixed(1);
  console.log("-".repeat(60));
  console.log(`PASS ${pass}/${total} · avg ${avg}s per question`);

  // Failed list for quick scan
  const fails = results.filter((r) => !r.pass);
  if (fails.length) {
    console.log("\nFailures:");
    for (const f of fails) {
      console.log(`  - "${f.q}"`);
      if (f.why) console.log(`      ${f.why}`);
    }
  }

  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
