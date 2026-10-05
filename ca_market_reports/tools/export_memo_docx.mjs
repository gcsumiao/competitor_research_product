#!/usr/bin/env node
// Markdown memo -> .docx (headings, paragraphs, bullet/numbered lists, pipe tables, blockquotes, inline code/bold/italic).
// Usage: NODE_PATH=<dir with node_modules/docx> node ca_market_reports/tools/export_memo_docx.mjs <memo.md> <out.docx>
// The `docx` npm package is not vendored; install it once in a scratch folder: `npm install docx` and point NODE_PATH at it.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const docx = require("docx");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType,
        LevelFormat, BorderStyle, ShadingType } = docx;

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error("usage: export_memo_docx.mjs <memo.md> <out.docx>"); process.exit(2); }
const md = fs.readFileSync(inPath, "utf8").split(/\r?\n/);

const PAGE_W = 12240, MARGIN = 1080, BODY_W = PAGE_W - 2 * MARGIN;   // US Letter, 0.75" margins (DXA)

// ---- inline markdown -> TextRuns (bold, italic, code) ----
function inline(text, base = {}) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_(?![\w]))/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith("**")) runs.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }));
    else if (tok.startsWith("`")) runs.push(new TextRun({ text: tok.slice(1, -1), font: "Consolas", size: 18, ...base }));
    else runs.push(new TextRun({ text: tok.slice(1, -1), italics: true, ...base }));
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...base }));
  return runs.length ? runs : [new TextRun({ text: "", ...base })];
}

const children = [];
let i = 0;
const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSepLine = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

while (i < md.length) {
  const line = md[i];
  if (!line.trim()) { i++; continue; }
  let m;
  if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
    const lvl = m[1].length;
    const level = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][lvl - 1];
    children.push(new Paragraph({ heading: level, children: inline(m[2]), spacing: { before: lvl === 1 ? 0 : 240, after: 120 } }));
    i++; continue;
  }
  if (line.startsWith(">")) {
    const buf = [];
    while (i < md.length && md[i].startsWith(">")) { buf.push(md[i].replace(/^>\s?/, "")); i++; }
    children.push(new Paragraph({ children: inline(buf.join(" ")), indent: { left: 540 }, spacing: { after: 160 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: "8064A2", space: 8 } }, shading: { type: ShadingType.CLEAR, fill: "F3F0F8", color: "auto" } }));
    continue;
  }
  if (isTableLine(line) && i + 1 < md.length && isSepLine(md[i + 1])) {
    const header = splitRow(line); i += 2;
    const rows = [];
    while (i < md.length && isTableLine(md[i])) { rows.push(splitRow(md[i])); i++; }
    const ncol = header.length;
    const colW = Math.floor(BODY_W / ncol);
    const widths = Array(ncol).fill(colW); widths[ncol - 1] += BODY_W - colW * ncol;
    const mkCell = (txt, hdr) => new TableCell({ width: { size: widths[0], type: WidthType.DXA },
      shading: hdr ? { type: ShadingType.CLEAR, fill: "D9D2E9", color: "auto" } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({ children: inline(txt, { size: 17, bold: hdr || undefined }) })] });
    const mkRow = (cells, hdr) => new TableRow({ tableHeader: hdr, children: cells.slice(0, ncol).concat(Array(Math.max(0, ncol - cells.length)).fill(""))
      .map((c, k) => new TableCell({ width: { size: widths[k], type: WidthType.DXA },
        shading: hdr ? { type: ShadingType.CLEAR, fill: "D9D2E9", color: "auto" } : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        children: [new Paragraph({ children: inline(c, { size: 17, bold: hdr || undefined }) })] })) });
    children.push(new Table({ width: { size: BODY_W, type: WidthType.DXA }, columnWidths: widths, rows: [mkRow(header, true), ...rows.map((r) => mkRow(r, false))] }));
    children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
    continue;
  }
  if ((m = line.match(/^(\s*)[-*]\s+(.*)$/))) {
    const level = Math.min(2, Math.floor(m[1].length / 2));
    children.push(new Paragraph({ children: inline(m[2]), numbering: { reference: "bullets", level }, spacing: { after: 60 } }));
    i++; continue;
  }
  if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
    const level = Math.min(2, Math.floor(m[1].length / 3));
    children.push(new Paragraph({ children: inline(m[3]), numbering: { reference: "numbers", level }, spacing: { after: 60 } }));
    i++; continue;
  }
  // paragraph: join consecutive plain lines
  const buf = [line.trim()]; i++;
  while (i < md.length && md[i].trim() && !/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s)/.test(md[i]) && !isTableLine(md[i])) { buf.push(md[i].trim()); i++; }
  children.push(new Paragraph({ children: inline(buf.join(" ")), spacing: { after: 140 } }));
}

const doc = new Document({
  creator: "Innova Product Research", title: "Canada OBD Gauge Market Memo",
  styles: { default: { document: { run: { font: "Calibri", size: 21 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 40, bold: true, color: "2E1A47" }, paragraph: { spacing: { after: 200 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, color: "2E1A47" }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, color: "4A3B6B" }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
    ] },
  numbering: { config: [
    { reference: "bullets", levels: [0, 1, 2].map((l) => ({ level: l, format: LevelFormat.BULLET, text: ["•", "–", "·"][l], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) },
    { reference: "numbers", levels: [0, 1, 2].map((l) => ({ level: l, format: LevelFormat.DECIMAL, text: "%" + (l + 1) + ".", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) },
  ] },
  sections: [{ properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } }, children }],
});
const buf = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${buf.length} bytes, ${children.length} blocks)`);
