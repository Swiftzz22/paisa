import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { deflateSync } from "node:zlib";
import * as XLSX from "xlsx";
import {
  callGeminiWithBackoff,
  nvidiaJsonObject,
  OutOfTimeError,
} from "@/lib/email/parser";

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
 * Text out of a PDF, using the copy of pdfjs already in the project.
 *
 * Worth doing because it changes which model can read the file at all. A PDF
 * sent to Gemini goes as an image and is slow enough to time out on a long
 * statement; the same statement as text is a few tens of kilobytes and any
 * text model can read it in seconds.
 *
 * Returns "" for a scanned statement with no text layer, which is the signal
 * to fall back to the vision path rather than parse an empty string.
 */
async function pdfToText(buffer: Buffer): Promise<string> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      // No worker in a serverless function: there is no second thread to put
      // it on, and asking for one fails at import time.
      disableWorker: true,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
      );
    }
    return pages.join(String.fromCharCode(10)).trim();
  } catch {
    // A corrupt or encrypted PDF is not worth a hard failure here — the vision
    // path may still manage it.
    return "";
  }
}

/** Enough extracted characters to believe the PDF has a real text layer. */
const MIN_PDF_TEXT = 200;

type ParsedStatement = {
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

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    bank_name: { type: Type.STRING, nullable: true },
    transactions: { type: Type.ARRAY, items: ITEM_SCHEMA },
  },
  required: ["transactions"],
};

/** A 1×1 white pixel, standing in for an image we don't want to send. */
function blankImage(context: PDFDocument["context"]): PDFRawStream {
  const data = deflateSync(Buffer.from([0xff]));
  return PDFRawStream.of(
    context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: 1,
      Height: 1,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 8,
      Filter: "FlateDecode",
      Length: data.length,
    }),
    data
  );
}

/** Every image XObject reachable from a page, following Form XObjects. */
function imagesOnPage(
  context: PDFDocument["context"],
  resources: PDFDict | undefined,
  found: Map<string, PDFRef>,
  depth = 0
): void {
  if (!resources || depth > 4) return;
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return;
  for (const [, ref] of xobjects.entries()) {
    if (!(ref instanceof PDFRef)) continue;
    const stream = context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const subtype = stream.dict.get(PDFName.of("Subtype"))?.toString();
    if (subtype === "/Image") found.set(ref.tag, ref);
    else if (subtype === "/Form") {
      imagesOnPage(
        context,
        stream.dict.lookup(PDFName.of("Resources")) as PDFDict | undefined,
        found,
        depth + 1
      );
    }
  }
}

/** Below this, an image isn't costing enough to be worth removing. */
const TEMPLATE_MIN_BYTES = 50_000;

/**
 * Blank out the pre-printed background a statement is laid on.
 *
 * A bank's PDF is usually its empty letterhead as one big image, with the real
 * numbers drawn on top. HSBC's is a 611KB JPEG of the form — logo, marketing
 * copy, empty boxes — referenced by all nine pages. It holds no transaction:
 * it cannot, being identical on every page. Sent as-is it was 92% of each
 * request and gave the model a page of advertising to read past.
 *
 * Only an image every page shares is touched, which is what makes it safe —
 * anything carrying a page's own content cannot be on all of them.
 *
 * Returns the bytes removed, for the log.
 */
function stripSharedBackground(doc: PDFDocument): number {
  const context = doc.context;
  const pageCount = doc.getPageCount();
  if (pageCount < 2) return 0;

  const perPage: Array<Map<string, PDFRef>> = [];
  for (let i = 0; i < pageCount; i++) {
    const found = new Map<string, PDFRef>();
    imagesOnPage(context, doc.getPage(i).node.Resources(), found);
    perPage.push(found);
  }

  let removed = 0;
  for (const [tag, ref] of perPage[0]) {
    if (!perPage.every((p) => p.has(tag))) continue;
    const stream = context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    if (stream.contents.length < TEMPLATE_MIN_BYTES) continue;
    removed += stream.contents.length;
    context.assign(ref, blankImage(context));
  }
  return removed;
}

/**
 * One page of a PDF, as its own PDF, with the shared background dropped.
 *
 * Returns [] when the file cannot be split (encrypted, malformed, or a single
 * page), which is the signal to send it whole.
 */
