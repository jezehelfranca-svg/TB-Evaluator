// Search the stored text of quotation documents. Returned snippets are
// verbatim lines of the page, so they can be attached as evidence and
// re-verified later.

import type { QuoteDoc, Row } from "../engine/types";

export interface Hit {
  docId: string;
  docName: string;
  page: number;
  snippet: string;
  score: number;
  matched: string[];
}

const STOP = new Set(
  "and or the with for to in of as per a an set ea lot system by from on at be is are shall type including include complete c/w all any each".split(" "),
);

export function terms(query: string): string[] {
  const out = new Set<string>();
  for (const t of query.toLowerCase().match(/[a-z0-9][a-z0-9.\-/+]*[a-z0-9+]|[a-z0-9]/g) ?? []) {
    if (t.length < 2 || STOP.has(t)) continue;
    out.add(t);
  }
  return [...out];
}

/** Tag-like tokens (digits with letters/dashes) are strong anchors. */
const weight = (t: string) => (/\d/.test(t) && /[a-z-]/.test(t) ? 3 : /\d/.test(t) ? 1.5 : 1);

export function searchDocs(docs: QuoteDoc[], query: string, max = 25): Hit[] {
  const ts = terms(query);
  if (!ts.length) return [];
  const hits: Hit[] = [];
  for (const d of docs)
    d.pages.forEach((text, pi) => {
      const lines = text.split("\n");
      lines.forEach((line, li) => {
        const window = `${line} ${lines[li + 1] ?? ""}`.toLowerCase();
        const matched = ts.filter((t) => window.includes(t));
        if (!matched.length || !line.trim()) return;
        const own = ts.filter((t) => line.toLowerCase().includes(t));
        if (!own.length) return;
        const score = matched.reduce((s, t) => s + weight(t), 0) + (window.includes(query.toLowerCase().trim()) ? 5 : 0);
        hits.push({ docId: d.id, docName: d.name, page: pi + 1, snippet: [line, lines[li + 1] ?? ""].join("\n").trim(), score, matched });
      });
    });
  hits.sort((a, b) => b.score - a.score || a.page - b.page);
  // One hit per page/line region.
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const k = `${h.docId}:${h.page}:${h.snippet.slice(0, 40)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** A reasonable first query for a line: tag / item number plus the main description words. */
export function defaultQuery(row: Row, parent: Row | null): string {
  const base = row.level === 3 ? `${parent?.desc ?? ""} ${row.spec}` : row.desc || row.spec;
  const words = terms(base.replace(/\|.*$/, "")).filter((t) => t.length > 2 || /\d/.test(t));
  const tag = /\d/.test(row.no) && /[A-Z]{2,}|-/.test(row.no) ? `${row.no} ` : "";
  return (tag + words.slice(0, 6).join(" ")).trim();
}
