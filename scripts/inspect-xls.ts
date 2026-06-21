import * as XLSX from "xlsx";

const FILE = "C:\\Users\\sania\\Downloads\\Acct Statement_5571_18052026_15.53.24.xls";

function main() {
  const wb = XLSX.readFile(FILE);
  console.log("Sheets:", wb.SheetNames);
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null,
    });
    console.log(`\n=== Sheet: ${name} (${rows.length} rows) ===`);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      console.log(`  [${i}]`, JSON.stringify(rows[i]).slice(0, 250));
    }
    if (rows.length > 30) {
      console.log(`  ... (${rows.length - 30} more rows)`);
    }
  }
}

main();
