// Compare a required attribute against the attributes found in a vendor offer.

import { describeValue, type Attr } from "./attributes";

export type AttrResult = "pass" | "exceeds" | "fail" | "not_stated" | "confirmed";

export interface AttrCheck {
  req: Attr;
  offered: Attr | null;
  result: AttrResult;
  note: string;
  /** Offered value is far above a minimum requirement (possible wrong selection). */
  oversize?: boolean;
}

const RESULT_RANK: Record<AttrResult, number> = { pass: 4, exceeds: 4, confirmed: 2, not_stated: 1, fail: 0 };

/** Offered attribute keys that can answer a required key. */
function candidateKeys(key: string): string[] {
  switch (key) {
    case "short_time_current":
      return ["short_time_current", "short_circuit"];
    case "short_circuit":
      return ["short_circuit", "short_time_current", "breaking_capacity"];
    case "voltage":
      return ["voltage", "voltage_rating"];
    case "voltage_rating":
      return ["voltage_rating", "voltage"];
    case "fiber_type":
      return ["fiber_type", "fiber_mode"];
    case "fiber_mode":
      return ["fiber_mode", "fiber_type"];
    case "phases":
      return ["phases", "conductors"];
    default:
      return [key];
  }
}

function eqNum(a: number, b: number, tol = 0.005) {
  return Math.abs(a - b) <= Math.abs(b) * tol + 1e-9;
}

function ipDigits(code: string): [number | null, number | null] {
  const m = code.match(/IP([0-6X])([0-9X])/i);
  if (!m) return [null, null];
  const d = (c: string) => (c.toUpperCase() === "X" ? null : Number(c));
  return [d(m[1]), d(m[2])];
}

function cmpRank(a: number[] = [], b: number[] = []): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

interface One {
  result: AttrResult;
  note: string;
  oversize?: boolean;
}

