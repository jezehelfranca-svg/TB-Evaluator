import { useEffect, useState } from "preact/hooks";
import { describeAttr } from "../../engine/attributes";
import { verifyEvidence } from "../../engine/checks";
import { effectiveStatus, parentItem } from "../../engine/project";
import { findingsText, requiredQty } from "../../engine/rules";
import { STATUSES, STATUS_CLASS, STATUS_LABEL, isQuery } from "../../engine/status";
import { defaultQuery as tqWording } from "../../engine/tq";
import type { Cell, Project, Status } from "../../engine/types";
import { defaultQuery, searchDocs, type Hit } from "../../pdf/search";
import { StatusPill, TextInput } from "../components";
import { cellKey, type Derived } from "../derive";
import { store, toast } from "../store";

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark>{part}</mark> : part));
}

export function CellDrawer({
  project: p,
  d,
  rowId,
  bidderId,
  onClose,
  onNavigate,
}: {
  project: Project;
  d: Derived;
  rowId: string;
  bidderId: string;
  onClose: () => void;
  onNavigate: (rowId: string, bidderId: string) => void;
}) {
  const i = d.rowIndex.get(rowId) ?? -1;
  const row = p.rows[i];
  const bidder = p.bidders.find((b) => b.id === bidderId);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    setHits(null);
    if (row) setQuery(defaultQuery(row, parentItem(p.rows, i)));
  }, [rowId, bidderId]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
        onClose();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  if (!row || !bidder) return null;
  const parent = parentItem(p.rows, i);
  const cell: Cell = p.cells[row.id]?.[bidder.id] ?? { status: "Pending" };
  const eff = effectiveStatus(p, row, bidder);
  const sug = d.sugg.get(cellKey(row.id, bidder.id));
  const docs = p.docs.filter((x) => x.bidderId === bidder.id);
  const q = row.level === 2 ? requiredQty(row) : null;

  const edit = (fn: (c: Cell) => void) =>
    store.update((pp) => {
      const c = ((pp.cells[row.id] ??= {})[bidder.id] ??= { status: "Pending" });
      fn(c);
      c.updated = new Date().toISOString();
    });

  const setStatus = (s: Status, withFindings = false) =>
    edit((c) => {
      c.status = s;
      if (withFindings && !c.note && isQuery(s)) c.note = findingsText(sug);
    });

  // Navigation within the same bidder column.
  const evalRows = p.rows.map((r, k) => ({ r, k })).filter((x) => x.r.level > 1);
  const pos = evalRows.findIndex((x) => x.r.id === row.id);
  const go = (delta: number) => {
    const n = evalRows[pos + delta];
    if (n) onNavigate(n.r.id, bidder.id);
  };
  const nextPending = () => {
    for (let k = pos + 1; k < evalRows.length; k++)
      if (effectiveStatus(p, evalRows[k].r, bidder) === "Pending") return onNavigate(evalRows[k].r.id, bidder.id);
    toast("No more Pending lines for this bidder below this one.", "warn");
  };
  const bi = p.bidders.findIndex((b) => b.id === bidder.id);

  const runSearch = () => setHits(searchDocs(docs, query));
  const attach = (h: Hit) => {
    edit((c) => {
      c.evidence = [...(c.evidence ?? []).filter((e) => !(e.docId === h.docId && e.page === h.page && e.quote === h.snippet)), { docId: h.docId, page: h.page, quote: h.snippet }];
    });
    toast(`Evidence attached: ${h.docName} p.${h.page}`);
  };

  return (
    <>
      <div class="drawer-back" onClick={onClose} />
      <aside class="drawer" aria-label="Evaluate line">
        <header>
          <div class="grow">
            <div class="small muted">
              {bidder.name}
              {bidder.quoteRef ? ` · ${bidder.quoteRef}` : ""}
            </div>
            <h2>
              {row.no} {row.level === 3 ? parent?.desc ?? "" : row.desc}
            </h2>
          </div>
          <StatusPill status={eff} />
          <button class="btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div class="body">
          <div class="section-title">Requirement</div>
          <div class="req-box">{row.level === 3 ? row.spec : [row.desc, row.spec !== row.desc ? row.spec : ""].filter(Boolean).join("\n")}</div>
          <div>
            {q && <span class="chip qty">Qty {q.qty} {q.uom ?? ""}</span>}
            {(sug?.required ?? []).map((a) => (
              <span class="chip">{describeAttr(a)}</span>
            ))}
          </div>
          {p.remarks[row.id] && <div class="small muted" style={{ marginTop: 4 }}>Purchaser remark: {p.remarks[row.id]}</div>}

          <div class="section-title">Vendor offer</div>
          <TextInput multiline rows={3} value={cell.offered ?? ""} placeholder="Offered model / value / description as written in the quotation" onCommit={(v) => edit((c) => (c.offered = v || undefined))} />
          {row.level === 2 && (
            <div class="row-flex" style={{ marginTop: 6 }}>
              <span class="small muted">Offered qty</span>
              <input
                class="input"
                style={{ width: 90 }}
                type="number"
                min="0"
                key={`${row.id}${bidder.id}${cell.offeredQty ?? ""}`}
                defaultValue={cell.offeredQty != null ? String(cell.offeredQty) : ""}
                onBlur={(e) => {
                  const t = (e.currentTarget as HTMLInputElement).value;
                  const n = t === "" ? null : Number(t);
                  if (n !== (cell.offeredQty ?? null)) edit((c) => (c.offeredQty = n));
                }}
              />
              <span class="small faint">leave empty to read it from the offer text</span>
            </div>
          )}
          <div class="small muted" style={{ marginTop: 6 }}>Vendor reply to TQ</div>
          <TextInput multiline rows={2} value={cell.reply ?? ""} placeholder="Reply received from the vendor" onCommit={(v) => edit((c) => (c.reply = v || undefined))} />

          <div class="section-title">Rule check</div>
          <div class="suggest-box">
            {sug?.status ? (
              <div class="row-flex">
                <span>Suggested:</span> <StatusPill status={sug.status} />
                {sug.status !== eff && (
                  <button class="btn" onClick={() => setStatus(sug.status!, true)}>
                    Apply
                  </button>
                )}
              </div>
            ) : (
              <div class="muted small">No suggestion: enter the vendor's offer text or quantity to run the checks.</div>
            )}
            {!!sug?.reasons.length && (
              <ul class="reasons">
                {sug.reasons.map((x) => (
                  <li class={x.level}>{x.text}</li>
                ))}
              </ul>
            )}
          </div>

          <div class="section-title">Evaluation</div>
          <div class="status-grid" role="radiogroup" aria-label="Status">
            {STATUSES.map((s) => (
              <button role="radio" aria-checked={cell.status === s} class={`st-${STATUS_CLASS[s]}${cell.status === s ? " on" : ""}`} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          {eff !== cell.status && <div class="small muted" style={{ marginTop: 4 }}>Shown as {eff} because the line is outside this bidder's scope or not active in the BOQ.</div>}
          <div class="small muted" style={{ marginTop: 8 }}>Comment / technical query</div>
          <TextInput multiline rows={3} value={cell.note ?? ""} placeholder="Evaluator comment; becomes the TQ text" onCommit={(v) => edit((c) => (c.note = v || undefined))} />
          {isQuery(cell.status) || cell.status === "Not Quoted" ? (
            <button class="btn" style={{ marginTop: 6 }} onClick={() => edit((c) => (c.note = tqWording(c.status, row.level === 3 ? `${parent?.desc ?? ""} - ${row.spec}` : `${row.desc} - ${row.spec}`)))}>
              Use standard TQ wording
            </button>
          ) : null}

          <div class="section-title">Quotation evidence</div>
          {(cell.evidence ?? []).map((e, k) => {
            const ok = verifyEvidence(p, e);
            const doc = p.docs.find((x) => x.id === e.docId);
            return (
              <div class="hit">
                <div class="row-flex">
                  <b>{doc?.name ?? "Missing document"} · p.{e.page}</b>
                  <span class={`flag ${ok ? "ev" : "conflict"}`}>{ok ? "verified" : "not found on page"}</span>
                  <span class="grow" />
                  <button class="btn danger" onClick={() => edit((c) => (c.evidence = (c.evidence ?? []).filter((_, j) => j !== k)))}>Remove</button>
                </div>
                {e.quote}
              </div>
            );
          })}
          {docs.length ? (
            <div style={{ marginTop: 8 }}>
              <div class="row-flex">
                <input class="input grow" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
                <button class="btn" onClick={runSearch}>Search {docs.length} doc(s)</button>
              </div>
              {hits && !hits.length && <div class="small muted" style={{ marginTop: 6 }}>No matches. Try the tag number, model or a key value.</div>}
              {hits?.map((h) => (
                <div class="hit">
                  <div class="row-flex">
                    <b>{h.docName} · p.{h.page}</b>
                    <span class="grow" />
                    <button class="btn" onClick={() => attach(h)}>Attach</button>
                    <button class="btn" title="Copy this text into the vendor offer" onClick={() => edit((c) => (c.offered = [c.offered, h.snippet].filter(Boolean).join("\n")))}>
                      Use as offer
                    </button>
                  </div>
                  {highlight(h.snippet, h.matched)}
                </div>
              ))}
            </div>
          ) : (
            <div class="small muted">Add this bidder's quotation PDF on the Bidders tab to search it and attach page evidence.</div>
          )}
        </div>
        <footer>
          <button class="btn" onClick={() => go(-1)} disabled={pos <= 0}>↑ Previous line</button>
          <button class="btn" onClick={() => go(1)} disabled={pos >= evalRows.length - 1}>↓ Next line</button>
          <button class="btn" onClick={nextPending}>Next Pending</button>
          <span class="grow" />
          <button class="btn" disabled={bi <= 0} onClick={() => onNavigate(row.id, p.bidders[bi - 1].id)}>← Bidder</button>
          <button class="btn" disabled={bi >= p.bidders.length - 1} onClick={() => onNavigate(row.id, p.bidders[bi + 1].id)}>Bidder →</button>
        </footer>
      </aside>
    </>
  );
}
