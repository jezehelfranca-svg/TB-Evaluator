// Per-bidder and per-section counts. Compliance is measured against every
// in-scope line, so a bidder cannot score well by quoting less.

import { ancestors, effectiveStatus } from "./project";
import { isExcluded } from "./status";
import type { Bidder, Project, Row, Status } from "./types";

export interface Counts {
  lines: number; // evaluable lines (items + spec lines)
  inScope: number; // lines minus Out of Scope / N/A
  pending: number;
  compliant: number;
  confirm: number;
  comply: number;
  clarify: number;
  deviation: number;
  exception: number;
  notQuoted: number;
  excluded: number;
}

export interface BidderStats extends Counts {
  bidder: Bidder;
  coverage: number; // % of in-scope lines evaluated
  compliance: number; // % of in-scope lines compliant
  openQueries: number;
  complete: boolean;
}

function emptyCounts(): Counts {
  return { lines: 0, inScope: 0, pending: 0, compliant: 0, confirm: 0, comply: 0, clarify: 0, deviation: 0, exception: 0, notQuoted: 0, excluded: 0 };
}

function add(c: Counts, s: Status) {
  c.lines++;
  if (isExcluded(s)) {
    c.excluded++;
    return;
  }
  c.inScope++;
  if (s === "Pending") c.pending++;
  else if (s === "Confirm") (c.confirm++, c.compliant++);
  else if (s === "Comply") (c.comply++, c.compliant++);
  else if (s === "Clarify") c.clarify++;
  else if (s === "Deviation") c.deviation++;
  else if (s === "Exception") c.exception++;
  else if (s === "Not Quoted") c.notQuoted++;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export function bidderStats(p: Project): BidderStats[] {
  return p.bidders.map((b) => {
    const c = emptyCounts();
    for (const r of p.rows) if (r.level > 1) add(c, effectiveStatus(p, r, b));
    const openQueries = c.clarify + c.deviation + c.exception + (p.policy.notQuotedInTq ? c.notQuoted : 0);
    return {
      ...c,
      bidder: b,
      coverage: pct(c.inScope - c.pending, c.inScope),
      compliance: pct(c.compliant, c.inScope),
      openQueries,
      complete: c.inScope > 0 && c.pending === 0,
    };
  });
}

export interface SectionStats {
  section: Row;
  lines: number;
  byBidder: Record<string, Counts>;
}

/** Counts per section heading; nested sections roll up into their parents. */
export function sectionStats(p: Project): SectionStats[] {
  const anc = ancestors(p.rows);
  const out = new Map<string, SectionStats>();
  for (const r of p.rows) if (r.level === 1) out.set(r.id, { section: r, lines: 0, byBidder: Object.fromEntries(p.bidders.map((b) => [b.id, emptyCounts()])) });
  for (const r of p.rows) {
    if (r.level === 1) continue;
    for (const sid of anc.get(r.id) ?? []) {
      const s = out.get(sid)!;
      s.lines++;
      for (const b of p.bidders) add(s.byBidder[b.id], effectiveStatus(p, r, b));
    }
  }
  return [...out.values()];
}

/** Ranking is only meaningful once every bidder is fully evaluated. */
export function rankingReady(stats: BidderStats[]): boolean {
  return stats.length > 0 && stats.every((s) => s.complete);
}

