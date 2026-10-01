// Import a TBE tabulation sheet in the common client layout:
//   NO | DESCRIPTION | SPECIFICATION | <bidder columns...> | COMMENTS | REMARKS
// with "- key : value" specification lines on the rows under each item.
// Empty bidder cells import as Pending, never as compliant.

import { newBidder, newProject } from "../engine/project";
import { explicitQty, normUom } from "../engine/qty";
import { statusFromText, STATUS_LABEL } from "../engine/status";
import type { Cell, Project, Row, Status } from "../engine/types";
import { guessDiscipline } from "./studio";

export type SheetCell = string | number | boolean | Date | null | undefined;
export type Sheet = { name: string; rows: SheetCell[][] };

export function cellText(v: SheetCell): string {
  if (v == null) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).replace(/\r\n?/g, "\n").trim();
}

const U = (v: SheetCell) => cellText(v).toUpperCase().replace(/\s+/g, " ");

interface Layout {
  header: number; // header row index
  firstData: number;
  no: number;
  desc: number;
  spec: number;
  qty: number;
  uom: number;
  remarks: number;
  comments: number;
  rowId: number;
  bidders: { name: string; col: number; statusCol?: number; commentCol?: number }[];
}

function isNoHeader(t: string) {
  return /^(NO\.?|ITEM|ITEM NO\.?|S\/?N|SR\.? ?NO\.?|SL\.? ?NO\.?)$/.test(t);
}

export function detectLayout(rows: SheetCell[][]): Layout | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i].map(U);
    const desc = r.findIndex((c) => c.startsWith("DESC") || c === "ITEM DESCRIPTION");
    const spec = r.findIndex((c) => /SPEC|REQUIREMENT/.test(c));
    if (desc < 0 || spec < 0) continue;
    let no = r.findIndex(isNoHeader);
    if (no < 0) no = Math.max(0, Math.min(desc, spec) - 1);
    // Columns of this app's own export ("<BIDDER> STATUS" + offer + comment) are bidder columns.
    const own = new Set<number>();
    r.forEach((c, k) => {
      if (/\sSTATUS$/.test(c)) [k, k + 1, k + 2].forEach((x) => own.add(x));
    });
    const find = (re: RegExp, from = 0) => r.findIndex((c, k) => k >= from && !own.has(k) && re.test(c));
    const remarks = find(/REMARK|CONCLUSION/, spec + 1);
    let comments = find(/COMMENT|ANSWER|EVALUATOR/, spec + 1);
    if (comments === remarks) comments = -1;
    const qty = find(/^(QTY|Q'TY|QUANTITY)\b/);
    const uom = find(/^(UNIT|UOM|U\/M)$/);
    const rowId = r.indexOf("ROW_ID");
    const end = r.length;
    const skip = new Set([no, desc, spec, remarks, comments, qty, uom, rowId]);
    const sub = rows[i + 1]?.map(cellText) ?? [];
    const bidders: Layout["bidders"] = [];
    let usedSub = false;
    for (let c = spec + 1; c < end; c++) {
      if (skip.has(c) || (remarks >= 0 && c > remarks && comments < 0)) continue;
      const h = cellText(rows[i][c]);
      if (!h) continue;
      // This app's own export: "<BIDDER> STATUS | <BIDDER> OFFER | <BIDDER> COMMENT".
      const ownHdr = h.match(/^(.*)\s+STATUS$/i);
      if (ownHdr) {
        const name = ownHdr[1].trim();
        bidders.push({ name, col: c + 1, statusCol: c, commentCol: c + 2 });
        c += 2;
        continue;
      }
      let name = h;
      if (/^BIDDER'?S?'? ?NAME$|^BIDDERS?$|^VENDORS?$/i.test(h) && sub[c] && !/^\d{4}-\d{2}-\d{2}/.test(sub[c])) {
        name = sub[c];
        usedSub = true;
      }
      if (/^(NO|ITEM|DESCRIPTION|SPECIFICATION)/i.test(name)) continue;
      bidders.push({ name, col: c });
    }
    // A single "COMMENTS / ANSWER" column belongs to the only bidder.
    if (bidders.length === 1 && comments >= 0 && bidders[0].commentCol === undefined) bidders[0].commentCol = comments;
    return { header: i, firstData: i + (usedSub ? 2 : 1), no, desc, spec, qty, uom, remarks, comments, rowId, bidders };
  }
  return null;
}

