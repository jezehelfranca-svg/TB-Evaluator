import { rankingReady } from "../../engine/scoring";
import type { Project } from "../../engine/types";
import { pct } from "../components";
import type { Derived } from "../derive";

export function Dashboard({ project: p, d, go }: { project: Project; d: Derived; go: (tab: string, status?: string) => void }) {
  const ready = rankingReady(d.stats);
  const top = Math.max(...d.stats.map((s) => s.compliance));
  // Only rank complete evaluations, and never crown a 0 % result.
  const best = ready && top > 0 ? top : -1;
  const lines = p.rows.filter((r) => r.level > 1).length;
  const pending = d.stats.reduce((a, s) => a + s.pending, 0);
  const openQ = d.stats.reduce((a, s) => a + s.openQueries, 0);
  const blockers = d.checks().filter((c) => c.severity === "blocker").length;

  return (
    <div>
      <div class="kpis">
        <div class="kpi">
          <div class="l">Evaluated lines</div>
          <div class="v">{lines}</div>
          <div class="small muted">{p.rows.filter((r) => r.level === 2).length} items · {p.rows.filter((r) => r.level === 3).length} spec lines</div>
        </div>
        <div class="kpi">
          <div class="l">Bidders</div>
          <div class="v">{p.bidders.length}</div>
          <div class="small muted">{p.meta.discipline} TBE</div>
        </div>
        <div class="kpi" style={{ cursor: "pointer" }} onClick={() => go("matrix", "pending")}>
          <div class="l">Pending cells</div>
          <div class="v" style={{ color: pending ? "var(--st-clarify)" : "var(--st-confirm)" }}>{pending}</div>
          <div class="small muted">{d.pendingWithSuggestion} have a rule suggestion</div>
        </div>
        <div class="kpi" style={{ cursor: "pointer" }} onClick={() => go("tq")}>
          <div class="l">Open technical queries</div>
          <div class="v" style={{ color: openQ ? "var(--st-deviation)" : undefined }}>{openQ}</div>
          <div class="small muted">Clarify, Deviation, Exception{p.policy.notQuotedInTq ? ", Not Quoted" : ""}</div>
        </div>
        <div class="kpi" style={{ cursor: "pointer" }} onClick={() => go("matrix", "conflicts")}>
          <div class="l">Conflicts with checks</div>
          <div class="v" style={{ color: d.conflicts.size ? "var(--st-deviation)" : undefined }}>{d.conflicts.size}</div>
          <div class="small muted">marked compliant, rules disagree</div>
        </div>
        <div class="kpi" style={{ cursor: "pointer" }} onClick={() => go("checks")}>
          <div class="l">Issue blockers</div>
          <div class="v">{blockers}</div>
          <div class="small muted">must be cleared before issue</div>
        </div>
      </div>

      {!p.bidders.length ? (
        <div class="panel empty">Add bidders on the Bidders & Scope tab.</div>
      ) : (
        <div class="bidder-cards">
          {d.stats.map((s) => {
            const w = (n: number) => (s.inScope ? `${(n / s.inScope) * 100}%` : "0");
            return (
              <div class={`bcard${ready && s.compliance === best ? " top" : ""}`}>
                <h4>
                  {s.bidder.name}
                  {ready && s.compliance === best && <span class="pill st-confirm" style={{ marginLeft: 6 }}>Highest compliance</span>}
                </h4>
                <div class="small muted">{s.bidder.quoteRef || "No quotation reference"} · scope: {s.bidder.scope === "all" ? "all sections" : `${s.bidder.scope.length} section(s)`}</div>
                <div class="row-flex" style={{ marginTop: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 24, fontWeight: 300, color: "var(--navy)" }}>{pct(s.compliance)}</span>
                  <span class="small muted">
                    compliant of {s.inScope} in-scope lines{!s.complete && " (provisional)"}
                  </span>
                </div>
                <div class="bar" title="Compliant / queries / not quoted / pending">
                  <span style={{ width: w(s.compliant), background: "var(--st-confirm)" }} />
                  <span style={{ width: w(s.clarify + s.deviation + s.exception), background: "#d9822b" }} />
                  <span style={{ width: w(s.notQuoted), background: "#9aa3b2" }} />
                  <span style={{ width: w(s.pending), background: "#e8ebf3" }} />
                </div>
                <div class="small muted" style={{ marginBottom: 6 }}>Evaluated {pct(s.coverage)}</div>
                <div class="stat-grid">
                  <div class="stat"><b>{s.compliant}</b>Confirm / Comply</div>
                  <div class="stat"><b>{s.clarify}</b>Clarify</div>
                  <div class="stat"><b>{s.deviation + s.exception}</b>Deviation / Exc.</div>
                  <div class="stat"><b>{s.notQuoted}</b>Not quoted</div>
                  <div class="stat"><b>{s.pending}</b>Pending</div>
                  <div class="stat"><b>{s.excluded}</b>Out of scope / N/A</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!ready && p.bidders.length > 0 && (
        <p class="small muted">Compliance is measured against every in-scope line, so quoting less never scores higher. Bidders are only ranked once no line is Pending.</p>
      )}

      {d.sections.length > 0 && (
        <div class="panel">
          <h3>Sections</h3>
          <table class="simple">
            <thead>
              <tr>
                <th>Section</th>
                <th>Lines</th>
                {p.bidders.map((b) => (
                  <th>{b.short || b.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.sections.map((sec) => (
                <tr>
                  <td>
                    <b>{sec.section.no}</b> {sec.section.desc}
                  </td>
                  <td>{sec.lines}</td>
                  {p.bidders.map((b) => {
                    const c = sec.byBidder[b.id];
                    if (!c.lines) return <td class="faint">-</td>;
                    if (c.excluded === c.lines) return <td class="faint">Out of scope</td>;
                    const q = c.clarify + c.deviation + c.exception;
                    return (
                      <td>
                        <span style={{ color: "var(--st-confirm)", fontWeight: 700 }}>{c.compliant}</span>/{c.inScope}
                        {q > 0 && <span style={{ color: "var(--st-deviation)" }}> · {q} TQ</span>}
                        {c.notQuoted > 0 && <span class="muted"> · {c.notQuoted} NQ</span>}
                        {c.pending > 0 && <span class="faint"> · {c.pending} pending</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
