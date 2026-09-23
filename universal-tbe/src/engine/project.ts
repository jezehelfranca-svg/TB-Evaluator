// Project construction, structure helpers and validation of loaded files.

import { isStatus } from "./status";
import {
  SCHEMA,
  type Bidder,
  type Cell,
  type Discipline,
  type Meta,
  type Policy,
  type Project,
  type Row,
  type Status,
} from "./types";

let counter = 0;
export function newId(prefix = "id"): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const DEFAULT_POLICY: Policy = {
  overQuantity: "Clarify",
  oversizeFactor: 2,
  notQuotedInTq: true,
  requireEvidence: false,
};

export function emptyMeta(discipline: Discipline = "mixed"): Meta {
  return {
    projectName: "",
    projectShort: "",
    docNo: "",
    mrNo: "",
    system: "",
    discipline,
    client: "",
    contractor: "",
    location: "",
    classification: "CONFIDENTIAL",
    notes: "",
    revisions: [{ rev: "A", date: "", description: "Issued for TBE", prepared: "", checked: "", approved: "" }],
  };
}

export function newProject(meta: Partial<Meta> = {}): Project {
  return {
    schema: SCHEMA,
    id: newId("prj"),
    savedAt: new Date().toISOString(),
    meta: { ...emptyMeta(meta.discipline), ...meta },
    policy: { ...DEFAULT_POLICY },
    rows: [],
    bidders: [],
    cells: {},
    remarks: {},
    docs: [],
  };
}

export function newBidder(name: string, short?: string): Bidder {
  return { id: newId("bid"), name, short: short || name.split(/\s+/)[0].slice(0, 16), quoteRef: "", scope: "all" };
}

// ------------------------------------------------------------- structure

/** Depth of a dotted item number: "13" -> 1, "1.6.1" -> 3, "S.8" -> 2. */
export function numberDepth(no: string): number {
  const s = (no || "").trim().replace(/\.+$/, "");
  if (!s) return 0;
  return s.split(".").length;
}

const ancestorCache = new WeakMap<Row[], Map<string, string[]>>();

/** Section (level-1) ancestors of every row, derived from row order and numbering depth. */
export function ancestors(rows: Row[]): Map<string, string[]> {
  const hit = ancestorCache.get(rows);
  if (hit) return hit;
  const map = new Map<string, string[]>();
  const stack: { id: string; depth: number }[] = [];
  for (const r of rows) {
    if (r.level === 1) {
      const d = numberDepth(r.no) || 1;
      while (stack.length && stack[stack.length - 1].depth >= d) stack.pop();
      map.set(r.id, stack.map((s) => s.id));
      stack.push({ id: r.id, depth: d });
    } else {
      map.set(r.id, stack.map((s) => s.id));
    }
  }
  ancestorCache.set(rows, map);
  return map;
}

/** The nearest section heading for each row. */
export function sectionOf(rows: Row[], rowId: string): string | null {
  const a = ancestors(rows).get(rowId);
  return a && a.length ? a[a.length - 1] : null;
}

/** Top-level sections (used for scope selection). */
export function topSections(rows: Row[]): Row[] {
  const anc = ancestors(rows);
  return rows.filter((r) => r.level === 1 && (anc.get(r.id)?.length ?? 0) === 0);
}

/** For a spec line (level 3), the item (level 2) it belongs to. */
export function parentItem(rows: Row[], index: number): Row | null {
  if (rows[index]?.level !== 3) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].level === 2) return rows[i];
    if (rows[i].level === 1) return null;
  }
  return null;
}

export function inScope(rows: Row[], row: Row, bidder: Bidder): boolean {
  if (bidder.scope === "all") return true;
  const own = row.level === 1 ? [row.id] : [];
  const chain = [...(ancestors(rows).get(row.id) ?? []), ...own];
  return chain.some((id) => (bidder.scope as string[]).includes(id));
}

export function getCell(p: Project, rowId: string, bidderId: string): Cell | undefined {
  return p.cells[rowId]?.[bidderId];
}

/**
 * Status used for counting: the recorded status, except that an unevaluated
 * line outside the bidder's scope or cancelled in the BOQ is excluded.
 */
export function effectiveStatus(p: Project, row: Row, bidder: Bidder): Status {
  const s = getCell(p, row.id, bidder.id)?.status ?? "Pending";
  if (s !== "Pending") return s;
  if (!inScope(p.rows, row, bidder)) return "Out of Scope";
  if (row.boqStatus && row.boqStatus !== "active" && row.boqStatus !== "option") return "N/A";
  return "Pending";
}

// ------------------------------------------------------------ validation

const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));

/**
 * Accept a parsed JSON object and return a well-formed Project, or throw with
 * a readable message. Unknown statuses become Pending (never Confirm).
 */
