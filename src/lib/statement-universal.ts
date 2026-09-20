import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import * as XLSX from "xlsx";
import { callGeminiWithBackoff, OutOfTimeError } from "@/lib/email/parser";

// Statement parsing is infrequent and accuracy-critical (wrong numbers = wrong
// finances), so we use the stronger model rather than -lite.
const MODEL = "gemini-2.5-flash";

// Cap the text we send for spreadsheet/CSV statements. ~60k chars comfortably
// covers a long statement without risking an oversized request.
const MAX_TEXT_CHARS = 60_000;

export type CategoryChoice = { label: string; id: string };

export type UniversalRow = {
  date: Date;
  merchant: string;
  amount: number; // positive; direction is in `type`
  type: "debit" | "credit";
  paymentMode: "upi" | "card" | "cash" | "bank_transfer";
  narration: string;
  /** Bank's own transaction reference / UTR / cheque no., if present. */
  reference: string | null;
  /** A label from the provided category list, or null. */
  categoryLabel: string | null;
};

export type UniversalParseResult = {
  bank: string;
  rows: UniversalRow[];
  warnings: string[];
};

type FileKind = "pdf" | "spreadsheet" | "csv" | "unknown";

function detectKind(filename: string): FileKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return "spreadsheet";
  if (ext === "csv" || ext === "txt") return "csv";
  return "unknown";
}

/** Flatten every sheet of a workbook into labelled CSV text. */
function spreadsheetToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    parts.push(`--- Sheet: ${name} ---\n${csv}`);
  }
  return parts.join("\n\n");
}

const ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING, description: "ISO YYYY-MM-DD" },
    merchant: { type: Type.STRING },
    amount_inr: { type: Type.NUMBER },
    kind: { type: Type.STRING, enum: ["debit", "credit"] },
    payment_mode: {
      type: Type.STRING,
      enum: ["upi", "card", "cash", "bank_transfer"],
    },
    reference: { type: Type.STRING, nullable: true },
    narration: { type: Type.STRING },
    category_label: { type: Type.STRING, nullable: true },
  },
  required: ["date", "merchant", "amount_inr", "kind", "payment_mode"],
};

function buildPrompt(params: {
  cardholderName?: string | null;
  labels: string[];
}): string {
  const cardholderRule = params.cardholderName
    ? `\nThis is a JOINT / FAMILY statement covering multiple cardholders. ONLY include transactions belonging to "${params.cardholderName}" (case-insensitive — their section is usually headed by their name and card number). Skip every other cardholder's transactions entirely.`
    : "";

  return `You are extracting transactions from an Indian bank or credit-card statement (any bank/issuer, any format). Reply with structured JSON only.

Extract EVERY real transaction row. For each:
- date: ISO 8601 (YYYY-MM-DD). If a row shows only day+month, infer the year from the statement period printed on the statement.
- merchant: the cleaned counterparty name. "SWIGGY*ONLINE BLR" -> "Swiggy"; "UPI-SPOTIFY INDIA..." -> "Spotify"; for UPI to a person, keep their full name in Title Case.
- amount_inr: the absolute rupee value as a positive number. Direction goes in "kind".
- kind: "debit" for money OUT (purchase, withdrawal, payment, UPI sent), "credit" for money IN (deposit, refund, reversal, UPI received, salary).
- payment_mode: "upi" (UPI/VPA handles like name@bank), "card" (POS/card swipe/online card — default for credit-card statements), "bank_transfer" (NEFT/IMPS/RTGS/account transfer), or "cash" (ATM/cash).
- reference: the bank's transaction reference / UTR / cheque number if shown, else null.
- narration: the raw description text from the statement row.
- category_label: pick exactly ONE label from the list below (character-for-character), or null if unsure. For UPI to a person -> "Transfers › Friends". For refunds/credits -> an "Income" subcategory.

EXCLUDE: opening/closing/available balance rows, running balances, sub-totals and grand totals, header rows, and summary lines for interest/finance charges/GST that aren't actual purchases.${cardholderRule}

Also return bank_name: your best guess at the bank or card issuer, for display.

Available category labels (pick one exactly per transaction, or null):
${params.labels.join("\n")}`;
}

/**
 * Reject once the deadline passes, whatever the request is doing.
 *
 * The in-flight call is not cancelled — it simply stops being waited on, so
 * the route can answer with a sentence instead of being killed mid-request.
 */
