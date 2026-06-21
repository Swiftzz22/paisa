# paisa.

A personal finance tracker built for Indian banking. It auto-logs your spending by reading bank, UPI, and credit-card notification emails from Gmail, parses them with an LLM, and lets you **ask questions about your money in plain English**. Designed mobile-first as an installable PWA.

> Built for real use — it ingests live HDFC / HSBC / UPI emails and bank statements, not toy data.

---

## What it does

- **Automatic transaction logging from email.** Connects to Gmail (read-only), filters to known bank/UPI/card senders, and uses Google Gemini to extract `{amount, merchant, payment mode, date, debit/credit}` from each notification — turning your inbox into a ledger with no manual entry.
- **Statement import.** Upload an HDFC account statement (`.xls`) or a multi-cardholder HSBC credit-card statement (`.pdf`); it extracts your transactions (the HSBC PDFs are image-based, so they're parsed via Gemini's multimodal API) and de-duplicates against what email ingestion already captured.
- **Agentic "Ask paisa." assistant.** A chat agent with a small set of read-only query tools (`queryTransactions`, `aggregateByCategory`, `aggregateByMerchant`, `monthlyTotals`). Ask *"compare my May spend to April"* or *"top 5 merchants since Jan"* and it plans tool calls, reads the results, and answers — with a collapsible trace of exactly which tools it ran.
- **Self-improving categorization.** Hierarchical categories with an LLM first-pass; when you correct a category you can save a rule, which is then applied retroactively and to all future matches.
- **Dashboard.** Interactive cover with animated totals, category + payment-mode pie charts (click a slice to filter), a 12-month trend bar, per-day grouped transactions, month-over-month delta, and budget pacing.
- **Budgets.** Soft monthly caps per category with progress bars and pace warnings.
- **Multi-user.** Sign in with Google; each user's data is fully isolated.

## Tech stack

- **Next.js 16** (App Router, Server Actions, Turbopack) + **TypeScript** + **Tailwind CSS 4**
- **Prisma 7** over **SQLite** (local) / **libSQL–Turso** (production)
- **Google Gemini** (`@google/genai`) for email extraction, statement OCR, and the chat agent's tool-calling loop
- **Gmail API** + **Google OAuth 2.0** (`googleapis`) for ingestion and login
- **Recharts** for visualizations
- Hand-rolled session auth (server-side `Session` table, httpOnly cookie) — no auth framework dependency

## Architecture highlights

- **Email → transaction pipeline.** Gmail-side sender filter → cheap local keyword classifier (skips marketing/OTPs without spending an LLM call) → batched Gemini extraction (multiple emails per call) → rule-match → insert, with rate-limit-aware backoff and de-duplication by message id and by (date, amount, merchant).
- **Agent loop.** A from-scratch ReAct loop: typed tools (Zod-validated), a model-arg *coercer* that normalises the parameter-name drift LLMs produce, per-result size caps, `MAX_STEPS`, and a rate-limited API with an eval suite (`scripts/agent-evals.ts`).
- **Auth.** Login and Gmail-connect share one OAuth client and callback URL; the callback branches on a state cookie. Login uses only basic scopes (no consent warning); Gmail ingestion requests the sensitive scope separately and opt-in.
- **Background sync.** An in-process interval in dev; a secret-protected cron route (`/api/cron/sync`) for serverless production.

## Getting started

```bash
npm install
cp .env.example .env        # then fill in the values (see below)
npx prisma db push          # apply schema to a fresh SQLite db
npm run db:seed             # seed default categories + payment modes
npm run dev                 # http://localhost:3000
```

You'll need a **Google OAuth client** (for login + Gmail), a **Gemini API key** (free tier), and a generated **`TOKEN_ENCRYPTION_KEY`**. See [`.env.example`](.env.example) for every variable, and the [Google setup walkthrough](#google-cloud-setup) below.

### Useful scripts

| Command                  | What it does                                  |
| ------------------------ | --------------------------------------------- |
| `npm run dev`            | Start the dev server                          |
| `npm run build`          | Production build                              |
| `npm run db:seed`        | Seed default categories / payment modes       |
| `npm run db:studio`      | Browse the database in Prisma Studio          |
| `npx tsx scripts/agent-evals.ts` | Run the chat-agent eval suite         |

## Google Cloud setup

The app uses one OAuth client for both login and Gmail ingestion.

1. **Create an OAuth client** at [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients): type **Web application**, and add the redirect URI:
   ```
   http://localhost:3000/api/auth/google/callback
   ```
2. **Enable the Gmail API** (APIs & Services → Library → Gmail API → Enable).
3. **Publish the consent screen** (Audience tab → Publish app) so login tokens don't expire on the 7-day testing-mode clock. The "unverified app" warning is expected for a personal project — click through it.
4. Put the **Client ID / Secret** in `.env`, plus a **Gemini key** from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
5. Restart, open the app, **Sign in with Google**, then connect Gmail under Settings → Email.

> **Workspace (school/company) accounts** may be blocked by admin policy — use a personal Gmail.

## Status

Actively built and used. Single-currency (INR) by design. Deployment to Vercel + Turso and a Capacitor mobile wrapper are in progress.

## Notes

This is a personal project. No financial data is committed to the repo — the local database (`*.db`) and all secrets (`.env`) are gitignored.
