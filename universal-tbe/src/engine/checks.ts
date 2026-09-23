// Issue-readiness checks: what must be resolved before the TBE is issued.

import { effectiveStatus, getCell } from "./project";
import { conflict, suggest } from "./rules";
import { isCompliant, isQuery } from "./status";
import type { Evidence, Project } from "./types";

export type Severity = "blocker" | "warning" | "info";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  rowId?: string;
  bidderId?: string;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Evidence is verified when its quote occurs on the cited page of the stored document text. */
export function verifyEvidence(p: Project, e: Evidence): boolean {
  const doc = p.docs.find((d) => d.id === e.docId);
  const page = doc?.pages[e.page - 1];
  if (!page || !e.quote.trim()) return false;
  return squash(page).includes(squash(e.quote));
}

export function runChecks(p: Project): Issue[] {
  const out: Issue[] = [];
  const itemRows = p.rows.filter((r) => r.level > 1);
  if (!itemRows.length) out.push({ severity: "blocker", code: "no-rows", message: "The tabulation has no requirement lines." });
  if (!p.bidders.length) out.push({ severity: "blocker", code: "no-bidders", message: "No bidders have been added." });

  for (const b of p.bidders) {
    let pending = 0;
    p.rows.forEach((r, i) => {
      if (r.level === 1) return;
      const s = effectiveStatus(p, r, b);
      const c = getCell(p, r.id, b.id);
      if (s === "Pending") pending++;
      if (isQuery(s) && !c?.note && !p.remarks[r.id])
        out.push({ severity: "info", code: "query-default", message: `${r.no || r.desc}: ${s} uses the standard TQ wording (no specific comment).`, rowId: r.id, bidderId: b.id });
      if (isCompliant(s)) {
        const sug = suggest(p, i, b);
        if (conflict(s, sug))
          out.push({
            severity: "warning",
            code: "conflict",
            message: `${r.no || r.desc}: marked ${s}, but the checks suggest ${sug.status} (${(sug.reasons.find((x) => x.level === "fail") ?? sug.reasons.find((x) => x.level === "query"))?.text ?? ""}).`,
            rowId: r.id,
            bidderId: b.id,
          });
        if (p.policy.requireEvidence && !(c?.evidence ?? []).length)
          out.push({ severity: "warning", code: "no-evidence", message: `${r.no || r.desc}: marked ${s} without quotation evidence.`, rowId: r.id, bidderId: b.id });
      }
      for (const e of c?.evidence ?? [])
        if (!verifyEvidence(p, e))
          out.push({ severity: "warning", code: "evidence-unverified", message: `${r.no || r.desc}: evidence quote not found on page ${e.page} of the stored quotation.`, rowId: r.id, bidderId: b.id });
    });
    if (pending)
      out.push({ severity: "blocker", code: "pending", message: `${b.short || b.name}: ${pending} line(s) not evaluated yet.`, bidderId: b.id });
    if (!b.quoteRef) out.push({ severity: "info", code: "no-quote-ref", message: `${b.short || b.name}: quotation reference not recorded.`, bidderId: b.id });
  }

  const nos = new Map<string, number>();
  for (const r of itemRows) if (r.no) nos.set(r.no, (nos.get(r.no) ?? 0) + 1);
  for (const [no, n] of nos) if (n > 1) out.push({ severity: "warning", code: "dup-no", message: `Item number ${no} is used ${n} times.` });
  for (const r of itemRows)
    if (r.level === 2 && !r.spec && !p.rows.some((x, i) => x.level === 3 && i > p.rows.indexOf(r) && i < p.rows.indexOf(r) + 2))
      out.push({ severity: "info", code: "no-spec", message: `${r.no || r.desc}: no specification text.`, rowId: r.id });

  const rev = p.meta.revisions[0];
  if (!p.meta.docNo) out.push({ severity: "warning", code: "no-docno", message: "Document number is empty." });
  if (!rev || !rev.prepared || !rev.checked || !rev.approved)
    out.push({ severity: "info", code: "signoff", message: "Current revision is missing prepared / checked / approved names." });
  const order: Record<Severity, number> = { blocker: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
