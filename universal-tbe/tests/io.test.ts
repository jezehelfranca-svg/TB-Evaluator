import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { fromSheet, readBidderCell } from "../src/io/clientSheet";
import { projectFromWorkbook, workbookBytes, parseDelimited } from "../src/io/excel";
import { extractStudioPresets, fromStudio } from "../src/io/studio";
import { bidderStats } from "../src/engine/scoring";
import { suggest } from "../src/engine/rules";
import { validateProject } from "../src/engine/project";

const clientRows = [
  ["TECHNICAL BID EVALUATION TABULATION", null, null, null, null, "REV. NO.: A"],
  [],
  ["Project: BOTB"],
  ["M/R NO. BOTB-PKG1-MR-TE-0001 (Rev.A)"],
  ["SYSTEM: Telecommunication System"],
  ["NO", "DESCRIPTION", "SPECIFICATION", "BIDDER'S NAME", "HEC comments / Answer", "REMARKS"],
  [null, null, null, "Vector", new Date("2026-09-22"), null],
  [],
  ["13", "Outside Plant Cable System", "Outside Plant Cable System"],
  ["13.2", "144 Core Fiber Optic Splice Closure", "144 Core Fiber Optic Splice Closure", "Comply"],
  [null, null, "- Protection Rating : IP68 or Higher", "IP68"],
  [null, null, "- Fiber Capacity : Minimum 144 Fiber Splices", "96 splices"],
  [null, null, "- Operating Temperature : -50°C to +65°C", null, "Datasheet required"],
  ["13.3", "48 Core Fiber Optic Splice Closure", "48 Core Fiber Optic Splice Closure"],
  [null, null, "- Protection Rating : IP68 or Higher"],
];

describe("client tabulation sheet import", () => {
  const p = fromSheet({ name: "Sheet1", rows: clientRows });
  it("reads metadata, bidder name from the sub-header, and structure", () => {
    expect(p.meta.projectName).toBe("BOTB");
    expect(p.meta.mrNo).toBe("BOTB-PKG1-MR-TE-0001 (Rev.A)");
    expect(p.bidders.map((b) => b.name)).toEqual(["Vector"]);
    expect(p.rows.map((r) => r.level)).toEqual([1, 2, 3, 3, 3, 2, 3]);
  });
  it("empty bidder cells stay Pending; vendor text becomes the offer", () => {
    const b = p.bidders[0].id;
    const cells = p.rows.map((r) => p.cells[r.id]?.[b]);
    expect(cells[1]).toMatchObject({ status: "Pending", offered: "Comply" });
    expect(cells[3]).toMatchObject({ status: "Pending", offered: "96 splices" });
    expect(cells[4]).toMatchObject({ status: "Pending", note: "Datasheet required" });
    expect(cells[6]).toBeUndefined();
    expect(bidderStats(p)[0].compliant).toBe(0);
  });
  it("rules then evaluate the imported offer", () => {
    const b = p.bidders[0];
    expect(suggest(p, 2, b).status).toBe("Comply"); // IP68 offered
    expect(suggest(p, 3, b).status).toBe("Deviation"); // 96 < 144 fibres
  });
  it("bracketed statuses from app exports are evaluator statuses", () => {
    expect(readBidderCell("[Deviation] 6 panels vs 9", true)).toMatchObject({ status: "Deviation", note: "6 panels vs 9" });
    expect(readBidderCell("Confirm", true).status).toBe("Confirm");
    expect(readBidderCell("Confirm", false)).toMatchObject({ status: "Pending", offered: "Confirm" });
  });
  it("CSV input", () => {
    const rows = parseDelimited('NO,DESCRIPTION,SPECIFICATION,ACME\n1,"Rack, 42U","42U, IP54",IP55\n');
    expect(fromSheet({ name: "csv", rows }).bidders[0].name).toBe("ACME");
  });
});

