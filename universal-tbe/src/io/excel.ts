// Excel import/export. The export follows the client tabulation layout and
// also carries the full project (hidden sheet) so it can be re-opened here
// without loss; edits made in Excel to statuses, offers, comments and remarks
// are merged back on import.

import ExcelJS from "exceljs";
import { runChecks, verifyEvidence } from "../engine/checks";
import { effectiveStatus, validateProject } from "../engine/project";
import { bidderStats } from "../engine/scoring";
import { STATUS_LABEL, statusFromText } from "../engine/status";
import { tqRegister } from "../engine/tq";
import type { Project, Status } from "../engine/types";
import { cellText, detectLayout, fromSheet, pickSheet, type Sheet, type SheetCell } from "./clientSheet";

export const APP_NAME = "Universal TBE Workbench";
export const APP_VERSION = "0.1.0";

// ------------------------------------------------------------------ read

function cellValue(cell: ExcelJS.Cell): SheetCell {
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null;
  const v = cell.value as unknown;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("result" in o) return (o.result as SheetCell) ?? null;
    if ("text" in o) return String(o.text);
    if ("error" in o) return null;
    return null;
  }
  return v as SheetCell;
}

export interface WorkbookContent {
  sheets: Sheet[];
  embedded: string | null;
}

export async function readWorkbook(data: ArrayBuffer | Uint8Array): Promise<WorkbookContent> {
  const wb = new ExcelJS.Workbook();
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  // exceljs accepts a Buffer in Node and an ArrayBuffer in the browser.
  const input = typeof Buffer !== "undefined" ? Buffer.from(buf) : buf.buffer;
  await wb.xlsx.load(input as ArrayBuffer);
  const sheets: Sheet[] = [];
  let embedded: string | null = null;
  wb.eachSheet((ws) => {
    if (ws.name === "_project") {
      const parts: string[] = [];
      ws.eachRow((row) => parts.push(cellText(cellValue(row.getCell(1)))));
      embedded = parts.join("");
      return;
    }
    const rows: SheetCell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const arr: SheetCell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        arr[c - 1] = cellValue(cell);
      });
      rows[n - 1] = arr;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets.push({ name: ws.name, rows });
  });
  return { sheets, embedded };
}

/** Parse delimited text (CSV/TSV) into rows. */
export function parseDelimited(text: string): SheetCell[][] {
  const delim = (text.split("\n")[0].match(/\t/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: SheetCell[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (f += '"'), i++;
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) row.push(f), (f = "");
    else if (c === "\n") row.push(f), rows.push(row), (row = []), (f = "");
    else if (c !== "\r") f += c;
  }
  if (f || row.length) row.push(f), rows.push(row);
  return rows;
}

/** Merge statuses, offers, comments and remarks edited in the exported sheet back into the project. */
export function mergeTabulation(p: Project, sheet: Sheet): number {
  const L = detectLayout(sheet.rows);
  if (!L || L.rowId < 0) return 0;
  const rowIds = new Set(p.rows.map((r) => r.id));
  let changed = 0;
  for (let i = L.firstData; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const id = cellText(r[L.rowId]);
    if (!rowIds.has(id)) continue;
    if (L.remarks >= 0) {
      const rem = cellText(r[L.remarks]);
      if (rem !== (p.remarks[id] ?? "")) {
        if (rem) p.remarks[id] = rem;
        else delete p.remarks[id];
        changed++;
      }
    }
    L.bidders.forEach((b, bi) => {
      const bidder = p.bidders.find((x) => (x.short || x.name).toUpperCase() === b.name.toUpperCase()) ?? p.bidders[bi];
      if (!bidder || b.statusCol === undefined) return;
      const row = p.rows.find((x) => x.id === id)!;
      if (row.level === 1) return;
      const old = p.cells[id]?.[bidder.id];
      const stTxt = cellText(r[b.statusCol]);
      const st: Status = statusFromText(`[${stTxt}]`) ?? old?.status ?? "Pending";
      const offered = cellText(r[b.col]);
      const note = b.commentCol !== undefined ? cellText(r[b.commentCol]) : old?.note ?? "";
      // Derived statuses (scope / N/A shown for unevaluated lines) are not stored.
      const derived = !old && (st === "Out of Scope" || st === "N/A") && st === effectiveStatus(p, row, bidder);
      if (derived) return;
      if (!old && st === "Pending" && !offered && !note) return;
      if (old && old.status === st && (old.offered ?? "") === offered && (old.note ?? "") === note) return;
      (p.cells[id] ??= {})[bidder.id] = { ...(old ?? {}), status: st, offered: offered || undefined, note: note || undefined, updated: new Date().toISOString() };
      changed++;
    });
  }
  return changed;
}

export interface ImportResult {
  project: Project;
  message: string;
}

export async function projectFromWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): Promise<ImportResult> {
  const { sheets, embedded } = await readWorkbook(data);
  if (embedded) {
    const p = validateProject(JSON.parse(embedded));
    const tab = sheets.find((s) => s.name === "Tabulation");
    const n = tab ? mergeTabulation(p, tab) : 0;
    return { project: p, message: `Re-opened ${fileName}${n ? `; merged ${n} edit(s) made in Excel` : ""}.` };
  }
  const sheet = pickSheet(sheets);
  const p = fromSheet(sheet, fileName);
  const items = p.rows.filter((r) => r.level > 1).length;
  return { project: p, message: `Imported ${items} lines and ${p.bidders.length} bidder(s) from sheet "${sheet.name}".` };
}

