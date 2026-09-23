import { useState } from "preact/hooks";
import { ancestors, newBidder, newId } from "../../engine/project";
import type { Bidder, Project } from "../../engine/types";
import { extractPdfPages, sha256Hex } from "../../pdf/pdfText";
import { TextInput } from "../components";
import { pickFile } from "../files";
import { store, toast } from "../store";

export function Bidders({ project: p }: { project: Project }) {
  const [busy, setBusy] = useState<string | null>(null);
  const sections = p.rows.filter((r) => r.level === 1);
  const depth = (id: string) => ancestors(p.rows).get(id)?.length ?? 0;

  const setB = (id: string, fn: (b: Bidder) => void) =>
    store.update((pp) => {
      const b = pp.bidders.find((x) => x.id === id);
      if (b) fn(b);
    });

  const add = () =>
    store.update((pp) => {
      pp.bidders.push(newBidder(`Bidder ${pp.bidders.length + 1}`));
    });

  const remove = (b: Bidder) => {
    if (!confirm(`Remove ${b.name}? All evaluation records and quotation documents of this bidder are deleted.`)) return;
    store.update((pp) => {
      pp.bidders = pp.bidders.filter((x) => x.id !== b.id);
      for (const r of Object.values(pp.cells)) delete r[b.id];
      pp.docs = pp.docs.filter((d) => d.bidderId !== b.id);
    });
  };

  const move = (i: number, delta: number) =>
    store.update((pp) => {
      const j = i + delta;
      if (j < 0 || j >= pp.bidders.length) return;
      const list = [...pp.bidders];
      [list[i], list[j]] = [list[j], list[i]];
      pp.bidders = list;
    });

  const addDoc = async (b: Bidder) => {
    const f = await pickFile(".pdf");
    if (!f) return;
    setBusy(b.id);
    try {
      const buf = await f.arrayBuffer();
      const sha = await sha256Hex(buf);
      if (p.docs.some((d) => d.bidderId === b.id && d.sha256 === sha)) {
        toast("This file is already attached to the bidder.", "warn");
        return;
      }
      const pages = await extractPdfPages(buf.slice(0), (n, t) => setBusy(`${b.id}:${n}/${t}`));
      const textless = pages.filter((x) => x.trim().length < 30).length;
      store.update((pp) => pp.docs.push({ id: newId("doc"), bidderId: b.id, name: f.name, sha256: sha, pages, addedAt: new Date().toISOString() }));
      toast(`${f.name}: ${pages.length} page(s) read.${textless ? ` ${textless} page(s) have no text layer (scanned) and cannot be searched.` : ""}`, textless ? "warn" : "ok");
    } catch (e) {
      toast(`Could not read the PDF: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div class="toolbar">
        <button class="btn primary" onClick={add}>+ Add bidder</button>
        <span class="small muted">Scope: limit a bidder to the sections it was asked to quote. Unevaluated lines outside the scope count as Out of Scope, not as missing.</span>
      </div>
      {!p.bidders.length && <div class="panel empty">No bidders yet.</div>}
      {p.bidders.map((b, i) => {
        const docs = p.docs.filter((d) => d.bidderId === b.id);
        const scoped = b.scope !== "all";
        return (
          <div class="panel">
            <div class="row-flex" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }} class="grow">
                {i + 1}. {b.name}
              </h3>
              <button class="btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move left">←</button>
              <button class="btn" onClick={() => move(i, 1)} disabled={i === p.bidders.length - 1} aria-label="Move right">→</button>
              <button class="btn danger" onClick={() => remove(b)}>Remove</button>
            </div>
            <div class="grid-form">
              <label class="field">
                Full name
                <TextInput value={b.name} onCommit={(v) => setB(b.id, (x) => (x.name = v || x.name))} />
              </label>
              <label class="field">
                Short name (column header)
                <TextInput value={b.short} onCommit={(v) => setB(b.id, (x) => (x.short = v))} />
              </label>
              <label class="field">
                Quotation reference / revision
                <TextInput value={b.quoteRef} onCommit={(v) => setB(b.id, (x) => (x.quoteRef = v))} />
              </label>
              <label class="field">
                Quotation date
                <TextInput value={b.quoteDate ?? ""} placeholder="e.g. 18-Aug-2026" onCommit={(v) => setB(b.id, (x) => (x.quoteDate = v || undefined))} />
              </label>
            </div>

            <div class="section-title">Scope of supply</div>
            <div class="row-flex">
              <label>
                <input type="radio" checked={!scoped} onChange={() => setB(b.id, (x) => (x.scope = "all"))} /> All sections
              </label>
              <label>
                <input type="radio" checked={scoped} onChange={() => setB(b.id, (x) => (x.scope = []))} disabled={!sections.length} /> Selected sections only
              </label>
            </div>
            {scoped && (
              <div style={{ columns: "2 280px", marginTop: 6 }}>
                {sections.map((s) => (
                  <label style={{ display: "block", paddingLeft: depth(s.id) * 16 }}>
                    <input
                      type="checkbox"
                      checked={(b.scope as string[]).includes(s.id)}
                      onChange={(e) =>
                        setB(b.id, (x) => {
                          const on = (e.currentTarget as HTMLInputElement).checked;
                          const cur = new Set(x.scope === "all" ? [] : x.scope);
                          if (on) cur.add(s.id);
                          else cur.delete(s.id);
                          x.scope = [...cur];
                        })
                      }
                    />{" "}
                    {s.no} {s.desc}
                  </label>
                ))}
              </div>
            )}

            <div class="section-title">Quotation documents</div>
            {docs.map((d) => (
              <div class="row-flex small" style={{ padding: "3px 0" }}>
                <b>{d.name}</b>
                <span class="muted">{d.pages.length} pages · SHA-256 {d.sha256.slice(0, 12)}…</span>
                <button
                  class="btn danger"
                  onClick={() => {
                    if (confirm(`Remove ${d.name}? Evidence pointing to it will show as unverified.`)) store.update((pp) => (pp.docs = pp.docs.filter((x) => x.id !== d.id)));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button class="btn" onClick={() => addDoc(b)} disabled={!!busy}>
              {busy?.startsWith(b.id) ? `Reading PDF ${busy.split(":")[1] ?? ""}…` : "+ Add quotation PDF"}
            </button>
            <div class="small faint" style={{ marginTop: 4 }}>The text is extracted in this browser and stored in the project file; nothing is uploaded.</div>
          </div>
        );
      })}
    </div>
  );
}
