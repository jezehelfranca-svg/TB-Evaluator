// Quantities: required quantity from BOQ/spec text, offered quantity from vendor text.

import { parseNumber } from "./units";

const UOM = String.raw`(sets?|ea|each|nos?\.?|pcs?|pieces?|units?|lots?|lot|pnls?|panels?|m|mtrs?|meters?|metres?|km|rolls?|drums?|lengths?)`;

export interface Qty {
  qty: number;
  uom: string | null;
}

export function normUom(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.toLowerCase().replace(/\.$/, "");
  if (/^sets?$/.test(s)) return "SET";
  if (/^(ea|each)$/.test(s)) return "EA";
  if (/^(nos?|pcs?|pieces?|units?)$/.test(s)) return "EA";
  if (/^lots?$/.test(s)) return "LOT";
  if (/^(pnls?|panels?)$/.test(s)) return "PNL";
  if (/^(m|mtrs?|meters?|metres?)$/.test(s)) return "M";
  if (s === "km") return "KM";
  return s.toUpperCase();
}

/** "Qty: 6 Sets", "QTY 9 SETS", "Q'ty : 2 EA" inside a requirement or offer. */
export function explicitQty(text: string): Qty | null {
  const m = (text || "").match(new RegExp(String.raw`\bQ(?:'?\s?ty|uantity)\.?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*${UOM}?\b`, "i"));
  if (!m) return null;
  return { qty: parseNumber(m[1]), uom: normUom(m[2]) };
}

/** Remove an explicit quantity clause from a requirement text before attribute parsing. */
export function stripQty(text: string): string {
  return (text || "").replace(new RegExp(String.raw`\|?\s*\bQ(?:'?\s?ty|uantity)\.?\s*[:=]?\s*\d+(?:[.,]\d+)?\s*${UOM}?\b`, "gi"), " ").trim();
}

/**
 * Offered quantity from vendor text. Only explicit forms are accepted
 * ("Qty: 6", "6 sets ...", "6 x ...", "(6 EA)"); anything else returns null
 * so the engine asks for the quantity instead of guessing it.
 */
export function offeredQty(text: string): Qty | null {
  const t = (text || "").trim();
  if (!t) return null;
  const exp = explicitQty(t);
  if (exp) return exp;
  const lead = t.match(new RegExp(String.raw`^(\d+(?:[.,]\d+)?)\s*(?:x|×)\s`, "i"));
  if (lead) return { qty: parseNumber(lead[1]), uom: null };
  const leadU = t.match(new RegExp(String.raw`^(\d+(?:[.,]\d+)?)\s*${UOM}\b`, "i"));
  if (leadU) return { qty: parseNumber(leadU[1]), uom: normUom(leadU[2]) };
  const paren = t.match(new RegExp(String.raw`\((\d+(?:[.,]\d+)?)\s*${UOM}\)`, "i"));
  if (paren) return { qty: parseNumber(paren[1]), uom: normUom(paren[2]) };
  // "..., 1 set" / "...; 20 EA" at the end of the offer line.
  const tail = t.match(new RegExp(String.raw`(?:^|[,;]\s*)(\d+(?:[.,]\d+)?)\s*${UOM}\.?\s*$`, "i"));
  if (tail) return { qty: parseNumber(tail[1]), uom: normUom(tail[2]) };
  return null;
}