// ----------------------------------------------------------------- write

const NAVY = "FF1F3864";
const FILL: Record<Status, string> = {
  Pending: "FFFFFFFF",
  Confirm: "FFDFF6DD",
  Comply: "FFDEECF9",
  Clarify: "FFFFF4CE",
  Deviation: "FFFDE7E9",
  Exception: "FFF8D7DA",
  "Not Quoted": "FFEDEDED",
  "Out of Scope": "FFF3F2F1",
  "N/A": "FFF3F2F1",
};
const FONT: Record<Status, string> = {
  Pending: "FF8A98B0",
  Confirm: "FF107C41",
  Comply: "FF0B5CAD",
  Clarify: "FF9A4A00",
  Deviation: "FFA80000",
  Exception: "FF740808",
  "Not Quoted": "FF444444",
  "Out of Scope": "FF605E5C",
  "N/A": "FF605E5C",
};

const thin = { style: "thin" as const, color: { argb: "FFB4BCCB" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function headerStyle(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = border;
  });
}

function addTable(ws: ExcelJS.Worksheet, headers: string[], widths: number[], rows: (string | number)[][]) {
  headerStyle(ws.addRow(headers));
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const r of rows) {
    const row = ws.addRow(r);
    row.eachCell({ includeEmpty: true }, (c) => {
      c.alignment = { vertical: "top", wrapText: true };
      c.border = border;
      c.font = { size: 9 };
    });
  }
  ws.views = [{ state: "frozen", ySplit: ws.rowCount - rows.length }];
}

