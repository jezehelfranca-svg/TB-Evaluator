// Per-page text extraction from quotation PDFs with pdf.js, fully offline:
// the worker source is bundled into the page and started from a Blob URL.

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSource from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw";

let workerUrl: string | null = null;

function ensureWorker() {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
}

interface TextItem {
  str: string;
  transform: number[];
}

/** Text of each page, with items grouped into lines top-to-bottom, left-to-right. */
export async function extractPdfPages(data: ArrayBuffer, onProgress?: (page: number, total: number) => void): Promise<string[]> {
  ensureWorker();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === "string");
    items.sort((a, b) => (Math.abs(a.transform[5] - b.transform[5]) > 3 ? b.transform[5] - a.transform[5] : a.transform[4] - b.transform[4]));
    const lines: string[] = [];
    let cur: string[] = [];
    let y: number | null = null;
    for (const it of items) {
      const iy = it.transform[5];
      if (y !== null && Math.abs(iy - y) > 3) {
        lines.push(cur.join(" ").replace(/\s+/g, " ").trim());
        cur = [];
      }
      if (it.str.trim()) cur.push(it.str);
      y = iy;
    }
    if (cur.length) lines.push(cur.join(" ").replace(/\s+/g, " ").trim());
    pages.push(lines.filter(Boolean).join("\n"));
    onProgress?.(p, doc.numPages);
  }
  await task.destroy();
  return pages;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
