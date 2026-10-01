import { useMemo, useState } from "preact/hooks";
import { describeAttr, type Attr } from "../../engine/attributes";
import { ancestors, effectiveStatus, parentItem } from "../../engine/project";
import { findingsText, requirementAttributes, requirementText, requiredQty } from "../../engine/rules";
import { isCompliant, isQuery } from "../../engine/status";
import type { Project, Row, Status } from "../../engine/types";
import { Modal, StatusPill } from "../components";
import { cellKey, type Derived } from "../derive";
import { store, toast } from "../store";

export interface MatrixFilter {
  search: string;
  section: string; // "" = all
  status: "all" | "pending" | "queries" | "compliant" | "notquoted" | "conflicts" | "suggest";
  bidder: string; // "" = all bidders
}

export const emptyFilter: MatrixFilter = { search: "", section: "", status: "all", bidder: "" };

const OPS: Record<string, string> = { ">=": "≥ ", "<=": "≤ ", "=": "", in: "", range: "", present: "" };

function Chips({ row, rows, index }: { row: Row; rows: Row[]; index: number }) {
  if (row.level === 1) return null;
  const parent = parentItem(rows, index);
  const attrs: Attr[] = requirementAttributes(requirementText(row), parent ? `${parent.desc} ${parent.spec}` : row.desc);
  const q = row.level === 2 ? requiredQty(row) : null;
  if (!attrs.length && !q) return null;
  return (
    <div>
      {q && <span class="chip qty">Qty {q.qty} {q.uom ?? ""}</span>}
      {attrs.map((a) => (
        <span class="chip" title={describeAttr(a)}>
          {OPS[a.op]}
          {a.raw.length > 28 ? `${a.raw.slice(0, 26)}…` : a.raw}
        </span>
      ))}
    </div>
  );
}

function matchesStatus(f: MatrixFilter["status"], s: Status, key: string, d: Derived): boolean {
  switch (f) {
    case "all":
      return true;
    case "pending":
      return s === "Pending";
    case "queries":
      return isQuery(s);
    case "compliant":
      return isCompliant(s);
    case "notquoted":
      return s === "Not Quoted";
    case "conflicts":
      return d.conflicts.has(key);
    case "suggest": {
      const g = d.sugg.get(key)?.status;
      return s === "Pending" && !!g && g !== "Out of Scope" && g !== "N/A";
    }
  }
}

