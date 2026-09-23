// Import from the earlier "Universal TBE Studio" single-file app: either the
// HTML file itself (its PRESETS object) or one of its JSON snapshots.

import { newId, newProject } from "../engine/project";
import { explicitQty } from "../engine/qty";
import { isStatus } from "../engine/status";
import type { Bidder, Discipline, Project, Row } from "../engine/types";

interface StudioRow {
  id?: unknown;
  level?: unknown;
  no?: unknown;
  desc?: unknown;
  spec?: unknown;
  remarks?: unknown;
  conclusion?: unknown;
  responses?: { status?: unknown; note?: unknown }[];
}

export interface StudioData {
  meta?: Record<string, unknown>;
  bidders?: Record<string, unknown>[];
  rows?: StudioRow[];
}

const s = (v: unknown) => (v == null ? "" : String(v));

export function isStudioData(o: unknown): o is StudioData {
  if (!o || typeof o !== "object") return false;
  const d = o as StudioData;
  return Array.isArray(d.rows) && Array.isArray(d.bidders) && d.rows.some((r) => Array.isArray(r?.responses));
}

/** Read the JSON value that starts at `start` (an object or array), honouring strings. */
function sliceJson(text: string, start: number): string {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("Unterminated PRESETS object in the HTML file.");
}

/** Presets embedded in a Universal TBE Studio HTML file. */
export function extractStudioPresets(html: string): Record<string, StudioData> {
  const m = /const\s+PRESETS\s*=\s*/.exec(html);
  if (!m) throw new Error("This HTML file does not contain Universal TBE Studio presets.");
  const obj = JSON.parse(sliceJson(html, m.index + m[0].length)) as Record<string, StudioData>;
  const out: Record<string, StudioData> = {};
  for (const [k, v] of Object.entries(obj)) if (isStudioData(v)) out[k] = v;
  return out;
}

export function guessDiscipline(text: string): Discipline {
  const t = text.toLowerCase();
  const tel = /telecom|cctv|paga|security|radio|network|fib(er|re)|access control|lan|wi-?fi|paging|siren|scs|telephon/.test(t);
  const ele = /switchgear|swgr|mcc|busduct|bus duct|transformer|electrical|power distribution|substation|soft starter|vsd|capacitor|pfc/.test(t);
  return tel && ele ? "mixed" : tel ? "telecom" : ele ? "electrical" : "mixed";
}

export function fromStudio(d: StudioData, fallbackName = "Imported TBE"): Project {
  const m = d.meta ?? {};
  const p = newProject({
    projectName: s(m.projectName) || fallbackName,
    projectShort: s(m.projectShort),
    docNo: s(m.docNo),
    mrNo: s(m.mrNo),
    system: s(m.system),
    client: s(m.client),
    contractor: s(m.contractor),
    location: s(m.location),
    classification: s(m.classification) || "CONFIDENTIAL",
    notes: s(m.notes),
    discipline: guessDiscipline(`${s(m.system)} ${s(m.coverTitle)} ${s(m.projectShort)}`),
  });
  if (Array.isArray(m.revisions) && m.revisions.length)
    p.meta.revisions = (m.revisions as Record<string, unknown>[]).map((r) => ({
      rev: s(r.rev),
      date: s(r.date),
      description: s(r.description),
      prepared: s(r.prepared),
      checked: s(r.checked),
      approved: s(r.approved),
    }));

  const bidIds = new Set<string>();
  p.bidders = (d.bidders ?? []).map((b): Bidder => {
    let id = s(b.id) || newId("bid");
    if (bidIds.has(id)) id = newId("bid");
    bidIds.add(id);
    return { id, name: s(b.name) || "Bidder", short: s(b.short) || s(b.name), quoteRef: s(b.quoteRef), scope: "all" };
  });

  const rowIds = new Set<string>();
  for (const r of d.rows ?? []) {
    let id = s(r.id) ? `r${s(r.id)}` : newId("row");
    if (rowIds.has(id)) id = newId("row");
    rowIds.add(id);
    const lv = Number(r.level);
    const row: Row = { id, level: lv === 1 ? 1 : lv === 3 ? 3 : 2, no: s(r.no), desc: s(r.desc), spec: s(r.spec) };
    const q = row.level === 2 ? explicitQty(row.spec) : null;
    if (q) {
      row.qty = q.qty;
      row.uom = q.uom;
    }
    p.rows.push(row);
    if (s(r.remarks)) p.remarks[id] = s(r.remarks);
    const concl = s(r.conclusion);
    if (concl && concl !== "Technically Acceptable" && !p.remarks[id]) p.remarks[id] = concl;
    if (row.level === 1) continue;
    (r.responses ?? []).forEach((resp, i) => {
      const b = p.bidders[i];
      if (!b || !resp) return;
      const st = s(resp.status);
      const note = s(resp.note).trim();
      // Blank or unknown statuses were displayed as "Confirm" by the old app; they are unevaluated.
      const status = isStatus(st) ? st : "Pending";
      if (status === "Pending" && !note) return;
      const cell: Project["cells"][string][string] = { status };
      if (/^offered\s*:/i.test(note)) cell.offered = note.replace(/^offered\s*:\s*/i, "");
      else if (note) cell.note = note;
      (p.cells[id] ??= {})[b.id] = cell;
    });
  }
  return p;
}
