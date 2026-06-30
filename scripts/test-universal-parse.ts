/**
 * Verify the universal statement parser on a real spreadsheet (the new path).
 * Mirrors src/lib/statement-universal.ts without the server-only import.
 *
 *   npx tsx scripts/test-universal-parse.ts "<path-to-statement>"
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { GoogleGenAI, Type } from "@google/genai";

const FILE =
  process.argv[2] ||
  "C:\\Users\\sania\\Downloads\\Acct Statement_5571_18052026_15.53.24.xls";

const ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING },
    merchant: { type: Type.STRING },
    amount_inr: { type: Type.NUMBER },
    kind: { type: Type.STRING, enum: ["debit", "credit"] },
    payment_mode: { type: Type.STRING, enum: ["upi", "card", "cash", "bank_transfer"] },
    reference: { type: Type.STRING, nullable: true },
    narration: { type: Type.STRING },
  },
  required: ["date", "merchant", "amount_inr", "kind", "payment_mode"],
};

async function main() {
  const buffer = fs.readFileSync(FILE);
  const wb = XLSX.read(buffer, { type: "buffer" });
  let text = "";
  for (const name of wb.SheetNames) {
    text += `--- Sheet: ${name} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}\n\n`;
  }
  text = text.slice(0, 60000);

  const prompt = `Extract EVERY real transaction from this Indian bank statement.
For each: date (ISO YYYY-MM-DD), merchant (cleaned), amount_inr (positive),
kind (debit=out, credit=in), payment_mode (upi/card/bank_transfer/cash),
reference (txn ref/UTR or null), narration (raw text).
EXCLUDE balance rows, subtotals, headers.

STATEMENT CONTENT:
${text}`;

  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          bank_name: { type: Type.STRING, nullable: true },
          transactions: { type: Type.ARRAY, items: ITEM_SCHEMA },
        },
        required: ["transactions"],
      },
      temperature: 0,
    },
  });

  const data = JSON.parse(res.text!) as {
    bank_name?: string;
    transactions: Array<Record<string, unknown>>;
  };
  console.log(`Bank: ${data.bank_name ?? "?"}`);
  console.log(`Transactions extracted: ${data.transactions.length}\n`);
  const debits = data.transactions.filter((t) => t.kind === "debit").length;
  const credits = data.transactions.filter((t) => t.kind === "credit").length;
  console.log(`  debits: ${debits}, credits: ${credits}\n`);
  console.log("First 8:");
  for (const t of data.transactions.slice(0, 8)) {
    console.log(
      `  ${t.date}  ${(t.kind as string).padEnd(6)}  ₹${String(t.amount_inr).padStart(9)}  ${(t.payment_mode as string).padEnd(13)}  ${String(t.merchant).slice(0, 32)}`
    );
  }
  console.log("\nLast 4:");
  for (const t of data.transactions.slice(-4)) {
    console.log(
      `  ${t.date}  ${(t.kind as string).padEnd(6)}  ₹${String(t.amount_inr).padStart(9)}  ${String(t.merchant).slice(0, 32)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