function compareOne(req: Attr, off: Attr, oversizeFactor: number): One {
  const rv = req.value;
  const ov = off.value;
  const offTxt = describeValue(ov);

  // ---- numeric requirement
  if (rv.kind === "num") {
    if (ov.kind === "range") {
      if (req.op === "=" || req.op === "in")
        return rv.values.some((v) => v >= ov.min && v <= ov.max)
          ? { result: "pass", note: `offered range ${offTxt} includes requirement` }
          : { result: "fail", note: `offered range ${offTxt} excludes requirement` };
      if (req.op === ">=") return ov.max >= rv.values[0] ? { result: "pass", note: `offered ${offTxt}` } : { result: "fail", note: `offered ${offTxt}` };
      if (req.op === "<=") return ov.min <= rv.values[0] ? { result: "pass", note: `offered ${offTxt}` } : { result: "fail", note: `offered ${offTxt}` };
    }
    if (ov.kind !== "num") return { result: "not_stated", note: "" };

    if (req.key === "dimensions") {
      if (rv.values.length !== ov.values.length) return { result: "fail", note: `offered ${offTxt}` };
      const ok = rv.values.every((v, i) => eqNum(ov.values[i], v, 0.01));
      return { result: ok ? "pass" : "fail", note: `offered ${offTxt}` };
    }

    // Offered value to compare: last element of a pair ("0.6/1 kV" -> 1 kV) unless both sides are pairs.
    const pairwise = rv.values.length > 1 && ov.values.length === rv.values.length && req.op !== "in";
    if (req.op === "=" || req.op === "in") {
      const ok = ov.values.some((o) => rv.values.some((r) => eqNum(o, r)));
      return { result: ok ? "pass" : "fail", note: `offered ${offTxt}` };
    }
    let result: AttrResult = "pass";
    let oversize = false;
    const pairs: [number, number][] = pairwise
      ? rv.values.map((r, i) => [r, ov.values[i]])
      : [[rv.values[rv.values.length - 1], Math.max(...ov.values)]];
    for (const [r, o] of pairs) {
      if (req.op === ">=") {
        if (o < r && !eqNum(o, r)) result = "fail";
        else if (o > r && !eqNum(o, r) && result === "pass") result = "exceeds";
        if (oversizeFactor > 0 && r > 0 && o > r * oversizeFactor) oversize = true;
      } else if (req.op === "<=") {
        if (o > r && !eqNum(o, r)) result = "fail";
      }
    }
    let note = `offered ${offTxt}`;
    if (rv.extra !== undefined && result !== "fail") {
      if (ov.extra === undefined) return { result: "not_stated", note: `${offTxt} offered; duration not stated (required ${rv.extra} s)` };
      if (ov.extra < rv.extra) return { result: "fail", note: `offered ${offTxt}; duration below ${rv.extra} s` };
    }
    if (oversize) note += ` (more than ${oversizeFactor}x the requirement - confirm selection)`;
    return { result, note, oversize };
  }

  // ---- range requirement (e.g. operating temperature)
  if (rv.kind === "range") {
    if (ov.kind !== "range") return { result: "not_stated", note: `${offTxt} offered; full range not stated` };
    const ok = ov.min <= rv.min + 1e-9 && ov.max >= rv.max - 1e-9;
    return { result: ok ? (ov.min < rv.min || ov.max > rv.max ? "exceeds" : "pass") : "fail", note: `offered ${offTxt}` };
  }

  // ---- coded requirement
  if (rv.kind === "code" && ov.kind === "code") {
    if (req.key === "phases" && off.key === "conductors") return { result: "pass", note: `offered ${ov.code} (three-phase)` };
    if (req.key === "ip_rating") {
      const [r1, r2] = ipDigits(rv.code);
      const [o1, o2] = ipDigits(ov.code);
      if (o1 === null || o2 === null) return { result: "not_stated", note: `offered ${ov.code}` };
      if (r1 !== null && o1 < r1) return { result: "fail", note: `offered ${ov.code}` };
      if (r2 !== null) {
        if (r2 <= 6 && o2 >= 7)
          return { result: "not_stated", note: `offered ${ov.code}: IPx7/IPx8 does not imply IPx${r2} (IEC 60529) - confirm dual rating` };
        if (o2 < r2) return { result: "fail", note: `offered ${ov.code}` };
      }
      const better = (r1 !== null && o1 > r1) || (r2 !== null && o2 > r2);
      return { result: better ? "exceeds" : "pass", note: `offered ${ov.code}` };
    }
    if (req.key === "conductors") {
      const [rw, re] = rv.rank ?? [];
      const [ow, oe] = ov.rank ?? [];
      if (rw !== ow) return { result: "fail", note: `offered ${ov.code} vs required ${rv.code}` };
      if (re && !oe) return { result: "not_stated", note: `offered ${ov.code}; separate earth conductor not stated` };
      return { result: "pass", note: `offered ${ov.code}` };
    }
    if (req.key === "fiber_type" || req.key === "fiber_mode") {
      const fam = (a: Attr) => (a.key === "fiber_mode" ? ((a.value as { code: string }).code === "Single-mode" ? 1 : 0) : (a.value as { rank: number[] }).rank[0]);
      if (fam(req) !== fam(off)) return { result: "fail", note: `offered ${ov.code} (different fibre mode)` };
      if (req.key === "fiber_mode") return { result: "pass", note: `offered ${ov.code}` };
      if (off.key === "fiber_mode") return { result: "not_stated", note: `offered ${ov.code}; fibre grade not stated` };
      const c = cmpRank(ov.rank, rv.rank);
      return { result: c < 0 ? "fail" : c > 0 ? "exceeds" : "pass", note: `offered ${ov.code}` };
    }
    if (req.key.startsWith("protocol:")) {
      const rVar = rv.code.split(" ")[1];
      const oVar = ov.code.split(" ")[1];
      if (!rVar || rVar === oVar) return { result: "pass", note: `offered ${ov.code}` };
      if (!oVar) return { result: "not_stated", note: `offered ${ov.code}; variant ${rVar} not stated` };
      return { result: "fail", note: `offered ${ov.code} instead of ${rv.code}` };
    }
    if (req.key.startsWith("ex_protection:")) {
      return rv.code === ov.code ? { result: "pass", note: `offered ${ov.code}` } : { result: "fail", note: `offered ${ov.code}` };
    }
    if (req.key === "nema_type") {
      if (ov.code === rv.code) return { result: "pass", note: `offered ${ov.code}` };
      if (ov.code === `${rv.code}X`) return { result: "exceeds", note: `offered ${ov.code}` };
      return { result: "fail", note: `offered ${ov.code}` };
    }
    if (rv.rank && ov.rank) {
      const c = cmpRank(ov.rank, rv.rank);
      if (req.op === ">=") return { result: c < 0 ? "fail" : c > 0 ? "exceeds" : "pass", note: `offered ${ov.code}` };
      if (req.op === "<=") return { result: c > 0 ? "fail" : c < 0 ? "exceeds" : "pass", note: `offered ${ov.code}` };
    }
    return ov.code.toUpperCase() === rv.code.toUpperCase()
      ? { result: "pass", note: `offered ${ov.code}` }
      : { result: "fail", note: `offered ${ov.code}` };
  }

  // ---- standards / listings
  if (rv.kind === "text" && ov.kind === "text") {
    const r = rv.text;
    const o = ov.text;
    if (o === r || o.startsWith(`${r}-`) || o.startsWith(`${r}.`) || o.startsWith(`${r} `)) return { result: "pass", note: `offer cites ${o}` };
    if (r.startsWith(o)) return { result: "not_stated", note: `offer cites ${o} only` };
    return { result: "not_stated", note: "" };
  }
  return { result: "not_stated", note: "" };
}

