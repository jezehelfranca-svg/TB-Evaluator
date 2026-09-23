// Technical query register, generated from the matrix.

import { effectiveStatus, sectionOf } from "./project";
import { isQuery } from "./status";
import type { Project, Status } from "./types";

export interface TqItem {
  tqNo: string;
  rowId: string;
  bidderId: string;
  itemNo: string;
  section: string;
  description: string;
  requirement: string;
  bidder: string;
  status: Status;
  offered: string;
  query: string;
  reply: string;
  evidence: string;
}

/** Query text: the evaluator's note, else the row remark, else a standard wording. */
export function defaultQuery(status: Status, requirement: string): string {
  const req = requirement.replace(/\s+/g, " ").trim().slice(0, 300);
  switch (status) {
    case "Clarify":
      return `Please confirm compliance with the requirement and provide supporting data (datasheet / drawing): ${req}`;
    case "Deviation":
      return `The offer does not meet the requirement: ${req}. Please revise the offer or provide technical justification.`;
    case "Exception":
      return `Exception taken to: ${req}. Please withdraw the exception or propose a compliant alternative.`;
    case "Not Quoted":
      return `Item not included in the offer: ${req}. Please confirm inclusion in the scope of supply.`;
    default:
      return "";
  }
}

export function tqRegister(p: Project): TqItem[] {
  const out: TqItem[] = [];
  const secName = new Map(p.rows.filter((r) => r.level === 1).map((r) => [r.id, `${r.no} ${r.desc}`.trim()]));
  const docName = new Map(p.docs.map((d) => [d.id, d.name]));
  for (const b of p.bidders) {
    let n = 0;
    p.rows.forEach((r) => {
      if (r.level === 1) return;
      const s = effectiveStatus(p, r, b);
      if (!(isQuery(s) || (s === "Not Quoted" && p.policy.notQuotedInTq))) return;
      const c = p.cells[r.id]?.[b.id];
      const requirement = [r.desc, r.level === 3 || r.spec !== r.desc ? r.spec : ""].filter(Boolean).join(" - ");
      n++;
      out.push({
        tqNo: `TQ-${(b.short || b.name).replace(/\s+/g, "").toUpperCase()}-${String(n).padStart(3, "0")}`,
        rowId: r.id,
        bidderId: b.id,
        itemNo: r.no,
        section: secName.get(sectionOf(p.rows, r.id) ?? "") ?? "",
        description: r.desc,
        requirement,
        bidder: b.name,
        status: s,
        offered: c?.offered ?? "",
        query: c?.note || p.remarks[r.id] || defaultQuery(s, requirement),
        reply: c?.reply ?? "",
        evidence: (c?.evidence ?? []).map((e) => `${docName.get(e.docId) ?? "doc"} p.${e.page}`).join("; "),
      });
    });
  }
  return out;
}