export function validateProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object") throw new Error("File does not contain a TBE project.");
  const o = raw as Record<string, unknown>;
  if (o.schema !== SCHEMA) throw new Error(`Unsupported project schema "${str(o.schema, "none")}".`);
  if (!Array.isArray(o.rows) || !Array.isArray(o.bidders)) throw new Error("Project is missing rows or bidders.");
  const base = newProject();
  const metaIn = (o.meta ?? {}) as Record<string, unknown>;
  const meta: Meta = { ...base.meta };
  for (const k of Object.keys(meta) as (keyof Meta)[]) {
    if (k === "revisions") continue;
    if (k in metaIn) (meta as unknown as Record<string, unknown>)[k] = str(metaIn[k]);
  }
  if (!["electrical", "telecom", "mixed", "other"].includes(meta.discipline)) meta.discipline = "mixed";
  if (Array.isArray(metaIn.revisions))
    meta.revisions = (metaIn.revisions as Record<string, unknown>[]).map((r) => ({
      rev: str(r.rev),
      date: str(r.date),
      description: str(r.description),
      prepared: str(r.prepared),
      checked: str(r.checked),
      approved: str(r.approved),
    }));

  const seen = new Set<string>();
  const rows: Row[] = (o.rows as Record<string, unknown>[]).map((r) => {
    let id = str(r.id) || newId("row");
    if (seen.has(id)) id = newId("row");
    seen.add(id);
    const level = [1, 2, 3].includes(Number(r.level)) ? (Number(r.level) as 1 | 2 | 3) : 2;
    const row: Row = { id, level, no: str(r.no), desc: str(r.desc), spec: str(r.spec) };
    if (typeof r.qty === "number" && isFinite(r.qty)) row.qty = r.qty;
    if (r.uom) row.uom = str(r.uom);
    if (["active", "cancelled", "by_others", "option"].includes(str(r.boqStatus))) row.boqStatus = r.boqStatus as Row["boqStatus"];
    if (r.critical) row.critical = true;
    return row;
  });
  const rowIds = new Set(rows.map((r) => r.id));
  const bidders: Bidder[] = (o.bidders as Record<string, unknown>[]).map((b) => ({
    id: str(b.id) || newId("bid"),
    name: str(b.name, "Bidder"),
    short: str(b.short) || str(b.name, "Bidder"),
    quoteRef: str(b.quoteRef),
    quoteDate: b.quoteDate ? str(b.quoteDate) : undefined,
    scope: Array.isArray(b.scope) ? (b.scope as unknown[]).map((x) => str(x)).filter((x) => rowIds.has(x)) : "all",
  }));
  const bidIds = new Set(bidders.map((b) => b.id));
  const cells: Project["cells"] = {};
  for (const [rid, byB] of Object.entries((o.cells ?? {}) as Record<string, Record<string, Record<string, unknown>>>)) {
    if (!rowIds.has(rid)) continue;
    for (const [bid, c] of Object.entries(byB ?? {})) {
      if (!bidIds.has(bid) || !c) continue;
      const cell: Cell = { status: isStatus(c.status) ? c.status : "Pending" };
      if (c.offered) cell.offered = str(c.offered);
      if (typeof c.offeredQty === "number") cell.offeredQty = c.offeredQty;
      if (c.note) cell.note = str(c.note);
      if (c.reply) cell.reply = str(c.reply);
      if (Array.isArray(c.evidence))
        cell.evidence = (c.evidence as Record<string, unknown>[]).map((e) => ({ docId: str(e.docId), page: Number(e.page) || 1, quote: str(e.quote) }));
      if (c.updated) cell.updated = str(c.updated);
      (cells[rid] ??= {})[bid] = cell;
    }
  }
  const remarks: Record<string, string> = {};
  for (const [rid, v] of Object.entries((o.remarks ?? {}) as Record<string, unknown>)) if (rowIds.has(rid) && v) remarks[rid] = str(v);
  const docs = Array.isArray(o.docs)
    ? (o.docs as Record<string, unknown>[])
        .filter((d) => bidIds.has(str(d.bidderId)) && Array.isArray(d.pages))
        .map((d) => ({ id: str(d.id) || newId("doc"), bidderId: str(d.bidderId), name: str(d.name), sha256: str(d.sha256), pages: (d.pages as unknown[]).map((x) => str(x)), addedAt: str(d.addedAt) }))
    : [];
  const pol = (o.policy ?? {}) as Record<string, unknown>;
  const policy: Policy = {
    overQuantity: ["Clarify", "Deviation", "Comply"].includes(str(pol.overQuantity)) ? (pol.overQuantity as Policy["overQuantity"]) : base.policy.overQuantity,
    oversizeFactor: typeof pol.oversizeFactor === "number" && pol.oversizeFactor >= 0 ? pol.oversizeFactor : base.policy.oversizeFactor,
    notQuotedInTq: typeof pol.notQuotedInTq === "boolean" ? pol.notQuotedInTq : base.policy.notQuotedInTq,
    requireEvidence: typeof pol.requireEvidence === "boolean" ? pol.requireEvidence : base.policy.requireEvidence,
  };
  return { schema: SCHEMA, id: str(o.id) || base.id, savedAt: str(o.savedAt) || base.savedAt, meta, policy, rows, bidders, cells, remarks, docs };
}
