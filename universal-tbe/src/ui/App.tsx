import { useCallback, useState } from "preact/hooks";
import { newId, newProject } from "../engine/project";
import type { Discipline, Project } from "../engine/types";
import { APP_VERSION } from "../io/excel";
import { fromStudio, type StudioData } from "../io/studio";
import { Modal } from "./components";
import { demoProject } from "./demo";
import { cellKey, derive } from "./derive";
import { exportExcel, exportHtml, openFile, pickFile, saveJson } from "./files";
import { deleteFromLibrary, listLibrary, loadFromLibrary, store, toast, useStore, useToasts } from "./store";
import { Bidders } from "./views/Bidders";
import { CellDrawer } from "./views/CellDrawer";
import { Checks } from "./views/Checks";
import { Dashboard } from "./views/Dashboard";
import { emptyFilter, Matrix, type MatrixFilter } from "./views/Matrix";
import { RowDrawer } from "./views/RowDrawer";
import { Setup } from "./views/Setup";
import { Tq } from "./views/Tq";

type Tab = "dashboard" | "matrix" | "tq" | "bidders" | "setup" | "checks";
type Drawer = { kind: "cell"; rowId: string; bidderId: string } | { kind: "row"; rowId: string } | null;

function Toasts() {
  const list = useToasts();
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div class={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

function blank(discipline: Discipline): Project {
  const p = newProject({ projectName: "New TBE", discipline });
  p.rows = [{ id: newId("row"), level: 1, no: "1", desc: "Section 1", spec: "" }];
  return p;
}

export function App() {
  const s = useStore();
  const p = s.project;
  const [tab, setTab] = useState<Tab>("dashboard");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [filter, setFilter] = useState<MatrixFilter>(emptyFilter);
  const [presets, setPresets] = useState<{ fileName: string; presets: Record<string, StudioData>; chosen: Set<string> } | null>(null);
  const [library, setLibrary] = useState(false);
  const [newMenu, setNewMenu] = useState(false);

  const openProject = (proj: Project, msg?: string) => {
    store.open(proj);
    setDrawer(null);
    setFilter(emptyFilter);
    setTab(proj.rows.some((r) => r.level > 1) ? "dashboard" : "matrix");
    if (msg) toast(msg);
  };

  const guardDirty = () => !s.dirtyFile || confirm("This project has changes that are not in a saved file (they are autosaved in this browser). Continue?");

  const doOpen = async () => {
    const f = await pickFile(".json,.html,.htm,.xlsx,.xlsm,.csv,.tsv,.txt");
    if (!f) return;
    try {
      const r = await openFile(f);
      if (r.kind === "project") openProject(r.project, r.message);
      else setPresets({ fileName: r.fileName, presets: r.presets, chosen: new Set(Object.keys(r.presets)) });
    } catch (e) {
      toast(`Could not open ${f.name}: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

  const importPresets = () => {
    if (!presets) return;
    const keys = [...presets.chosen];
    let first: Project | null = null;
    for (const k of keys) {
      const proj = fromStudio(presets.presets[k], k);
      store.open(proj); // saves each into the library
      first ??= proj;
    }
    setPresets(null);
    if (first) openProject(first, `Imported ${keys.length} project(s) from ${presets.fileName}. Blank statuses from the old app are Pending.`);
  };

  const run = async (label: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      store.markSaved();
    } catch (e) {
      toast(`${label} failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

  const openCell = useCallback((rowId: string, bidderId: string) => setDrawer({ kind: "cell", rowId, bidderId }), []);
  const openRow = useCallback(
    (rowId: string) => {
      if (rowId === "__new__") {
        const id = newId("row");
        store.update((pp) => {
          pp.rows = [...pp.rows, { id, level: 2, no: "", desc: "New item", spec: "" }];
        });
        setDrawer({ kind: "row", rowId: id });
        return;
      }
      setDrawer({ kind: "row", rowId });
    },
    [],
  );

  // ------------------------------------------------------------ welcome
  if (!p) {
    const lib = listLibrary();
    return (
      <>
        <div class="topbar">
          <div class="brand">
            <span class="badge">TBE</span> Universal TBE Workbench
          </div>
        </div>
        <main>
          <div class="welcome">
            <h1>Technical Bid Evaluation for electrical and telecom packages</h1>
            <p class="muted">
              Works offline in this file. Bid documents never leave this computer. Start a tabulation, open a client TBE sheet (.xlsx / .csv), a saved project (.json / .html),
              or an old Universal TBE Studio HTML file.
            </p>
            <div class="cards3">
              <button onClick={doOpen}>
                <b>Open a file…</b>
                <span class="small muted">Client TBE sheet, saved project, Studio HTML</span>
              </button>
              <button onClick={() => openProject(blank("electrical"))}>
                <b>New electrical TBE</b>
                <span class="small muted">Switchgear, MCC, busduct, transformers, cables…</span>
              </button>
              <button onClick={() => openProject(blank("telecom"))}>
                <b>New telecom / security TBE</b>
                <span class="small muted">LAN, PAGA, radio, CCTV, ACS, fibre…</span>
              </button>
              <button onClick={() => openProject(demoProject(), "Demo project loaded (fictitious data).")}>
                <b>Try the demo</b>
                <span class="small muted">See the checks, conflicts and TQs on sample offers</span>
              </button>
            </div>
            {lib.length > 0 && (
              <div class="panel" style={{ marginTop: 18 }}>
                <h3>Recent projects in this browser</h3>
                {lib.map((e) => (
                  <div class="row-flex" style={{ padding: "4px 0" }}>
                    <a href="#" onClick={(ev) => (ev.preventDefault(), (() => { const pr = loadFromLibrary(e.id); pr ? openProject(pr) : toast("Could not load that project.", "error"); })())}>
                      <b>{e.name}</b>
                    </a>
                    <span class="small muted">{e.docNo}</span>
                    <span class="small faint">saved {e.savedAt.slice(0, 16).replace("T", " ")}</span>
                  </div>
                ))}
              </div>
            )}
            <p class="small faint">Version {APP_VERSION}</p>
          </div>
        </main>
        {presets && <PresetModal presets={presets} setPresets={setPresets} onImport={importPresets} />}
        <Toasts />
      </>
    );
  }

  // ------------------------------------------------------------ project
  const d = derive(p, s.version);
  const blockers = d.checks().filter((c) => c.severity === "blocker").length;
  const openQueries = d.stats.reduce((a, x) => a + x.openQueries, 0);
  const go = (t: string, status?: string) => {
    if (status) setFilter({ ...emptyFilter, status: status as MatrixFilter["status"] });
    setTab(t as Tab);
  };
  const openFromList = (rowId?: string, bidderId?: string) => {
    if (!rowId && bidderId) {
      setFilter({ ...emptyFilter, status: "pending", bidder: bidderId });
      setTab("matrix");
      return;
    }
    if (!rowId) return;
    setTab("matrix");
    setDrawer(bidderId ? { kind: "cell", rowId, bidderId } : { kind: "row", rowId });
  };

  const TABS: [Tab, string, number | null, boolean?][] = [
    ["dashboard", "Dashboard", null],
    ["matrix", "Tabulation Matrix", p.rows.filter((r) => r.level > 1).length],
    ["tq", "TQ Register", openQueries, openQueries > 0],
    ["bidders", "Bidders & Scope", p.bidders.length],
    ["setup", "Document Control", null],
    ["checks", "Issue Check", blockers, blockers > 0],
  ];

  return (
    <>
      <div class="topbar">
        <div class="brand">
          <span class="badge">TBE</span> Universal TBE Workbench
        </div>
        <span class="doc" title={p.meta.projectName}>
          {p.meta.projectShort || p.meta.projectName || "Untitled"} · {p.meta.docNo || "no doc. no."}
          {s.dirtyFile && <span class="dirty-dot" title="Changes not yet saved to a file (autosaved in this browser)" />}
        </span>
        <span class="spacer" />
        <button class="tb-btn" onClick={() => setLibrary(true)}>Projects</button>
        <div style={{ position: "relative" }}>
          <button class="tb-btn" onClick={() => setNewMenu(!newMenu)}>New ▾</button>
          {newMenu && (
            <div class="panel" style={{ position: "absolute", right: 0, top: 32, zIndex: 25, width: 220, padding: 6 }} onMouseLeave={() => setNewMenu(false)}>
              {(["electrical", "telecom", "mixed"] as Discipline[]).map((k) => (
                <button class="btn" style={{ width: "100%", marginBottom: 4, textAlign: "left" }} onClick={() => (setNewMenu(false), guardDirty() && openProject(blank(k)))}>
                  {k === "mixed" ? "Electrical + telecom" : k[0].toUpperCase() + k.slice(1)} TBE
                </button>
              ))}
              <button class="btn" style={{ width: "100%", textAlign: "left" }} onClick={() => (setNewMenu(false), guardDirty() && openProject(demoProject(), "Demo project loaded."))}>
                Demo project
              </button>
            </div>
          )}
        </div>
        <button class="tb-btn" onClick={() => guardDirty() && doOpen()}>Open…</button>
        <button class="tb-btn" onClick={() => run("Save", () => saveJson(p))} title="Save the project as a .tbe.json file">Save</button>
        <button class="tb-btn primary" onClick={() => run("Excel export", () => exportExcel(p))}>Export Excel</button>
        <button class="tb-btn" onClick={() => run("HTML export", () => exportHtml(p))} title="A copy of this app with the project inside, to share or archive">Export HTML</button>
        <button class="tb-btn" onClick={() => window.print()}>Print</button>
      </div>
      {s.saveError && <div class="banner error">Autosave in this browser failed ({s.saveError}). Use Save to keep a file of your work.</div>}
      <nav class="tabs" role="tablist">
        {TABS.map(([k, label, n, warn]) => (
          <button role="tab" aria-selected={tab === k} class={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
            {label}
            {n !== null && <span class={`count${warn ? " warn" : ""}`}>{n}</span>}
          </button>
        ))}
      </nav>
      <main>
        {tab === "dashboard" && <Dashboard project={p} d={d} go={go} />}
        {tab === "matrix" && (
          <Matrix
            project={p}
            d={d}
            filter={filter}
            setFilter={setFilter}
            selected={drawer?.kind === "cell" ? cellKey(drawer.rowId, drawer.bidderId) : null}
            onOpenCell={openCell}
            onOpenRow={openRow}
          />
        )}
        {tab === "tq" && <Tq project={p} d={d} onOpen={(r, b) => openFromList(r, b)} />}
        {tab === "bidders" && <Bidders project={p} />}
        {tab === "setup" && (
          <Setup
            project={p}
            onDelete={() => {
              if (!confirm("Remove this project from this browser? Files you saved or exported are not affected.")) return;
              deleteFromLibrary(p.id);
              store.open(null);
            }}
          />
        )}
        {tab === "checks" && <Checks d={d} onOpen={openFromList} />}
      </main>

      {drawer?.kind === "cell" && (
        <CellDrawer project={p} d={d} rowId={drawer.rowId} bidderId={drawer.bidderId} onClose={() => setDrawer(null)} onNavigate={(r, b) => setDrawer({ kind: "cell", rowId: r, bidderId: b })} />
      )}
      {drawer?.kind === "row" && <RowDrawer project={p} rowId={drawer.rowId} onClose={() => setDrawer(null)} onOpen={(id) => setDrawer({ kind: "row", rowId: id })} />}

      {library && (
        <Modal title="Projects in this browser" onClose={() => setLibrary(false)}>
          {listLibrary().map((e) => (
            <div class="row-flex" style={{ padding: "5px 0", borderBottom: "1px solid var(--line-2)" }}>
              <div class="grow">
                <b>{e.name}</b> <span class="small muted">{e.docNo}</span>
                <div class="small faint">saved {e.savedAt.slice(0, 16).replace("T", " ")}</div>
              </div>
              {e.id === p.id ? (
                <span class="small muted">open</span>
              ) : (
                <button
                  class="btn"
                  onClick={() => {
                    const pr = loadFromLibrary(e.id);
                    if (!pr) return toast("Could not load that project.", "error");
                    setLibrary(false);
                    openProject(pr);
                  }}
                >
                  Open
                </button>
              )}
            </div>
          ))}
          <p class="small muted">Browser storage is a convenience copy. Keep project files (Save / Export) as the record.</p>
        </Modal>
      )}
      {presets && <PresetModal presets={presets} setPresets={setPresets} onImport={importPresets} />}
      <Toasts />
    </>
  );
}

function PresetModal({
  presets,
  setPresets,
  onImport,
}: {
  presets: { fileName: string; presets: Record<string, StudioData>; chosen: Set<string> };
  setPresets: (v: typeof presets | null) => void;
  onImport: () => void;
}) {
  const keys = Object.keys(presets.presets);
  return (
    <Modal
      title={`Import from ${presets.fileName}`}
      onClose={() => setPresets(null)}
      footer={
        <>
          <button class="btn" onClick={() => setPresets(null)}>Cancel</button>
          <button class="btn primary" disabled={!presets.chosen.size} onClick={onImport}>
            Import {presets.chosen.size} project(s)
          </button>
        </>
      }
    >
      <p class="small muted">Universal TBE Studio projects found in this file. Each becomes a separate project; blank statuses import as Pending.</p>
      {keys.map((k) => {
        const d = presets.presets[k];
        const lines = (d.rows ?? []).filter((r) => Number(r.level) > 1).length;
        return (
          <label style={{ display: "block", padding: "3px 0" }}>
            <input
              type="checkbox"
              checked={presets.chosen.has(k)}
              onChange={(e) => {
                const c = new Set(presets.chosen);
                if ((e.currentTarget as HTMLInputElement).checked) c.add(k);
                else c.delete(k);
                setPresets({ ...presets, chosen: c });
              }}
            />{" "}
            <b>{String(d.meta?.projectShort || d.meta?.projectName || k)}</b> <span class="small muted">{String(d.meta?.system ?? "")} · {lines} lines · {(d.bidders ?? []).length} bidders</span>
          </label>
        );
      })}
    </Modal>
  );
}
