# Universal TBE Workbench

An offline, single-file Technical Bid Evaluation (TBE) tool for **electrical and telecom / security** packages.
Open `Universal_TBE_Workbench.html` in Chrome or Edge. It makes no network requests: bid documents and
prices never leave the computer.

It keeps the working style of the earlier *Universal TBE Studio* (client tabulation layout, several bidders
side by side, TQ register, document control) and adds rule-based checks, quotation evidence and issue
gates. Studio HTML files and snapshots can be opened directly.

## Workflow

1. **Open** a client TBE sheet (`.xlsx` / `.csv` with `NO | DESCRIPTION | SPECIFICATION | <bidder> | … | REMARKS`),
   a saved project (`.tbe.json`, exported `.html`), or an old Universal TBE Studio HTML (pick which presets to import).
   Or start a new electrical / telecom tabulation, or try the demo.
2. **Bidders & Scope**: add bidders, record quotation references, and limit each bidder to the sections
   it was asked to quote. Add each bidder's quotation PDF; the text is extracted in the browser.
3. **Tabulation Matrix**: click a bidder cell to enter what the vendor offered (type it, or search the
   quotation PDF and use a hit as the offer / attach it as page evidence). The **rule check** proposes a
   status with reasons; apply it, or set the status yourself. *Apply suggestions…* does this in bulk for
   Pending cells only.
4. **TQ Register**: every Clarify / Deviation / Exception (and optionally Not Quoted) line becomes a numbered
   TQ (`TQ-<BIDDER>-001`). The rule findings or standard wording give a draft query; edit it in the cell.
5. **Issue Check** lists what blocks issue (Pending lines), conflicts (marked compliant but the checks
   disagree), unverified evidence and missing sign-offs.
6. **Export Excel** (Cover, Summary, Tabulation, TQ_Register, Checks, Evidence, Run_Info), **Export HTML**
   (a copy of the app with the project inside, to share), or **Save** a `.tbe.json`. An exported workbook can be
   re-opened here; status / offer / comment / remark edits made in Excel are merged back.

## Statuses and counting

| Status | Meaning | Counted as |
|---|---|---|
| Pending | Not evaluated yet (the default; never counts as compliant) | Blocks issue |
| Confirm | Vendor confirmed the requirement | Compliant |
| Comply | Evaluator judged the offer compliant | Compliant |
| Clarify | Information missing or unclear | TQ |
| Deviation | Offer does not meet the requirement | TQ |
| Exception | Vendor takes exception | TQ |
| Not Quoted | In the bidder's scope but not offered | Gap (TQ by default) |
| Out of Scope | Section not in this bidder's scope | Excluded |
| N/A | Cancelled / by others in the BOQ | Excluded |

Compliance % = compliant ÷ **all in-scope lines**, so quoting less never scores higher. Bidders are only
ranked once no line is Pending, and a 0 % result is never marked as highest.

## What the rule check understands

Requirement text is parsed into typed parameters and compared with the vendor's offer text:

- **Electrical**: system voltage (`400/230V`, `690V & 400V`), insulation rating (`0.6/1 kV`), rated current,
  short-time withstand (`80kA/1s`, `Icw 65kA`), breaking / peak ratings, frequency, kW / kVA / kvar,
  conductor configuration (`3W+E`, `4W`, `3P4W`, `3Ph+N+E`), form of separation, conductor size (mm² / AWG),
  lengths, protocols (Modbus TCP/RTU, IEC 61850 …).
- **Telecom / security**: port count, rack units and 19" width, fibre count / type (OS1/OS2, OM1–OM5, SM/MM),
  cable category, PoE class, data rate, SPL / noise, autonomy (`2-hour battery backup`), resolution, frame rate,
  holding force, transmission distance.
- **Common**: IP (IEC 60529, including "IPx7/x8 does not imply IPx5/x6"), IK, NEMA, hazardous area
  (zone, gas group, temperature class, Ex protection), operating temperature ranges, dimensions, standards and
  listings (IEC, UL, EN, BS, TIA/EIA, IEEE, SAES …), quantities (`Qty: 6 Sets`).

Direction matters: `≥` for ratings, `=` for system voltage / frequency / conductors, ranges must be covered,
and an offered value more than 2× a minimum (configurable) is flagged for clarification (e.g. a 2000 kW soft
starter offered for a 560 kW motor). A parameter the offer does not state gives **Clarify** unless the vendor
explicitly confirmed that line. Test conditions (`@ 1 m`, `at 1 kHz`) and bracketed secondary values
(`Tappings - 6W, 3W`) are ignored.

The checks are a first pass, not a verdict. Anything that isn't a recognised parameter is left to the
engineer, and a status you set is never overwritten. If you mark a line compliant and the checks disagree,
it is flagged as a conflict.

## Data

- Autosave is in this browser's storage (per computer, per browser). It is a convenience; **files are the record**.
- Quotation PDFs are stored as extracted text with their SHA-256. Evidence is re-verified against the stored
  page text on every check.
- Scanned PDFs without a text layer cannot be searched (the tool reports how many pages have no text).

## Changes from Universal TBE Studio

- Unevaluated / empty / unrecognised cells are **Pending**, not Confirm, on import, on new bidders and new lines, and on screen.
- Compliance is measured against all in-scope lines, not only quoted ones.
- PDF import no longer maps every BOM line to some row at 0 % confidence. Quotation text is searched and the
  engineer attaches what applies.
- No truncation in exports (the Studio's Word export cut content to 100 rows / 150 / 50 characters).
- Project data lives in project files, not inside a copy of the app per project.
- Text is rendered through Preact (escaped). No `innerHTML` with vendor-supplied text.
- Bidder scope, cancelled / by-others lines, evidence, conflicts and issue gates are new.
- SheetJS 0.18.5 (known CVEs) is replaced by exceljs; pdf.js is v6.

## Development

```bash
npm install
npm test            # engine + import/export tests (vitest)
npm run typecheck
npm run build       # writes Universal_TBE_Workbench.html
```

`src/engine` holds the model, parser, comparisons, rules, scoring, checks and TQ generation. It has no DOM
dependency. `src/io` handles the client sheet, Studio and Excel import/export. `src/pdf` handles text
extraction and search. `src/ui` is the Preact UI. Tests against real project files run when
`TBE_REAL_DATA` (default `/home/user/botb/TBE`) exists; those files are not part of this repository.

Known gaps and next steps: an importer for the HEC MTO/BOQ workbook format, per-parameter overrides, a
comparison between TBE rounds / revisions, Word output, and an opt-in AI extraction of offer lines per page
(with the same evidence and verification rules).