function metaFromTop(rows: SheetCell[][], upto: number) {
  const meta: Record<string, string> = {};
  for (let i = 0; i < upto; i++)
    for (const c of rows[i]) {
      const t = cellText(c);
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^Project\s*[:：]\s*(.+)$/i))) meta.projectName = m[1];
      else if ((m = t.match(/^M\/?R\s*NO\.?\s*[:：]?\s*(.+)$/i))) meta.mrNo = m[1];
      else if ((m = t.match(/^SYSTEM\s*[:：]\s*(.+)$/i))) meta.system = m[1];
      else if ((m = t.match(/^REV\.?\s*(?:NO\.?)?\s*[:：]\s*(.+)$/i))) meta.rev = m[1];
      else if ((m = t.match(/^(?:DOC(?:UMENT)?\.?\s*NO\.?)\s*[:：]\s*(.+)$/i))) meta.docNo = m[1];
    }
  return meta;
}

/**
 * Split a bidder cell into status, vendor offer text and evaluator note.
 * `appExport` = the sheet was written by a TBE app ("[Status] note" cells),
 * so bare status words are evaluator statuses rather than vendor answers.
 */
export function readBidderCell(text: string, appExport = false): { status: Status; offered: string; note?: string } {
  const t = text.trim();
  if (!t) return { status: "Pending", offered: "" };
  const br = t.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const brSt = br ? statusFromText(`[${br[1]}]`) : null;
  if (br && brSt) return { status: brSt, offered: "", note: br[2].trim() || undefined };
  if (appExport) {
    const st = statusFromText(t);
    if (st && t.replace(/[\s.]/g, "").toUpperCase() === st.replace(/\s/g, "").toUpperCase()) return { status: st, offered: "" };
  }
  const st = statusFromText(t);
  let offered = t.replace(/^\[[^\]]+\]\s*/, "");
  // A bare status word carries no offer text.
  if (st && (offered.toUpperCase() === st.toUpperCase() || offered.toUpperCase() === STATUS_LABEL[st].toUpperCase())) offered = "";
  // Vendor words like "Comply" / "Confirmed" are the vendor's answer; the evaluator decides the status.
  const vendorWord = st === "Comply" || st === "Confirm";
  return { status: st && !vendorWord ? st : "Pending", offered: vendorWord && !offered ? t : offered };
}

