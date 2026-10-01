// Derived data for the views, recomputed per store version. Suggestions are
// cached per cell by an input signature so edits only re-evaluate what changed.

import { runChecks, type Issue } from "../engine/checks";
import { parentItem } from "../engine/project";
import { conflict, suggest, type Suggestion } from "../engine/rules";
import { bidderStats, sectionStats, type BidderStats, type SectionStats } from "../engine/scoring";
import { tqRegister, type TqItem } from "../engine/tq";
import type { Project } from "../engine/types";

export interface Derived {
  stats: BidderStats[];
  sections: SectionStats[];
  sugg: Map<string, Suggestion>;
  conflicts: Set<string>;
  pendingWithSuggestion: number;
  rowIndex: Map<string, number>;
  checks: () => Issue[];
  tq: () => TqItem[];
}

export const cellKey = (rowId: string, bidderId: string) => `${rowId}|${bidderId}`;

const memo = new Map<string, { sig: string; s: Suggestion }>();

function signature(p: Project, i: number, bidderId: string): string {
  const r = p.rows[i];
  const par = parentItem(p.rows, i);
  const c = p.cells[r.id]?.[bidderId];
  const pc = par ? p.cells[par.id]?.[bidderId] : undefined;
  const b = p.bidders.find((x) => x.id === bidderId)!;
  return JSON.stringify([
    r.level, r.desc, r.spec, r.qty, r.uom, r.boqStatus,
    par?.desc, par?.spec,
    c?.offered, c?.reply, c?.offeredQty,
    pc?.offered,
    b.scope, p.policy.oversizeFactor, p.policy.overQuantity,
    // scope membership depends on section structure
    b.scope === "all" ? "" : p.rows.length,
  ]);
}

let last: { project: Project; version: number; d: Derived } | null = null;

export function derive(p: Project, version: number): Derived {
  if (last && last.project === p && last.version === version) return last.d;
  const sugg = new Map<string, Suggestion>();
  const conflicts = new Set<string>();
  let pendingWithSuggestion = 0;
  const rowIndex = new Map<string, number>();
  p.rows.forEach((r, i) => {
    rowIndex.set(r.id, i);
    if (r.level === 1) return;
    for (const b of p.bidders) {
      const k = cellKey(r.id, b.id);
      const sig = signature(p, i, b.id);
      let m = memo.get(k);
      if (!m || m.sig !== sig) {
        m = { sig, s: suggest(p, i, b) };
        memo.set(k, m);
      }
      sugg.set(k, m.s);
      const st = p.cells[r.id]?.[b.id]?.status ?? "Pending";
      if (conflict(st, m.s)) conflicts.add(k);
      if (st === "Pending" && m.s.status && m.s.status !== "Out of Scope" && m.s.status !== "N/A") pendingWithSuggestion++;
    }
  });
  let checks: Issue[] | null = null;
  let tq: TqItem[] | null = null;
  const d: Derived = {
    stats: bidderStats(p),
    sections: sectionStats(p),
    sugg,
    conflicts,
    pendingWithSuggestion,
    rowIndex,
    checks: () => (checks ??= runChecks(p)),
    tq: () => (tq ??= tqRegister(p)),
  };
  last = { project: p, version, d };
  return d;
}
