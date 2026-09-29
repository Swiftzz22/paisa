/**
 * Build the sample statement attached to App Store review submissions.
 *
 * A reviewer has no Indian bank account, so the only way they can see the app
 * do its main job is a file we give them. App Store Connect rejects .csv, so
 * this writes .xlsx — which the importer reads through the same path.
 *
 * Shaped like a real bank export rather than a tidy three-column demo: a
 * Date/Narration/Debit/Credit/Balance layout, UPI and card narrations as banks
 * actually write them, and an opening balance row the parser is expected to
 * skip. A sample that is too clean proves nothing about the real thing.
 *
 *   npx tsx scripts/make-sample-statement.ts
 */
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

type Row = {
  Date: string;
  Narration: string;
  "Ref No.": string;
  "Debit (INR)": number | "";
  "Credit (INR)": number | "";
  "Balance (INR)": number;
};

const rows: Row[] = [];
let balance = 48_250.0;

function entry(
  date: string,
  narration: string,
  ref: string,
  debit: number,
  credit = 0
) {
  balance = balance - debit + credit;
  rows.push({
    Date: date,
    Narration: narration,
    "Ref No.": ref,
    "Debit (INR)": debit || "",
    "Credit (INR)": credit || "",
    "Balance (INR)": Math.round(balance * 100) / 100,
  });
}

// A month of ordinary spending, in the narration styles Indian banks use.
entry("01/09/2026", "UPI-SWIGGY-swiggy@ybl-408112233445", "408112233445", 342.0);
entry("02/09/2026", "POS 4315XXXXXXXX5450 UBER INDIA SYSTEMS", "008821440931", 218.5);
entry("03/09/2026", "UPI-BIGBAZAAR RETAIL-bb@icici-408254119802", "408254119802", 1245.0);
entry("04/09/2026", "POS 4315XXXXXXXX5450 NETFLIX COM MUMBAI", "008833910277", 649.0);
entry("05/09/2026", "UPI-ARJUN MEHTA-arjun99@okaxis-408390114552", "408390114552", 500.0);
entry("07/09/2026", "NEFT CR-QUALCOMM INDIA PVT LTD-SALARY SEP", "N221092700481", 0, 62_400.0);
entry("08/09/2026", "UPI-ZOMATO LTD-zomato@paytm-408455201933", "408455201933", 486.15);
entry("09/09/2026", "ATW-4315XXXXXXXX5450-HDFC ATM KORAMANGALA", "008901224417", 2000.0);
entry("11/09/2026", "POS 4315XXXXXXXX5450 AMAZON PAY INDIA", "009012338845", 1899.0);
entry("13/09/2026", "UPI-BESCOM ELECTRICITY-bescom@sbi-408622009471", "408622009471", 1840.0);
entry("15/09/2026", "IMPS-P2A-PRIYA SHARMA-SENT", "225901118820", 3000.0);
entry("17/09/2026", "UPI-BLINKIT-blinkit@ybl-408811224460", "408811224460", 676.0);
entry("19/09/2026", "POS 4315XXXXXXXX5450 INDIGO AIRLINES", "009133447781", 5480.0);
entry("21/09/2026", "UPI REVERSAL-BLINKIT-408811224460", "408811224460", 0, 676.0);
entry("23/09/2026", "UPI-SPOTIFY INDIA-spotify@hdfcbank-409011337722", "409011337722", 149.0);
entry("25/09/2026", "POS 4315XXXXXXXX5450 DECATHLON SPORTS", "009288110034", 2499.0);

// Built from an empty sheet rather than from json_to_sheet: that writes its
// header at A1, and adding the statement header over the top left a mangled
// first row and a duplicated transaction underneath it.
const sheet = XLSX.utils.aoa_to_sheet([
  ["Statement of Account — 01/09/2026 to 30/09/2026"],
  ["Account: XXXXXXXX5450", "", "", "", "Opening Balance", 48_250.0],
  [],
]);

// The table starts below the header block. Real statements carry those lines,
// and the parser is expected to skip them rather than book the opening balance
// as a ₹48,250 expense — which is the point of shipping a realistic sample.
XLSX.utils.sheet_add_json(sheet, rows, { origin: "A4" });
sheet["!cols"] = [
  { wch: 12 },
  { wch: 48 },
  { wch: 16 },
  { wch: 13 },
  { wch: 13 },
  { wch: 14 },
];

const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, "Account Statement");

const out = process.argv[2] ?? "sample-statement.xlsx";
writeFileSync(out, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
console.log(`wrote ${out} — ${rows.length} transactions`);
