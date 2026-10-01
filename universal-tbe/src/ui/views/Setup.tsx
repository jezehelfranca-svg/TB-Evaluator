import type { Discipline, Meta, Policy, Project, Revision } from "../../engine/types";
import { Field, TextInput } from "../components";
import { store } from "../store";

const META: [keyof Meta, string][] = [
  ["projectName", "Project name"],
  ["projectShort", "Short name"],
  ["docNo", "TBE document no."],
  ["mrNo", "M/R no."],
  ["system", "System / package"],
  ["client", "Client"],
  ["contractor", "Contractor"],
  ["location", "Location"],
  ["classification", "Classification"],
];

export function Setup({ project: p, onDelete }: { project: Project; onDelete: () => void }) {
  const m = p.meta;
  const setMeta = (k: keyof Meta, v: string) => store.update((pp) => ((pp.meta as unknown as Record<string, unknown>)[k] = v));
  const setRev = (i: number, k: keyof Revision, v: string) => store.update((pp) => (pp.meta.revisions[i][k] = v));
  const setPol = <K extends keyof Policy>(k: K, v: Policy[K]) => store.update((pp) => (pp.policy[k] = v));

  return (
    <div>
      <div class="panel">
        <h3>Document control</h3>
        <div class="grid-form">
          {META.map(([k, label]) => (
            <Field label={label}>
              <TextInput value={String(m[k] ?? "")} onCommit={(v) => setMeta(k, v)} />
            </Field>
          ))}
          <Field label="Discipline">
            <select class="select" value={m.discipline} onChange={(e) => setMeta("discipline", (e.currentTarget as HTMLSelectElement).value as Discipline)}>
              <option value="electrical">Electrical</option>
              <option value="telecom">Telecom / security</option>
              <option value="mixed">Electrical + telecom</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Notes" wide>
            <TextInput multiline value={m.notes} onCommit={(v) => setMeta("notes", v)} />
          </Field>
        </div>
      </div>

      <div class="panel">
        <div class="row-flex" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }} class="grow">Revisions</h3>
          <button
            class="btn"
            onClick={() =>
              store.update((pp) => {
                const cur = pp.meta.revisions[0]?.rev ?? "";
                const next = /^\d+$/.test(cur) ? String(Number(cur) + 1) : /^[A-Y]$/.test(cur) ? String.fromCharCode(cur.charCodeAt(0) + 1) : "";
                pp.meta.revisions = [{ rev: next, date: new Date().toISOString().slice(0, 10), description: "", prepared: "", checked: "", approved: "" }, ...pp.meta.revisions];
              })
            }
          >
            + New revision
          </button>
        </div>
        <table class="simple">
          <thead>
            <tr>
              <th>Rev.</th>
              <th>Date</th>
              <th>Description</th>
              <th>Prepared</th>
              <th>Checked</th>
              <th>Approved</th>
            </tr>
          </thead>
          <tbody>
            {m.revisions.map((r, i) => (
              <tr>
                {(["rev", "date", "description", "prepared", "checked", "approved"] as (keyof Revision)[]).map((k) => (
                  <td>
                    <TextInput value={r[k]} onCommit={(v) => setRev(i, k, v)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h3>Evaluation rules</h3>
        <div class="grid-form">
          <Field label="Offered quantity above requirement">
            <select class="select" value={p.policy.overQuantity} onChange={(e) => setPol("overQuantity", (e.currentTarget as HTMLSelectElement).value as Policy["overQuantity"])}>
              <option value="Clarify">Clarify (confirm intended quantity)</option>
              <option value="Deviation">Deviation</option>
              <option value="Comply">Comply</option>
            </select>
          </Field>
          <Field label="Flag offered values above N x a minimum (0 = off)">
            <input
              class="input"
              type="number"
              min="0"
              step="0.5"
              key={String(p.policy.oversizeFactor)}
              defaultValue={String(p.policy.oversizeFactor)}
              onBlur={(e) => setPol("oversizeFactor", Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0))}
            />
          </Field>
          <label class="field">
            TQ register
            <span>
              <input type="checkbox" checked={p.policy.notQuotedInTq} onChange={(e) => setPol("notQuotedInTq", (e.currentTarget as HTMLInputElement).checked)} /> Raise a TQ for Not Quoted lines
            </span>
          </label>
          <label class="field">
            Evidence
            <span>
              <input type="checkbox" checked={p.policy.requireEvidence} onChange={(e) => setPol("requireEvidence", (e.currentTarget as HTMLInputElement).checked)} /> Warn when a compliant line has no quotation evidence
            </span>
          </label>
        </div>
      </div>

      <div class="panel">
        <h3>This browser</h3>
        <p class="small muted">
          Projects autosave in this browser only. Use Save (JSON), Export Excel or Export HTML to keep a file you can share or archive.
        </p>
        <button class="btn danger" onClick={onDelete}>Remove this project from this browser…</button>
      </div>
    </div>
  );
}