export function fromSheet(sheet: Sheet, fileName = ""): Project {
  const rows = sheet.rows;
  const L = detectLayout(rows);
  if (!L) throw new Error(`Sheet "${sheet.name}" has no NO / DESCRIPTION / SPECIFICATION header row.`);
  const top = metaFromTop(rows, L.header);
  const p = newProject({
    projectName: top.projectName || fileName.replace(/\.[^.]+$/, ""),
    mrNo: top.mrNo || "",
    docNo: top.docNo || "",
    system: top.system || sheet.name,
    discipline: guessDiscipline(`${top.system ?? ""} ${sheet.name} ${fileName}`),
  });
  if (top.rev) p.meta.revisions[0].rev = top.rev;
  p.bidders = L.bidders.map((b) => newBidder(b.name));
  const appExport = rows.slice(L.firstData).some((r) => L.bidders.some((b) => /^\[(Pending|Confirm|Comply|Clarify|Deviation|Exception|Not Quoted|Out of Scope|N\/A)[^\]]*\]/i.test(cellText(r[b.col]))));

  type Raw = { i: number; no: string; desc: string; spec: string; rowId: string };
  const raws: Raw[] = [];
  for (let i = L.firstData; i < rows.length; i++) {
    const r = rows[i];
    const no = cellText(r[L.no]);
    const desc = cellText(r[L.desc]);
    const spec = cellText(r[L.spec]);
    const bidderText = L.bidders.some((b) => cellText(r[b.col]) || (b.statusCol !== undefined && cellText(r[b.statusCol])));
    if (!no && !desc && !spec && !bidderText) continue;
    raws.push({ i, no, desc, spec, rowId: L.rowId >= 0 ? cellText(r[L.rowId]) : "" });
  }

  const isNumbered = (x: Raw) => !!x.no;
  let lastItem: Row | null = null;
  raws.forEach((x, k) => {
    const next = raws[k + 1];
    let level: Row["level"];
    if (isNumbered(x)) {
      const nextNumbered = raws.slice(k + 1).find(isNumbered);
      const hasLines = next && !isNumbered(next);
      const hasChildren = nextNumbered && nextNumbered.no.startsWith(`${x.no.replace(/\.+$/, "")}.`);
      level = hasChildren && !hasLines ? 1 : 2;
    } else {
      level = lastItem ? 3 : 2;
    }
    const row: Row = { id: x.rowId || `r${x.i + 1}`, level, no: x.no, desc: x.desc, spec: x.spec };
    if (level === 3 && !row.spec && row.desc) (row.spec = row.desc), (row.desc = "");
    if (level === 2) {
      const r = rows[x.i];
      const qCol = L.qty >= 0 ? Number(cellText(r[L.qty]).replace(/,/g, "")) : NaN;
      const q = isFinite(qCol) && cellText(r[L.qty]) ? { qty: qCol, uom: L.uom >= 0 ? normUom(cellText(r[L.uom])) : null } : explicitQty(row.spec);
      if (q) (row.qty = q.qty), (row.uom = q.uom);
      if (/\bCANCELL?ED\b/i.test(`${row.desc} ${row.spec}`)) row.boqStatus = "cancelled";
      else if (/\bBY OTHERS\b|SCOPE OF SUPPLY BY OTHERS/i.test(`${row.desc} ${row.spec}`)) row.boqStatus = "by_others";
      lastItem = row;
    }
    if (level === 1) lastItem = null;
    p.rows.push(row);

    const r = rows[x.i];
    if (L.remarks >= 0 && cellText(r[L.remarks])) p.remarks[row.id] = cellText(r[L.remarks]);
    if (L.comments >= 0 && L.bidders.length !== 1 && cellText(r[L.comments]))
      p.remarks[row.id] = [p.remarks[row.id], cellText(r[L.comments])].filter(Boolean).join("\n");
    if (level === 1) return;
    L.bidders.forEach((b, bi) => {
      const bidder = p.bidders[bi];
      const txt = cellText(r[b.col]);
      const note = b.commentCol !== undefined ? cellText(r[b.commentCol]) : "";
      let cell: Cell;
      if (b.statusCol !== undefined) {
        const st = statusFromText(`[${cellText(r[b.statusCol])}]`) ?? "Pending";
        cell = { status: st, ...(txt ? { offered: txt } : {}) };
      } else {
        const { status, offered, note: n } = readBidderCell(txt, appExport);
        cell = { status, ...(offered ? { offered } : {}), ...(n ? { note: n } : {}) };
      }
      if (note) cell.note = [cell.note, note].filter(Boolean).join("\n");
      if (cell.status !== "Pending" || cell.offered || cell.note) (p.cells[row.id] ??= {})[bidder.id] = cell;
    });
  });
  // Guarantee unique ids even if a ROW_ID column was edited.
  const seen = new Set<string>();
  for (const row of p.rows) {
    if (seen.has(row.id)) {
      const old = row.id;
      row.id = `${old}_${seen.size}`;
      if (p.cells[old] && !seen.has(row.id)) p.cells[row.id] = p.cells[old];
    }
    seen.add(row.id);
  }
  return p;
}

/** Pick the tabulation sheet of a workbook. */
export function pickSheet(sheets: Sheet[]): Sheet {
  const scored = sheets
    .map((s) => ({ s, ok: !!detectLayout(s.rows), pref: /TAB|TBE|EVALUATION|MATRIX/i.test(s.name) }))
    .filter((x) => x.ok)
    .sort((a, b) => Number(b.pref) - Number(a.pref));
  if (!scored.length) throw new Error("No sheet with a NO / DESCRIPTION / SPECIFICATION header was found.");
  return scored[0].s;
}
