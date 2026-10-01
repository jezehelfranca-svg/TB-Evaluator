// File input/output in the browser.

import { validateProject } from "../engine/project";
import type { Project } from "../engine/types";
import { fromSheet } from "../io/clientSheet";
import { parseDelimited, projectFromWorkbook, workbookBytes } from "../io/excel";
import { extractStudioPresets, fromStudio, isStudioData, type StudioData } from "../io/studio";

export type Opened =
  | { kind: "project"; project: Project; message: string }
  | { kind: "studio"; presets: Record<string, StudioData>; fileName: string };

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function openFile(file: File): Promise<Opened> {
  const name = file.name;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "json") {
    const obj = JSON.parse(await file.text());
    if (isStudioData(obj)) return { kind: "project", project: fromStudio(obj, name.replace(/\.json$/i, "")), message: `Imported Universal TBE Studio snapshot ${name}.` };
    return { kind: "project", project: validateProject(obj), message: `Opened ${name}.` };
  }
  if (ext === "html" || ext === "htm") {
    const text = await file.text();
    const embedded = embeddedProjectText(text);
    if (embedded) return { kind: "project", project: validateProject(JSON.parse(embedded)), message: `Opened the project embedded in ${name}.` };
    return { kind: "studio", presets: extractStudioPresets(text), fileName: name };
  }
  if (ext === "xlsx" || ext === "xlsm") {
    const r = await projectFromWorkbook(await file.arrayBuffer(), name);
    return { kind: "project", project: r.project, message: r.message };
  }
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const p = fromSheet({ name, rows: parseDelimited(await file.text()) }, name);
    return { kind: "project", project: p, message: `Imported ${name}.` };
  }
  if (ext === "xls") throw new Error("Old .xls workbooks are not supported. Open the file in Excel and save it as .xlsx.");
  throw new Error(`Unsupported file type: .${ext}`);
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function baseName(p: Project): string {
  const s = (p.meta.docNo || p.meta.projectShort || p.meta.projectName || "TBE").replace(/[^\w.\- ()]+/g, "_").trim();
  return s || "TBE";
}

export function saveJson(p: Project) {
  download(`${baseName(p)}.tbe.json`, JSON.stringify(p, null, 1), "application/json");
}

export async function exportExcel(p: Project) {
  download(`${baseName(p)}_TBE.xlsx`, (await workbookBytes(p)) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// ---------------------------------------------------------- HTML export

export const EMBED_ID = "utbe-project";

/** JSON text of a project embedded in an exported HTML file, if any. */
export function embeddedProjectText(html: string): string | null {
  const m = html.match(new RegExp(`<script id="${EMBED_ID}" type="application/json">([\\s\\S]*?)</script>`));
  const t = m?.[1].trim();
  return t ? t : null;
}

export function pageTemplate(css: string, js: string, projectJson: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&]/g, "")}</title>
<style id="utbe-css">${css}</style>
</head>
<body>
<div id="app"></div>
<script id="${EMBED_ID}" type="application/json">${projectJson}</script>
<script id="utbe-js" type="module">${js}</script>
</body>
</html>
`;
}

/** Safe to place inside <script>: no "</script" or "<!--" sequences. */
export function scriptSafe(s: string): string {
  return s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

/** Save a copy of this app with the current project embedded, to share or archive. */
export function exportHtml(p: Project) {
  const css = document.getElementById("utbe-css")?.textContent ?? "";
  const js = document.getElementById("utbe-js")?.textContent ?? "";
  if (!js) throw new Error("App source not found in this page.");
  const json = JSON.stringify(p).replace(/</g, "\\u003c");
  const title = `${p.meta.docNo || p.meta.projectName || "TBE"} - Universal TBE Workbench`;
  download(`${baseName(p)}_TBE.html`, pageTemplate(css, js, json, title), "text/html");
}

export function readEmbeddedProject(): Project | null {
  const t = document.getElementById(EMBED_ID)?.textContent?.trim();
  if (!t) return null;
  return validateProject(JSON.parse(t));
}
