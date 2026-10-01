// Application state: the open project, a local project library (browser
// storage, per-machine convenience only) and change notification for Preact.

import { useEffect, useState } from "preact/hooks";
import { validateProject } from "../engine/project";
import type { Project } from "../engine/types";

export interface LibraryEntry {
  id: string;
  name: string;
  docNo: string;
  savedAt: string;
}

const INDEX = "utbe.index";
const KEY = (id: string) => `utbe.p.${id}`;
const LAST = "utbe.last";

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): string | null {
  try {
    localStorage.setItem(k, v);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
function safeDel(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function listLibrary(): LibraryEntry[] {
  try {
    const v = JSON.parse(safeGet(INDEX) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function loadFromLibrary(id: string): Project | null {
  const raw = safeGet(KEY(id));
  if (!raw) return null;
  try {
    return validateProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function deleteFromLibrary(id: string) {
  safeDel(KEY(id));
  safeSet(INDEX, JSON.stringify(listLibrary().filter((e) => e.id !== id)));
}

function saveToLibrary(p: Project): string | null {
  const err = safeSet(KEY(p.id), JSON.stringify(p));
  if (err) return err;
  const entry: LibraryEntry = { id: p.id, name: p.meta.projectShort || p.meta.projectName || "Untitled", docNo: p.meta.docNo, savedAt: p.savedAt };
  const list = listLibrary().filter((e) => e.id !== p.id);
  list.unshift(entry);
  safeSet(INDEX, JSON.stringify(list));
  safeSet(LAST, p.id);
  return null;
}

export function lastOpenedId(): string | null {
  return safeGet(LAST);
}

type Listener = () => void;

class Store {
  project: Project | null = null;
  version = 0;
  saveError: string | null = null;
  dirtyFile = false; // changed since the last file save/export
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  open(p: Project | null) {
    this.project = p;
    this.dirtyFile = false;
    this.bump();
    if (p) this.persist();
  }

  /** Mutate the open project. Structural row edits must assign a new rows array. */
  update(fn: (p: Project) => void) {
    if (!this.project) return;
    fn(this.project);
    this.project.savedAt = new Date().toISOString();
    this.dirtyFile = true;
    this.bump();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.persist(), 400);
  }

  persist() {
    if (!this.project) return;
    const err = saveToLibrary(this.project);
    if (err !== this.saveError) {
      this.saveError = err;
      this.bump();
    }
  }

  markSaved() {
    this.dirtyFile = false;
    this.bump();
  }

  bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const store = new Store();

export function useStore(): Store {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((v) => v + 1)), []);
  return store;
}

// Transient UI messages.
export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "warn" | "error";
}
let toastId = 0;
const toastListeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
export function toast(text: string, kind: Toast["kind"] = "ok") {
  const t = { id: ++toastId, text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l(toasts));
  }, kind === "error" ? 8000 : 3500);
}
export function useToasts(): Toast[] {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => void toastListeners.delete(setList);
  }, []);
  return list;
}
