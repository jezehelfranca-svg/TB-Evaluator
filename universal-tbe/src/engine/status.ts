import type { Status } from "./types";

export const STATUSES: Status[] = [
  "Pending",
  "Confirm",
  "Comply",
  "Clarify",
  "Deviation",
  "Exception",
  "Not Quoted",
  "Out of Scope",
  "N/A",
];

export const STATUS_LABEL: Record<Status, string> = {
  Pending: "Pending",
  Confirm: "Confirm",
  Comply: "Comply",
  Clarify: "Clarify Required",
  Deviation: "Deviation (TQ)",
  Exception: "Exception",
  "Not Quoted": "Not Quoted",
  "Out of Scope": "Out of Scope",
  "N/A": "N/A",
};

/** CSS-safe class suffix per status. */
export const STATUS_CLASS: Record<Status, string> = {
  Pending: "pending",
  Confirm: "confirm",
  Comply: "comply",
  Clarify: "clarify",
  Deviation: "deviation",
  Exception: "exception",
  "Not Quoted": "notquoted",
  "Out of Scope": "outofscope",
  "N/A": "na",
};

export const isCompliant = (s: Status) => s === "Confirm" || s === "Comply";
export const isQuery = (s: Status) => s === "Clarify" || s === "Deviation" || s === "Exception";
/** Statuses that remove a line from the bidder's evaluation denominator. */
export const isExcluded = (s: Status) => s === "Out of Scope" || s === "N/A";

/** Severity order used when combining findings: higher wins. */
export const SEVERITY: Record<Status, number> = {
  Pending: 0,
  "N/A": 1,
  "Out of Scope": 1,
  Confirm: 2,
  Comply: 2,
  Clarify: 3,
  "Not Quoted": 4,
  Deviation: 5,
  Exception: 6,
};

export function worst(a: Status | null, b: Status | null): Status | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}

/**
 * Read a status out of free text written in a bidder cell (imported sheets).
 * Returns null when the text carries no recognisable status: an empty or
 * unrecognised cell is NOT evidence of compliance.
 */
export function statusFromText(text: string): Status | null {
  const t = text.trim();
  if (!t) return null;
  const bracket = t.match(/^\[([^\]]+)\]/);
  if (bracket) {
    const inner = bracket[1].trim();
    const exact = STATUSES.find((s) => s.toLowerCase() === inner.toLowerCase());
    if (exact) return exact;
    const byLabel = STATUSES.find((s) => STATUS_LABEL[s].toLowerCase() === inner.toLowerCase());
    if (byLabel) return byLabel;
  }
  const u = t.toUpperCase();
  if (/\bOUT OF SCOPE\b/.test(u)) return "Out of Scope";
  if (/^N\/?A\b/.test(u) || /\bNOT APPLICABLE\b/.test(u)) return "N/A";
  if (/\bNOT\s+QUOTED\b|\bNOT\s+OFFERED\b|\bNOT\s+INCLUDED\b|\bEXCLUDED\b/.test(u)) return "Not Quoted";
  if (/\bEXCEPTION\b|\bNOT\s+COMPL/.test(u)) return "Exception";
  if (/\bDEVIAT/.test(u)) return "Deviation";
  if (/\bCLARIF|\bTBD\b|\bTBC\b|\bTO BE CONFIRMED\b/.test(u)) return "Clarify";
  if (/^(COMPLY|COMPLIED|COMPLIES|COMPLIANT)\b/.test(u)) return "Comply";
  if (/^(CONFIRM|CONFIRMED|NOTED AND CONFIRMED)\b/.test(u)) return "Confirm";
  if (/^PENDING\b/.test(u)) return "Pending";
  return null;
}