/**
 * Evaluate one required attribute against all attributes extracted from the offer.
 * `vendorConfirmed` = the vendor explicitly confirmed/complied on this same line.
 */
export function compareAttr(req: Attr, offered: Attr[], vendorConfirmed: boolean, oversizeFactor = 2): AttrCheck {
  if (req.key === "ex_certified") {
    const hit = offered.find((o) => /^(ex_protection:|gas_group|temp_class|gas_zone|dust_zone|standard:ATEX|standard:IECEX)/.test(o.key));
    if (hit) return { req, offered: hit, result: "pass", note: `offer states ${hit.raw}` };
    return vendorConfirmed
      ? { req, offered: null, result: "confirmed", note: "vendor confirmation, certification not stated" }
      : { req, offered: null, result: "not_stated", note: "hazardous-area certification not stated" };
  }
  const keys = candidateKeys(req.key);
  let cands = offered.filter((o) => keys.includes(o.key));
  if (req.key.startsWith("standard:")) cands = offered.filter((o) => o.key.startsWith("standard:"));
  if (req.key.startsWith("ex_protection:")) cands = offered.filter((o) => o.key.startsWith("ex_protection:"));

  let best: AttrCheck | null = null;
  const failures: string[] = [];
  for (const o of cands) {
    const r = compareOne(req, o, oversizeFactor);
    if (req.key.startsWith("standard:") && r.result === "not_stated" && !r.note) continue;
    if (r.result === "fail") failures.push(describeValue(o.value));
    const check: AttrCheck = { req, offered: o, result: r.result, note: r.note, oversize: r.oversize };
    if (!best || RESULT_RANK[check.result] > RESULT_RANK[best.result]) best = check;
  }
  if (best && best.result !== "fail" && failures.length) best.note += `; offer also states ${failures.join(", ")}`;
  if (best && !(best.result === "not_stated" && vendorConfirmed)) return best;
  if (vendorConfirmed) return { req, offered: null, result: "confirmed", note: "vendor confirmation, value not stated" };
  return best ?? { req, offered: null, result: "not_stated", note: "not stated in offer" };
}
