/**
 * Diagnose HSBC PDF text extraction. Dumps page-by-page text so we can see
 * how lines and cardholder markers appear when linearized.
 */
import * as fs from "node:fs";
// @ts-expect-error — legacy build, types broken in some versions
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const FILE = "C:\\Users\\sania\\Downloads\\2026-01-08_Statement.pdf";

async function main() {
  const data = new Uint8Array(fs.readFileSync(FILE));
  const doc = await pdfjsLib.getDocument({
    data,
    cMapUrl: "node_modules/pdfjs-dist/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/",
  }).promise;
  console.log(`Pages: ${doc.numPages}\n`);

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    console.log(`Page ${p}: ${content.items.length} items, sample:`, JSON.stringify(content.items.slice(0, 3)));
    // Recover lines by grouping text items by y-coordinate.
    type Item = { str: string; x: number; y: number };
    const items: Item[] = content.items
      .filter((i): i is { str: string; transform: number[] } => "str" in i)
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));

    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const lines: { y: number; str: string }[] = [];
    let cur = { y: -1, str: "" };
    for (const it of items) {
      if (cur.y === -1 || Math.abs(it.y - cur.y) < 4) {
        cur.str = cur.str ? `${cur.str} ${it.str}` : it.str;
        cur.y = cur.y === -1 ? it.y : cur.y;
      } else {
        if (cur.str.trim()) lines.push(cur);
        cur = { y: it.y, str: it.str };
      }
    }
    if (cur.str.trim()) lines.push(cur);

    console.log(`========= PAGE ${p} =========`);
    for (const line of lines) {
      const clean = line.str.replace(/\s+/g, " ").trim();
      if (clean) console.log(`  ${clean}`);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