async function splitPdfPages(buffer: Buffer): Promise<Buffer[]> {
  try {
    const src = await PDFDocument.load(new Uint8Array(buffer), {
      ignoreEncryption: true,
    });
    const count = src.getPageCount();
    if (count < 2) return [];

    const stripped = stripSharedBackground(src);
    if (stripped > 0) {
      console.log(`[parse] dropped ${Math.round(stripped / 1024)}KB of shared background`);
    }

    const out: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const one = await PDFDocument.create();
      const [page] = await one.copyPages(src, [i]);
      one.addPage(page);
      out.push(Buffer.from(await one.save()));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Run `fn` over every item, `limit` at a time.
 *
 * The limit is not politeness — it is what keeps a burst of pages from being
 * rate-limited all at once, which would cost more time in backoff than the
 * parallelism saved.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** One vision request: a PDF (or nothing) plus the prompt, answered as JSON. */
async function readWithVision(
  ai: GoogleGenAI,
  parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>,
  deadline?: number
): Promise<ParsedStatement> {
  const response = await withTimeout(
    callGeminiWithBackoff(
      () =>
        ai.models.generateContent({
          model: MODEL,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0,
            // Nothing to deliberate about: read the rows, fill the schema.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      {
        deadline,
        // Pages run side by side on purpose; the spacing meant for the email
        // sync loop would put them back in single file.
        minIntervalMs: 0,
      }
    ),
    deadline
  );
  const out = response.text;
  if (!out) throw new Error("The model returned no content.");
  return JSON.parse(out) as ParsedStatement;
}

/**
 * How many pages are read at once.
 *
 * The number of requests is the page count either way, so this does not change
 * how much quota a statement costs — only how long it takes. Once the shared
 * background is gone each request is tens of kilobytes, so a normal statement
 * goes out in a single wave and finishes in about the time one page takes.
 */
const PAGE_CONCURRENCY = 10;

/**
 * Read a scanned PDF page by page, in parallel.
 *
 * A statement with no text layer has to go to a vision model, and sending the
 * whole file as one request makes the model read nine pages end to end inside
 * a single answer — comfortably past the 60 seconds the function is allowed.
 * Split into pages, the same work runs several at a time and each request
 * carries a fraction of the bytes.
 *
 * A page that fails does not fail the import. Whatever was read is kept and
 * the missing pages are named, because most of a statement is worth far more
 * than a retry that will be just as slow.
 */
async function readPdfByPage(
  ai: GoogleGenAI,
  pages: Buffer[],
  prompt: string,
  warnings: string[],
  deadline?: number
): Promise<ParsedStatement> {
  const startedAt = Date.now();
  const results = await mapLimit(pages, PAGE_CONCURRENCY, async (page, i) => {
    const parts = [
      { inlineData: { data: page.toString("base64"), mimeType: "application/pdf" } },
      {
        text:
          prompt +
          `\n\nThis is page ${i + 1} of ${pages.length} of the statement. Extract the transaction rows on this page only. If the page carries no transactions (a cover page, terms, or a summary), return an empty list.

The bank's pre-printed background has been removed, so you are seeing the values without the form around them. Column headings may therefore be missing: read the columns left to right as date, then transaction details, then amount. A trailing "CR" against an amount means money in.`,
      },
    ];
    try {
      return await readWithVision(ai, parts, deadline);
    } catch (e) {
      console.error(`[parse] page ${i + 1} failed:`, e);
      return null;
    }
  });

  const read = results.filter((r): r is ParsedStatement => r !== null);
  console.log(
    `[parse] read ${read.length}/${pages.length} pages in ${Date.now() - startedAt}ms`
  );

  if (read.length === 0) {
    throw new OutOfTimeError();
  }
  const missing = results
    .map((r, i) => (r === null ? i + 1 : 0))
    .filter((n) => n > 0);
  if (missing.length > 0) {
    warnings.push(
      `Couldn't read ${missing.length === 1 ? "page" : "pages"} ${missing.join(", ")} of ${pages.length}. Everything else was imported — re-upload to try those pages again.`
    );
  }

  return {
    bank_name: read.find((r) => r.bank_name)?.bank_name ?? null,
    transactions: read.flatMap((r) =>
      Array.isArray(r.transactions) ? r.transactions : []
    ),
  };
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

  if (kind !== "pdf" && kind !== "spreadsheet" && kind !== "csv") {
    throw new Error(
      "Unsupported file type. Upload a .pdf, .xlsx, .xls, or .csv statement."
    );
  }

  /**
   * The statement as text, when it can be had.
   *
   * Spreadsheets and CSVs are text already, and a PDF usually carries a text
   * layer too. Reading it here is what lets the fast text model do the work: a
   * 771KB PDF handed to a vision model timed out, while the same pages as text
   * are a few tens of kilobytes and read in seconds.
   */
  let text =
    kind === "spreadsheet"
      ? spreadsheetToText(params.buffer)
      : kind === "csv"
        ? params.buffer.toString("utf8")
        : await pdfToText(params.buffer);

  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push(
      "Statement was large and may have been truncated — if rows are missing, split it by month and re-upload."
    );
  }

  // A scanned statement has no text layer, so there is nothing for a text
  // model to read. Only those need the vision path.
  const hasText = kind === "pdf" ? text.length >= MIN_PDF_TEXT : text.length > 0;
  let parsed: ParsedStatement | null = null;

  if (hasText) {
    try {
      const raw = (await nvidiaJsonObject(
        prompt,
        "STATEMENT CONTENT:" + String.fromCharCode(10) + text,
        { deadline: params.deadline, maxTokens: 8192 }
      )) as ParsedStatement;
      if (Array.isArray(raw?.transactions)) {
        parsed = raw;
        console.log(`[parse] text model returned ${raw.transactions.length} rows`);
      }
    } catch (e) {
      if (e instanceof OutOfTimeError) throw e;
      // Answered badly, refused, or rate-limited. The vision path can still
      // read the file, so this is a detour rather than a failure.
      console.error("[parse] text model failed, falling back to vision:", e);
    }
  }

  if (!parsed) {
    if (kind === "pdf") {
      const pages = await splitPdfPages(params.buffer);
      if (pages.length > 1) {
        parsed = await readPdfByPage(ai, pages, prompt, warnings, params.deadline);
      } else {
        // One page, or a file pdf-lib would not open: send it whole.
        parsed = await readWithVision(
          ai,
          [
            {
              inlineData: {
                data: params.buffer.toString("base64"),
                mimeType: "application/pdf",
              },
            },
            { text: prompt },
          ],
          params.deadline
        );
      }
    } else {
      parsed = await readWithVision(
        ai,
        [
          {
            text:
              prompt +
              String.fromCharCode(10) +
              String.fromCharCode(10) +
              "STATEMENT CONTENT:" +
              String.fromCharCode(10) +
              text,
          },
        ],
        params.deadline
      );
    }
  }

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
