// Suggested status for one line and one bidder, derived by rules from the
// requirement text and the vendor's offered text. Suggestions never overwrite
// a status the engineer set; they are shown next to it and flagged when they
// disagree.

import { describeAttr, requirementAttributes as reqAttrs, extractAttributes as offAttrs, type Attr } from "./attributes";
import { compareAttr, type AttrCheck } from "./compare";
import { offeredQty, stripQty, explicitQty } from "./qty";
import { inScope, parentItem } from "./project";
import { worst } from "./status";
import type { Bidder, Cell, Project, Row, Status } from "./types";

export interface Reason {
  level: "fail" | "query" | "info" | "ok";
  text: string;
}

export interface Suggestion {
  status: Status | null;
  reasons: Reason[];
  checks: AttrCheck[];
  required: Attr[];
}

const NEGATED = /\b(not\s+compl\w*|non[\s-]?compl\w*|cannot\s+comply|unable\s+to\s+comply|take[sn]?\s+exception|exception\s+to)\b/i;
const PARTIAL = /\bpartial(ly)?\s+compl\w*/i;
const DEVIATE = /\b(deviat\w*|alternative|alternate|equivalent|in\s+lieu\s+of|instead\s+of)\b/i;
const EXCLUDED = /\b(excluded|exclusion|not\s+included|not\s+quoted|not\s+offered|by\s+others|by\s+purchaser|by\s+client|by\s+buyer|out\s+of\s+(our\s+)?scope)\b/i;
const CONFIRMED = /\b(comply|complied|complies|compliant|confirm(ed|s)?|as\s+per\s+(spec\w*|requirement\w*|datasheet|rfq|mr)|accepted|agreed|noted)\b|^\s*(yes|ok)\s*\.?$/i;

// Attribute extraction is pure; cache it so a 1,000-line x N-bidder matrix stays responsive.
const reqCache = new Map<string, Attr[]>();
const offCache = new Map<string, Attr[]>();
function cached(cache: Map<string, Attr[]>, fn: (t: string, c: string) => Attr[], text: string, ctx: string): Attr[] {
  const k = `${text}\u0000${ctx}`;
  let v = cache.get(k);
  if (!v) {
    if (cache.size > 20000) cache.clear();
    v = fn(text, ctx);
    cache.set(k, v);
  }
  return v;
}
export const requirementAttributes = (text: string, ctx = "") => cached(reqCache, reqAttrs, text, ctx);
const extractAttributes = (text: string, ctx = "") => cached(offCache, offAttrs, text, ctx);

export function vendorConfirms(text: string): boolean {
  return CONFIRMED.test(text) && !NEGATED.test(text) && !PARTIAL.test(text);
}

/** Requirement text of a row with the quantity clause removed. */
export function requirementText(row: Row): string {
  const spec = stripQty(row.spec || "");
  if (row.level === 3) return spec || row.desc;
  // Client sheets often repeat the description in the specification column.
  if (!spec || spec.toLowerCase().startsWith(row.desc.toLowerCase())) return spec || row.desc;
  return [row.desc, spec].filter(Boolean).join(" | ");
}

/** Required quantity: explicit field first, then "Qty: n" in the text. */
export function requiredQty(row: Row): { qty: number; uom: string | null } | null {
  if (typeof row.qty === "number") return { qty: row.qty, uom: row.uom ?? null };
  return explicitQty(row.spec) ?? explicitQty(row.desc);
}