describe("Excel export and re-import", () => {
  it("round-trips the project and merges edits made in Excel", async () => {
    const p = fromSheet({ name: "Sheet1", rows: clientRows });
    const b = p.bidders[0];
    p.cells[p.rows[3].id][b.id].status = "Deviation";
    p.remarks[p.rows[1].id] = "Revise offer";
    const bytes = await workbookBytes(p);

    const again = await projectFromWorkbook(bytes, "x.xlsx");
    expect(again.project.rows).toEqual(p.rows);
    expect(again.project.cells).toEqual(p.cells);
    expect(again.project.remarks).toEqual(p.remarks);

    // Edit a status and a comment in the Tabulation sheet, then re-import.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Tabulation")!;
    let hdrRow = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(2).value === "DESCRIPTION") hdrRow = n;
    });
    const target = p.rows[2].id; // IP68 line
    ws.eachRow((row) => {
      if (row.getCell(ws.columnCount).value === target) {
        row.getCell(6).value = "Comply";
        row.getCell(8).value = "Accepted per datasheet p.4";
      }
    });
    expect(hdrRow).toBeGreaterThan(0);
    const edited = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const merged = await projectFromWorkbook(edited, "x.xlsx");
    expect(merged.message).toMatch(/merged 1 edit/);
    expect(merged.project.cells[target][b.id]).toMatchObject({ status: "Comply", note: "Accepted per datasheet p.4", offered: "IP68" });
  });
});

describe("Universal TBE Studio import (synthetic)", () => {
  const html = `<script>const PRESETS = ${JSON.stringify({
    demo: {
      meta: { projectName: "Demo", system: "Security CCTV & ACS", docNo: "D-1", revisions: [{ rev: "A1", date: "", description: "x" }] },
      bidders: [{ id: "a", name: "Alpha", short: "A" }, { id: "b", name: "Beta", short: "B" }],
      rows: [
        { id: 1, level: 1, no: "S.8", desc: "Security", spec: "", responses: [{ status: "", note: "" }, { status: "", note: "" }] },
        { id: 2, level: 2, no: "S.8.1", desc: "Cabinet", spec: "42U cabinet | Qty: 6 Sets", responses: [{ status: "Clarify", note: "3 cabinets" }, { status: "", note: "" }], remarks: "TQ", conclusion: "Technically Acceptable" },
      ],
    },
  })};\nlet x = "}";</script>`;
  it("reads presets and never turns blank statuses into Confirm", () => {
    const presets = extractStudioPresets(html);
    const p = fromStudio(presets.demo);
    expect(p.meta.discipline).toBe("telecom");
    expect(p.rows[1]).toMatchObject({ qty: 6, uom: "SET" });
    expect(p.cells[p.rows[1].id]).toEqual({ a: { status: "Clarify", note: "3 cabinets" } });
    expect(bidderStats(p)[1].pending).toBe(1);
    expect(p.remarks[p.rows[1].id]).toBe("TQ");
    expect(() => validateProject(JSON.parse(JSON.stringify(p)))).not.toThrow();
  });
});

// Real project files, when available locally (not committed to this repository).
const REAL = process.env.TBE_REAL_DATA ?? "/home/user/botb/TBE";
describe.skipIf(!existsSync(REAL))("real BOTB / AGSA files", () => {
  it("imports the PK1 and PK2 client sheets", async () => {
    for (const f of ["Telecom System_PK1_TBE Sheet.xlsx", "Telecom System_PK2_TBE Sheet_A1.xlsx"]) {
      const { project, message } = await projectFromWorkbook(readFileSync(join(REAL, f)), f);
      const lv = [1, 2, 3].map((l) => project.rows.filter((r) => r.level === l).length);
      console.log(f, message, "levels", lv, "bidders", project.bidders.map((b) => b.name));
      expect(project.bidders.length).toBe(1);
      expect(lv[1]).toBeGreaterThan(5);
      expect(lv[2]).toBeGreaterThan(lv[1]);
      expect(bidderStats(project)[0].compliant).toBe(0);
    }
  });
  it("imports every preset of the Studio HTML", () => {
    const html = readFileSync(join(REAL, "Universal_TBE_App_Petro_Rabigh_Security_TBE_Evaluated.html"), "utf8");
    const presets = extractStudioPresets(html);
    expect(Object.keys(presets)).toContain("petro_rabigh_pkg1_security");
    for (const [k, d] of Object.entries(presets)) {
      const p = fromStudio(d, k);
      const st = bidderStats(p);
      console.log(k.padEnd(28), "lines", st[0]?.lines, st.map((s) => `${s.bidder.short}: pend ${s.pending} ok ${s.compliant} q ${s.clarify + s.deviation + s.exception} nq ${s.notQuoted}`).join(" | "));
      expect(() => validateProject(JSON.parse(JSON.stringify(p)))).not.toThrow();
    }
    const sec = fromStudio(presets.petro_rabigh_pkg1_security);
    expect(sec.rows.filter((r) => r.qty != null).length).toBe(17);
    const pkg2 = fromStudio(presets.petro_rabigh_pkg2_telecom);
    expect(bidderStats(pkg2).every((s) => s.compliant === 0 && s.pending === s.inScope)).toBe(true);
  });
});
