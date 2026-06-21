import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { callGeminiWithBackoff } from "@/lib/email/parser";

export type HsbcParsedRow = {
  /** ISO 8601 date the transaction occurred. */
  date: Date;
  /** Cleaned merchant name. */
  merchant: string;
  /** Amount in INR (positive — sign comes from `type`). */
  amount: number;
  /** Always 'card' for HSBC credit card statements. */
  paymentMode: "card";
  /** Raw description from the statement, kept for reference. */
  narration: string;
  /** Purchase ('debit') or refund / payment received ('credit'). */
  type: "debit" | "credit";
};

export type HsbcParseResult = {
  bank: "HSBC";
  cardholder: string;
  rows: HsbcParsedRow[];
  /** Statement period as reported by the LLM, useful for diagnostics. */
  statementPeriod: string | null;
};

// Same model the email parser uses — we know this key has working free-tier
// quota for it. If quality on complex PDFs proves poor, switch to gemini-2.5-flash.
const MODEL = "gemini-2.5-flash-lite";

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cardholder_found: { type: Type.BOOLEAN },
    statement_period: { type: Type.STRING, nullable: true },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING },
          merchant: { type: Type.STRING },
          amount_inr: { type: Type.NUMBER },
          narration: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ["debit", "credit"] },
        },
        required: ["date", "merchant", "amount_inr", "narration", "kind"],
      },
    },
  },
  required: ["cardholder_found", "transactions"],
};

/**
 * Use Gemini to read an HSBC credit-card statement PDF and pull out only the
 * given cardholder's DEBIT transactions on or after `cutoffDate`.
 *
 * HSBC family statements list multiple cardholders separated by markers like
 * "51XX XXXX XXXX 8192 SANIA KOTHARI". The PDFs are image-based so a regex
 * parser doesn't work — multimodal LLM is the practical option.
 */
export async function extractHsbcStatementWithGemini(params: {
  pdfBuffer: Buffer;
  targetCardholder: string;
  cutoffDate: Date;
}): Promise<HsbcParseResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey"
    );
  }
  const ai = new GoogleGenAI({ apiKey });

  const cutoffIso = params.cutoffDate.toISOString().slice(0, 10);
  const prompt = `You are reading an HSBC India credit-card statement PDF. The statement is a
family statement listing transactions for MULTIPLE cardholders, each section
introduced by a header like "51XX XXXX XXXX <last4> <CARDHOLDER NAME>".

TASK: Extract every transaction belonging to **${params.targetCardholder}**
(case-insensitive) that has a transaction date ON OR AFTER ${cutoffIso}.
This includes BOTH purchases ("debit") AND refunds / credits ("credit").

Rules:
- Find the section(s) where the cardholder name matches "${params.targetCardholder}".
  The match should be case-insensitive — names appear in uppercase in the PDF.
- A section continues across page breaks until the next cardholder header.
- Within that section, INCLUDE each transaction line where the transaction
  date is on or after ${cutoffIso}. Set "kind":
    * "debit" for purchases (positive amount, no CR marker).
    * "credit" for refunds and reversals — rows with "CR" after the amount,
      or "REFUND"/"REVERSAL" in the description.
- EXCLUDE:
    * Fees, finance charges, IGST assessments (lines like "FIN CHGS",
      "IGST ASSESSMENT").
    * Bank's own payment-received entries (the line beginning with a date
      and ending with a credit-card-payment marker — anything that's the
      user paying their bill rather than a refund from a merchant).
    * Transactions before ${cutoffIso}.
    * Transactions for other cardholders.
- Date format: ISO 8601 (YYYY-MM-DD). Infer the year from the statement
  period at the top of the statement (e.g. dates printed as "16DEC" within a
  09-Dec-2025-to-08-Jan-2026 statement are Dec 16 2025; "02JAN" is Jan 2 2026).
- merchant: a clean human-readable merchant name (e.g. "Tata Starbucks Privat"
  → "Tata Starbucks", "PAY*BLINKIT" → "Blinkit", "CHN PIZZA HUT" → "Pizza Hut").
  Title-case unless the merchant name is a known brand acronym.
- narration: keep the raw transaction-details column text from the statement
  for reference.

Set cardholder_found=false (and return an empty transactions array) if you
cannot find a section for "${params.targetCardholder}" in this statement.`;

  const base64 = params.pdfBuffer.toString("base64");

  const response = await callGeminiWithBackoff(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64, mimeType: "application/pdf" } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0,
      },
    })
  );

  const text = response.text;
  if (!text) throw new Error("Gemini returned no content.");
  const parsed = JSON.parse(text) as {
    cardholder_found: boolean;
    statement_period?: string | null;
    transactions: Array<{
      date: string;
      merchant: string;
      amount_inr: number;
      narration: string;
      kind: "debit" | "credit";
    }>;
  };

  const cutoff = params.cutoffDate.getTime();
  const rows: HsbcParsedRow[] = [];
  for (const t of parsed.transactions ?? []) {
    const d = new Date(`${t.date}T12:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getTime() < cutoff) continue;
    if (!(t.amount_inr > 0)) continue;
    if (!t.merchant || !t.merchant.trim()) continue;
    rows.push({
      date: d,
      merchant: t.merchant.trim(),
      amount: Math.round(t.amount_inr * 100) / 100,
      paymentMode: "card",
      narration: (t.narration ?? "").trim(),
      type: t.kind === "credit" ? "credit" : "debit",
    });
  }

  return {
    bank: "HSBC",
    cardholder: params.targetCardholder,
    rows,
    statementPeriod: parsed.statement_period ?? null,
  };
}