export function buildWorkbook(p: Project): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  wb.created = new Date();
  const m = p.meta;
  const rev = m.revisions[0];
  const docName = new Map(p.docs.map((d) => [d.id, d.name]));

  // Cover
  const cover = wb.addWorksheet("Cover", { pageSetup: { orientation: "portrait", fitToPage: true } });
  cover.getColumn(1).width = 24;
  cover.getColumn(2).width = 70;
  cover.addRow(["TECHNICAL BID EVALUATION REPORT"]).font = { bold: true, size: 16, color: { argb: NAVY } };
  cover.addRow([]);
  for (const [k, v] of [
    ["Project", m.projectName],
    ["Document No.", m.docNo],
    ["M/R No.", m.mrNo],
    ["System", m.system],
    ["Discipline", m.discipline],
    ["Client", m.client],
    ["Contractor", m.contractor],
    ["Location", m.location],
    ["Classification", m.classification],
  ])
    cover.addRow([k, v]).getCell(1).font = { bold: true };
  cover.addRow([]);
  cover.addRow(["Revision history"]).font = { bold: true, color: { argb: NAVY } };
  headerStyle(cover.addRow(["Rev.", "Date", "Description", "Prepared", "Checked", "Approved"]));
  for (const r of m.revisions) cover.addRow([r.rev, r.date, r.description, r.prepared, r.checked, r.approved]);
  if (m.notes) {
    cover.addRow([]);
    cover.addRow(["Notes", m.notes]).getCell(2).alignment = { wrapText: true };
  }

  // Summary
  const stats = bidderStats(p);
  const sum = wb.addWorksheet("Summary");
  addTable(
    sum,
    ["Bidder", "Quote ref.", "In-scope lines", "Evaluated %", "Compliant %", "Confirm", "Comply", "Clarify", "Deviation", "Exception", "Not quoted", "Pending", "Out of scope / N/A", "Open TQs"],
    [26, 26, 10, 10, 10, 9, 9, 9, 9, 9, 9, 9, 10, 9],
    stats.map((s) => [s.bidder.name, s.bidder.quoteRef, s.inScope, s.coverage, s.compliance, s.confirm, s.comply, s.clarify, s.deviation, s.exception, s.notQuoted, s.pending, s.excluded, s.openQueries]),
  );
  if (stats.some((s) => !s.complete)) sum.addRow(["Evaluation incomplete: percentages are provisional while lines are Pending."]).font = { italic: true, color: { argb: "FF9A4A00" } };

  // Tabulation (client layout)
  const tab = wb.addWorksheet("Tabulation", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 8 as ExcelJS.PaperSize },
  });
  const nB = p.bidders.length;
  const lastCol = 5 + nB * 3 + 1;
  tab.addRow(["TECHNICAL BID EVALUATION TABULATION"]).font = { bold: true, size: 13, color: { argb: NAVY } };
  tab.getCell(1, lastCol).value = `REV. NO.: ${rev?.rev ?? ""}`;
  tab.addRow([`Project: ${m.projectName}`]);
  tab.addRow([`M/R NO. ${m.mrNo}`]);
  tab.addRow([`SYSTEM: ${m.system}`]);
  tab.addRow([`DOC. NO.: ${m.docNo}`]);
  const band = tab.addRow([]);
  p.bidders.forEach((b, i) => {
    const c0 = 6 + i * 3;
    tab.mergeCells(band.number, c0, band.number, c0 + 2);
    const c = tab.getCell(band.number, c0);
    c.value = `${b.name}${b.quoteRef ? `  |  ${b.quoteRef}` : ""}`;
    c.font = { bold: true, color: { argb: NAVY }, size: 9 };
    c.alignment = { horizontal: "center", wrapText: true };
  });
  const headers = ["NO", "DESCRIPTION", "SPECIFICATION", "QTY", "UOM"];
  for (const b of p.bidders) {
    const s = (b.short || b.name).toUpperCase();
    headers.push(`${s} STATUS`, `${s} OFFER`, `${s} COMMENT`);
  }
  headers.push("PURCHASER REMARKS", "ROW_ID");
  const hdr = tab.addRow(headers);
  headerStyle(hdr);
  const widths = [9, 32, 46, 7, 7, ...p.bidders.flatMap(() => [12, 28, 28]), 30, 10];
  widths.forEach((w, i) => (tab.getColumn(i + 1).width = w));
  tab.getColumn(widths.length).hidden = true;
  for (const r of p.rows) {
    const vals: (string | number)[] = [r.no, r.desc, r.spec, r.level === 2 && r.qty != null ? r.qty : "", r.level === 2 ? r.uom ?? "" : ""];
    for (const b of p.bidders) {
      if (r.level === 1) vals.push("", "", "");
      else {
        const c = p.cells[r.id]?.[b.id];
        vals.push(effectiveStatus(p, r, b), c?.offered ?? "", c?.note ?? "");
      }
    }
    vals.push(p.remarks[r.id] ?? "", r.id);
    const row = tab.addRow(vals);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > widths.length) return;
      c.alignment = { vertical: "top", wrapText: true, indent: r.level === 3 && col === 3 ? 1 : 0 };
      c.border = border;
      c.font = { size: 9, bold: r.level === 1 };
      if (r.level === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE3F0" } };
    });
    if (r.level > 1)
      p.bidders.forEach((b, i) => {
        const s = effectiveStatus(p, r, b);
        const c = row.getCell(6 + i * 3);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[s] } };
        c.font = { size: 9, bold: true, color: { argb: FONT[s] }, italic: s === "Pending" };
        c.dataValidation = { type: "list", allowBlank: false, formulae: ['"Pending,Confirm,Comply,Clarify,Deviation,Exception,Not Quoted,Out of Scope,N/A"'] };
      });
  }
  tab.views = [{ state: "frozen", ySplit: hdr.number, xSplit: 3 }];
  tab.pageSetup.printTitlesRow = `${hdr.number}:${hdr.number}`;

  // TQ register
  const tq = tqRegister(p);
  const tqs = wb.addWorksheet("TQ_Register", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  addTable(
    tqs,
    ["TQ No.", "Bidder", "Item No.", "Section", "Description", "Requirement", "Status", "Vendor offer", "Query", "Vendor reply", "Evidence"],
    [16, 18, 10, 22, 28, 40, 12, 30, 45, 30, 18],
    tq.map((t) => [t.tqNo, t.bidder, t.itemNo, t.section, t.description, t.requirement, STATUS_LABEL[t.status], t.offered, t.query, t.reply, t.evidence]),
  );

  // Checks
  const checks = runChecks(p);
  const ck = wb.addWorksheet("Checks");
  addTable(ck, ["Severity", "Check", "Message"], [10, 18, 110], checks.map((c) => [c.severity, c.code, c.message]));

  // Evidence
  const ev = wb.addWorksheet("Evidence");
  const evRows: (string | number)[][] = [];
  for (const r of p.rows)
    for (const b of p.bidders)
      for (const e of p.cells[r.id]?.[b.id]?.evidence ?? [])
        evRows.push([r.no, r.desc || r.spec, b.name, docName.get(e.docId) ?? "", e.page, e.quote, verifyEvidence(p, e) ? "verified" : "NOT FOUND"]);
  addTable(ev, ["Item No.", "Line", "Bidder", "Document", "Page", "Quote", "Check"], [10, 40, 18, 30, 7, 60, 12], evRows);

  // Run info
  const info = wb.addWorksheet("Run_Info");
  addTable(
    info,
    ["Field", "Value"],
    [22, 90],
    [
      ["Application", `${APP_NAME} ${APP_VERSION}`],
      ["Schema", p.schema],
      ["Project id", p.id],
      ["Exported at", new Date().toISOString()],
      ["Project saved at", p.savedAt],
      ["Lines", p.rows.filter((r) => r.level > 1).length],
      ["Bidders", p.bidders.map((b) => `${b.name} (${b.quoteRef || "no ref"})`).join("; ")],
      ...p.docs.map((d) => [`Quotation file`, `${d.name} | ${d.pages.length} pages | SHA-256 ${d.sha256}`] as [string, string]),
    ],
  );

  // Hidden full project for lossless re-import.
  const hidden = wb.addWorksheet("_project", { state: "veryHidden" });
  const json = JSON.stringify(p);
  for (let i = 0; i < json.length; i += 30000) hidden.addRow([json.slice(i, i + 30000)]);
  return wb;
}

export async function workbookBytes(p: Project): Promise<Uint8Array> {
  const buf = await buildWorkbook(p).xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