export function suggest(p: Project, rowIndex: number, bidder: Bidder): Suggestion {
  const row = p.rows[rowIndex];
  const none = (reasons: Reason[] = [], status: Status | null = null): Suggestion => ({ status, reasons, checks: [], required: [] });
  if (!row || row.level === 1) return none();
  if (!inScope(p.rows, row, bidder)) return none([{ level: "info", text: "Section not in this bidder's scope" }], "Out of Scope");
  if (row.boqStatus === "cancelled" || row.boqStatus === "by_others")
    return none([{ level: "info", text: row.boqStatus === "cancelled" ? "Cancelled in BOQ" : "By others per BOQ" }], "N/A");

  const cell: Cell | undefined = p.cells[row.id]?.[bidder.id];
  const parent = parentItem(p.rows, rowIndex);
  const parentCell = parent ? p.cells[parent.id]?.[bidder.id] : undefined;
  const own = [cell?.offered, cell?.reply].filter(Boolean).join(" \n ");
  const inherited = !own && parentCell?.offered ? parentCell.offered : "";
  const offerText = own || inherited;
  const offQtyField = cell?.offeredQty;
  if (!offerText && typeof offQtyField !== "number") return none();

  const reasons: Reason[] = [];
  if (inherited) reasons.push({ level: "info", text: "Using the item-level offer text (no line-level response)" });

  // Explicit vendor statements.
  let status: Status | null = null;
  if (own) {
    if (NEGATED.test(own)) {
      status = "Exception";
      reasons.push({ level: "fail", text: "Vendor states non-compliance / exception" });
    } else if (EXCLUDED.test(own)) {
      status = "Not Quoted";
      reasons.push({ level: "fail", text: "Vendor excludes this item" });
    } else if (DEVIATE.test(own)) {
      status = "Deviation";
      reasons.push({ level: "fail", text: "Vendor offers an alternative / deviation" });
    } else if (PARTIAL.test(own)) {
      status = "Clarify";
      reasons.push({ level: "query", text: "Vendor states partial compliance" });
    }
  }
  const confirmed = !!own && vendorConfirms(own);

  // Typed attribute checks.
  const ctx = parent ? `${parent.desc} ${parent.spec}` : row.desc;
  const required = requirementAttributes(requirementText(row), ctx);
  const offeredAttrs = extractAttributes(offerText, `${ctx} ${row.desc}`);
  const checks = required.map((r) => compareAttr(r, offeredAttrs, confirmed, p.policy.oversizeFactor));
  for (const c of checks) {
    const what = describeAttr(c.req);
    if (c.result === "fail") {
      const s: Status = c.req.failAs === "Clarify" ? "Clarify" : "Deviation";
      status = worst(status, s);
      reasons.push({ level: s === "Deviation" ? "fail" : "query", text: `${what} - ${c.note || "not met"}` });
    } else if (c.result === "not_stated") {
      status = worst(status, "Clarify");
      reasons.push({ level: "query", text: `${what} - ${c.note || "not stated in offer"}` });
    } else if (c.oversize) {
      status = worst(status, "Clarify");
      reasons.push({ level: "query", text: `${what} - ${c.note}` });
    } else if (c.result === "exceeds") {
      reasons.push({ level: "info", text: `${what} - exceeds (${c.note})` });
    } else if (c.result === "confirmed") {
      reasons.push({ level: "ok", text: `${what} - ${c.note}` });
    } else {
      reasons.push({ level: "ok", text: `${what} - ${c.note}` });
    }
  }

  // Quantity (items only).
  const req = row.level === 2 ? requiredQty(row) : null;
  if (req) {
    const offQ = typeof offQtyField === "number" ? { qty: offQtyField, uom: null } : own ? offeredQty(own) : null;
    if (!offQ) {
      status = worst(status, "Clarify");
      reasons.push({ level: "query", text: `Quantity: ${req.qty} ${req.uom ?? ""} required - offered quantity not stated`.trim() });
    } else if (offQ.qty < req.qty) {
      status = worst(status, "Deviation");
      reasons.push({ level: "fail", text: `Quantity: ${offQ.qty} offered vs ${req.qty} ${req.uom ?? ""} required (short)`.trim() });
    } else if (offQ.qty > req.qty) {
      const s = p.policy.overQuantity;
      status = worst(status, s);
      reasons.push({ level: s === "Comply" ? "info" : "query", text: `Quantity: ${offQ.qty} offered vs ${req.qty} ${req.uom ?? ""} required (over)`.trim() });
    } else {
      reasons.push({ level: "ok", text: `Quantity: ${offQ.qty} as required` });
    }
  }

  if (!status) {
    const anyTyped = checks.length > 0 || !!req;
    if (anyTyped) status = checks.length && checks.every((c) => c.result === "confirmed") && !req ? "Confirm" : "Comply";
    else if (confirmed) {
      status = "Confirm";
      reasons.push({ level: "ok", text: "Vendor confirms the requirement" });
    }
  }
  return { status, reasons, checks, required };
}

/** Rule findings as draft TQ text: failures first, then open points. */
export function findingsText(s: Suggestion | undefined): string {
  const r = s?.reasons ?? [];
  return [...r.filter((x) => x.level === "fail"), ...r.filter((x) => x.level === "query")].map((x) => x.text).join("; ");
}

/** Disagreement between the recorded status and the rules. */
export function conflict(recorded: Status, s: Suggestion): boolean {
  if (!s.status || recorded === "Pending") return false;
  const good = (x: Status) => x === "Confirm" || x === "Comply";
  if (good(recorded) && !good(s.status) && s.status !== "Out of Scope" && s.status !== "N/A") return true;
  return false;
}