export function Matrix({
  project: p,
  d,
  filter,
  setFilter,
  selected,
  onOpenCell,
  onOpenRow,
}: {
  project: Project;
  d: Derived;
  filter: MatrixFilter;
  setFilter: (f: MatrixFilter) => void;
  selected: string | null;
  onOpenCell: (rowId: string, bidderId: string) => void;
  onOpenRow: (rowId: string) => void;
}) {
  const [bulk, setBulk] = useState(false);
  const bidders = filter.bidder ? p.bidders.filter((b) => b.id === filter.bidder) : p.bidders;
  const sections = p.rows.filter((r) => r.level === 1);
  const anc = ancestors(p.rows);

  const visible = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    const shown = new Set<string>();
    p.rows.forEach((r) => {
      if (r.level === 1) return;
      if (filter.section && !(anc.get(r.id) ?? []).includes(filter.section)) return;
      if (q) {
        const cells = p.cells[r.id] ?? {};
        const hay = `${r.no} ${r.desc} ${r.spec} ${p.remarks[r.id] ?? ""} ${Object.values(cells).map((c) => `${c.offered ?? ""} ${c.note ?? ""}`).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      if (filter.status !== "all" && !bidders.some((b) => matchesStatus(filter.status, effectiveStatus(p, r, b), cellKey(r.id, b.id), d))) return;
      shown.add(r.id);
      for (const a of anc.get(r.id) ?? []) shown.add(a);
    });
    if (!filter.section && !q && filter.status === "all") for (const r of p.rows) if (r.level === 1) shown.add(r.id);
    return shown;
  }, [p, store.version, filter, d]);

  const bulkTargets = useMemo(() => {
    const out: { rowId: string; bidderId: string; status: Status }[] = [];
    if (!bulk) return out;
    for (const r of p.rows) {
      if (r.level === 1 || !visible.has(r.id)) continue;
      for (const b of bidders) {
        const k = cellKey(r.id, b.id);
        const s = d.sugg.get(k)?.status;
        if ((p.cells[r.id]?.[b.id]?.status ?? "Pending") === "Pending" && s && s !== "Out of Scope" && s !== "N/A") out.push({ rowId: r.id, bidderId: b.id, status: s });
      }
    }
    return out;
  }, [bulk, visible, d]);

  const applyBulk = () => {
    store.update((pp) => {
      for (const t of bulkTargets) {
        const c = ((pp.cells[t.rowId] ??= {})[t.bidderId] ??= { status: "Pending" });
        c.status = t.status;
        c.updated = new Date().toISOString();
        if (!c.note && (t.status === "Clarify" || t.status === "Deviation" || t.status === "Exception")) c.note = findingsText(d.sugg.get(cellKey(t.rowId, t.bidderId)));
      }
    });
    toast(`Applied ${bulkTargets.length} suggested status(es). Review the queries before issue.`);
    setBulk(false);
  };

  const byStatus = bulkTargets.reduce<Record<string, number>>((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {});
  const rowsShown = p.rows.filter((r) => visible.has(r.id));

  return (
    <div>
      <div class="toolbar no-print">
        <input
          class="input grow"
          style={{ minWidth: 200 }}
          placeholder="Search item no., description, spec, offers, comments…"
          value={filter.search}
          onInput={(e) => setFilter({ ...filter, search: (e.currentTarget as HTMLInputElement).value })}
        />
        <select class="select" value={filter.section} onChange={(e) => setFilter({ ...filter, section: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="">All sections</option>
          {sections.map((s) => (
            <option value={s.id}>
              {s.no} {s.desc}
            </option>
          ))}
        </select>
        <select class="select" value={filter.status} onChange={(e) => setFilter({ ...filter, status: (e.currentTarget as HTMLSelectElement).value as MatrixFilter["status"] })}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="suggest">Pending with a suggestion</option>
          <option value="queries">Clarify / Deviation / Exception</option>
          <option value="notquoted">Not quoted</option>
          <option value="compliant">Confirm / Comply</option>
          <option value="conflicts">Conflicts with checks</option>
        </select>
        <select class="select" value={filter.bidder} onChange={(e) => setFilter({ ...filter, bidder: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="">All bidders</option>
          {p.bidders.map((b) => (
            <option value={b.id}>{b.short || b.name}</option>
          ))}
        </select>
        <button class="btn" onClick={() => setBulk(true)} disabled={!d.pendingWithSuggestion} title="Set the suggested status on Pending cells shown by the current filter">
          Apply suggestions…
        </button>
        <button class="btn" onClick={() => onOpenRow("__new__")}>+ Line</button>
        <span class="faint small">
          {rowsShown.filter((r) => r.level > 1).length} of {p.rows.filter((r) => r.level > 1).length} lines
        </span>
      </div>

      {!p.rows.length ? (
        <div class="panel empty">No requirement lines yet. Use "+ Line", or open a client TBE sheet / BOQ from the top bar.</div>
      ) : (
        <div class="matrix-wrap">
          <table class="matrix">
            <thead>
              <tr>
                <th>NO</th>
                <th>DESCRIPTION</th>
                <th>SPECIFICATION</th>
                {bidders.map((b) => (
                  <th title={`${b.name}${b.quoteRef ? ` | ${b.quoteRef}` : ""}`}>{b.short || b.name}</th>
                ))}
                <th>PURCHASER REMARKS</th>
              </tr>
            </thead>
            <tbody>
              {rowsShown.map((r) => {
                const i = d.rowIndex.get(r.id)!;
                if (r.level === 1)
                  return (
                    <tr class="l1" key={r.id}>
                      <td class="no clickable" onClick={() => onOpenRow(r.id)}>{r.no}</td>
                      <td colSpan={bidders.length + 3} class="clickable" onClick={() => onOpenRow(r.id)}>
                        {r.desc}
                      </td>
                    </tr>
                  );
                return (
                  <tr class={`l${r.level}`} key={r.id}>
                    <td class="no clickable" onClick={() => onOpenRow(r.id)}>{r.no}</td>
                    <td class="desc clickable" onClick={() => onOpenRow(r.id)}>
                      {r.desc}
                      {r.boqStatus && r.boqStatus !== "active" && <div class="small faint">{r.boqStatus.replace("_", " ").toUpperCase()}</div>}
                    </td>
                    <td class="spec clickable" onClick={() => onOpenRow(r.id)}>
                      {r.spec !== r.desc || r.level === 3 ? r.spec : ""}
                      <Chips row={r} rows={p.rows} index={i} />
                    </td>
                    {bidders.map((b) => {
                      const k = cellKey(r.id, b.id);
                      const c = p.cells[r.id]?.[b.id];
                      const s = effectiveStatus(p, r, b);
                      const g = d.sugg.get(k);
                      const showSug = s === "Pending" && g?.status && g.status !== "Out of Scope" && g.status !== "N/A";
                      return (
                        <td class={`bcell${selected === k ? " sel" : ""}`} onClick={() => onOpenCell(r.id, b.id)}>
                          <div class="row-flex" style={{ gap: 4 }}>
                            <StatusPill status={s} short />
                            {d.conflicts.has(k) && (
                              <span class="flag conflict" title={`Checks suggest ${g?.status}: ${(g?.reasons.find((x) => x.level === "fail") ?? g?.reasons.find((x) => x.level === "query"))?.text ?? ""}`}>
                                ! {g?.status}
                              </span>
                            )}
                            {showSug && <span class="flag suggest" title={g!.reasons.map((x) => x.text).join("\n")}>→ {g!.status}</span>}
                            {!!c?.evidence?.length && <span class="flag ev">p.{c.evidence.map((e) => e.page).join(",")}</span>}
                          </div>
                          {c?.offered && <div class="offer clamp2">{c.offered}</div>}
                          {c?.note && <div class="note clamp1">{c.note}</div>}
                        </td>
                      );
                    })}
                    <td class="rem clickable" onClick={() => onOpenRow(r.id)}>{p.remarks[r.id] ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {bulk && (
        <Modal
          title="Apply suggested statuses"
          onClose={() => setBulk(false)}
          footer={
            <>
              <button class="btn" onClick={() => setBulk(false)}>Cancel</button>
              <button class="btn primary" disabled={!bulkTargets.length} onClick={applyBulk}>
                Apply to {bulkTargets.length} cell(s)
              </button>
            </>
          }
        >
          <p>
            Sets the rule-based status on <b>Pending</b> cells in the current view ({filter.bidder ? p.bidders.find((b) => b.id === filter.bidder)?.short : "all bidders"}). Cells you already evaluated are not changed.
            Queries get the rule findings as their comment, which you can edit into the TQ wording.
          </p>
          <div class="row-flex">
            {Object.entries(byStatus).map(([s, n]) => (
              <span>
                <StatusPill status={s as Status} short /> {n}
              </span>
            ))}
          </div>
          <p class="small muted">Suggestions come from typed checks (ratings, IP, Ex, quantities, ranges…) against the vendor's offer text. They are a first pass; the engineer remains responsible for each status.</p>
        </Modal>
      )}
    </div>
  );
}
