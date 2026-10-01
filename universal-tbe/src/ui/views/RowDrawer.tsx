import { useEffect } from "preact/hooks";
import { newId } from "../../engine/project";
import { explicitQty } from "../../engine/qty";
import type { BoqStatus, Project, Row, RowLevel } from "../../engine/types";
import { Field, TextInput } from "../components";
import { store, toast } from "../store";

export function RowDrawer({ project: p, rowId, onClose, onOpen }: { project: Project; rowId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const i = p.rows.findIndex((r) => r.id === rowId);
  const row = p.rows[i];

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

  if (!row) return null;

  const set = (fn: (r: Row) => void) =>
    store.update((pp) => {
      pp.rows = pp.rows.map((r) => (r.id === row.id ? { ...r } : r));
      fn(pp.rows.find((r) => r.id === row.id)!);
    });

  const insert = (level: RowLevel) => {
    const id = newId("row");
    store.update((pp) => {
      const rows = [...pp.rows];
      // Insert after this row and, for items/sections, after their spec lines.
      let at = i + 1;
      if (level !== 3) while (at < rows.length && rows[at].level === 3) at++;
      rows.splice(at, 0, { id, level, no: "", desc: level === 3 ? "" : level === 1 ? "New section" : "New item", spec: level === 3 ? "- " : "" });
      pp.rows = rows;
    });
    onOpen(id);
  };

  const move = (delta: number) =>
    store.update((pp) => {
      const rows = [...pp.rows];
      const j = i + delta;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      pp.rows = rows;
    });

  const remove = () => {
    const lines = row.level === 2 ? p.rows.slice(i + 1).findIndex((r) => r.level !== 3) : 0;
    const extra = row.level === 2 ? (lines < 0 ? p.rows.length - i - 1 : lines) : 0;
    if (!confirm(`Delete this ${row.level === 1 ? "section heading" : row.level === 2 ? `item${extra ? ` and its ${extra} specification line(s)` : ""}` : "specification line"}? Bidder responses on it are deleted too.`)) return;
    store.update((pp) => {
      const ids = new Set(pp.rows.slice(i, i + 1 + extra).map((r) => r.id));
      pp.rows = pp.rows.filter((r) => !ids.has(r.id));
      for (const id of ids) {
        delete pp.cells[id];
        delete pp.remarks[id];
      }
      for (const b of pp.bidders) if (Array.isArray(b.scope)) b.scope = b.scope.filter((s) => !ids.has(s));
    });
    toast("Deleted.");
    onClose();
  };

  return (
    <>
      <div class="drawer-back" onClick={onClose} />
      <aside class="drawer" aria-label="Edit requirement line">
        <header>
          <div class="grow">
            <div class="small muted">Requirement line</div>
            <h2>{row.no} {row.desc || row.spec.slice(0, 60)}</h2>
          </div>
          <button class="btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div class="body">
          <div class="grid-form">
            <Field label="Type">
              <select class="select" value={String(row.level)} onChange={(e) => set((r) => (r.level = Number((e.currentTarget as HTMLSelectElement).value) as RowLevel))}>
                <option value="1">Section heading</option>
                <option value="2">Equipment item</option>
                <option value="3">Specification line</option>
              </select>
            </Field>
            <Field label="Item no.">
              <TextInput value={row.no} onCommit={(v) => set((r) => (r.no = v))} />
            </Field>
            <Field label="Description" wide>
              <TextInput value={row.desc} onCommit={(v) => set((r) => (r.desc = v))} />
            </Field>
            {row.level !== 1 && (
              <Field label="Specification / requirement" wide>
                <TextInput
                  multiline
                  rows={4}
                  value={row.spec}
                  onCommit={(v) =>
                    set((r) => {
                      r.spec = v;
                      const q = r.level === 2 && r.qty == null ? explicitQty(v) : null;
                      if (q) (r.qty = q.qty), (r.uom = q.uom);
                    })
                  }
                />
              </Field>
            )}
            {row.level === 2 && (
              <>
                <Field label="Required qty">
                  <input
                    class="input"
                    type="number"
                    min="0"
                    key={`q${row.id}${row.qty ?? ""}`}
                    defaultValue={row.qty != null ? String(row.qty) : ""}
                    onBlur={(e) => {
                      const t = (e.currentTarget as HTMLInputElement).value;
                      set((r) => (r.qty = t === "" ? null : Number(t)));
                    }}
                  />
                </Field>
                <Field label="Unit">
                  <TextInput value={row.uom ?? ""} placeholder="SET, EA, M, LOT…" onCommit={(v) => set((r) => (r.uom = v || null))} />
                </Field>
                <Field label="BOQ status">
                  <select class="select" value={row.boqStatus ?? "active"} onChange={(e) => set((r) => (r.boqStatus = (e.currentTarget as HTMLSelectElement).value as BoqStatus))}>
                    <option value="active">Active</option>
                    <option value="option">Option</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="by_others">By others</option>
                  </select>
                </Field>
              </>
            )}
            {row.level !== 1 && (
              <Field label="Purchaser remarks / conclusion" wide>
                <TextInput multiline value={p.remarks[row.id] ?? ""} onCommit={(v) => store.update((pp) => (v ? (pp.remarks[row.id] = v) : delete pp.remarks[row.id]))} />
              </Field>
            )}
          </div>
          <p class="small muted">
            Specification lines written as <code>- Parameter : Value</code> are parsed into typed checks (ratings, IP/IK, Ex marking, ranges, fibre, PoE, standards…).
            Put quantities as <code>Qty: 6 Sets</code> or in the Required qty field.
          </p>
        </div>
        <footer>
          <button class="btn" onClick={() => insert(1)}>+ Section</button>
          <button class="btn" onClick={() => insert(2)}>+ Item</button>
          <button class="btn" onClick={() => insert(3)}>+ Spec line</button>
          <button class="btn" onClick={() => move(-1)} disabled={i <= 0}>Move up</button>
          <button class="btn" onClick={() => move(1)} disabled={i >= p.rows.length - 1}>Move down</button>
          <span class="grow" />
          <button class="btn danger" onClick={remove}>Delete</button>
        </footer>
      </aside>
    </>
  );
}