async function withTimeout<T>(work: Promise<T>, deadline?: number): Promise<T> {
  if (!deadline) return work;
  const left = deadline - Date.now();
  if (left <= 0) throw new OutOfTimeError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OutOfTimeError()), left);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Universal statement parser. Accepts PDF (sent to Gemini as an image),
 * spreadsheet, or CSV (flattened to text), and returns a normalized list of
 * transactions for any bank. Optionally filters to one cardholder for
 * joint/family statements.
 */
export async function parseStatementFile(params: {
  buffer: Buffer;
  filename: string;
  cardholderName?: string | null;
  categories: CategoryChoice[];
  /**
   * Epoch ms this call must return by.
   *
   * Without it, a 429 from Gemini puts the retry loop to sleep for up to 90
   * seconds inside a function that is killed at 60 — so the upload died with
   * no error at all, just a 504 and an app saying "try again". The backoff
   * already knew how to give up cleanly; it was never told when to.
   */
  deadline?: number;
}): Promise<UniversalParseResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey"
    );
  }
  const ai = new GoogleGenAI({ apiKey });

  const kind = detectKind(params.filename);
  const warnings: string[] = [];
  const labels = params.categories.map((c) => c.label);
  const prompt = buildPrompt({ cardholderName: params.cardholderName, labels });

  // Build the request parts depending on file modality.
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (kind === "pdf") {
    parts.push({
      inlineData: { data: params.buffer.toString("base64"), mimeType: "application/pdf" },
    });
    parts.push({ text: prompt });
  } else if (kind === "spreadsheet" || kind === "csv") {
    let text =
      kind === "spreadsheet"
        ? spreadsheetToText(params.buffer)
        : params.buffer.toString("utf8");
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      warnings.push(
        "Statement was large and may have been truncated — if rows are missing, split it by month and re-upload."
      );
    }
    parts.push({ text: `${prompt}\n\nSTATEMENT CONTENT:\n${text}` });
  } else {
    throw new Error(
      "Unsupported file type. Upload a .pdf, .xlsx, .xls, or .csv statement."
    );
  }

  const schema = {
    type: Type.OBJECT,
    properties: {
      bank_name: { type: Type.STRING, nullable: true },
      transactions: { type: Type.ARRAY, items: ITEM_SCHEMA },
    },
    required: ["transactions"],
  };

  // A hard stop on the request itself, not just on the waits between retries.
  // The deadline alone did not save us: it guards the sleeps, while a single
  // generateContent call that never answers runs until the function is killed
  // — which is exactly what a 504 with no log line looks like.
  const modelStartedAt = Date.now();
  const response = await withTimeout(
    callGeminiWithBackoff(
    () =>
    ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
        // 2.5 models reason before answering unless told not to, and that
        // reasoning is most of the wall-clock time on a long statement. There
        // is nothing here to reason about: read the rows, fill the schema. A
        // 771KB PDF was timing out at 45s almost entirely on thinking.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    { deadline: params.deadline }
    ),
    params.deadline
  );
  console.log(`[parse] model answered in ${Date.now() - modelStartedAt}ms`);

  const text = response.text;
  if (!text) throw new Error("Gemini returned no content.");
  const parsed = JSON.parse(text) as {
    bank_name?: string | null;
    transactions: Array<{
      date: string;
      merchant: string;
      amount_inr: number;
      kind: "debit" | "credit";
      payment_mode: "upi" | "card" | "cash" | "bank_transfer";
      reference?: string | null;
      narration?: string;
      category_label?: string | null;
    }>;
  };

  const labelSet = new Set(labels);
  const rows: UniversalRow[] = [];
  for (const t of parsed.transactions ?? []) {
    const d = new Date(`${t.date}T12:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    if (!(t.amount_inr > 0)) continue;
    if (!t.merchant || !t.merchant.trim()) continue;
    rows.push({
      date: d,
      merchant: t.merchant.trim(),
      amount: Math.round(t.amount_inr * 100) / 100,
      type: t.kind === "credit" ? "credit" : "debit",
      paymentMode: t.payment_mode ?? "card",
      narration: (t.narration ?? "").trim(),
      reference: t.reference?.trim() || null,
      categoryLabel:
        t.category_label && labelSet.has(t.category_label)
          ? t.category_label
          : null,
    });
  }

  return {
    bank: parsed.bank_name?.trim() || "Statement",
    rows,
    warnings,
  };
}
