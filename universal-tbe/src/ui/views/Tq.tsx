import { useState } from "preact/hooks";
import type { Project } from "../../engine/types";
import { StatusPill } from "../components";
import type { Derived } from "../derive";
import { baseName, download } from "../files";
import { toast } from "../store";

const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();
const csv = (s: string) => `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

export function Tq({ project: p, d, onOpen }: { project: Project; d: Derived; onOpen: (rowId: string, bidderId: string) => void }) {
  const [bidder, setBidder] = useState("");
  const all = d.tq();
  const list = bidder ? all.filter((t) => t.bidderId === bidder) : all;
  const header = ["TQ No.", "Bidder", "Item No.", "Section", "Description", "Requirement", "Status", "Vendor offer", "Query", "Vendor reply", "Evidence"];
  const rows = list.map((t) => [t.tqNo, t.bidder, t.itemNo, t.section, t.description, t.requirement, t.status, t.offered, t.query, t.reply, t.evidence]);

  const copy = async () => {
    const tsv = [header, ...rows].map((r) => r.map(clean).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      toast(`Copied ${rows.length} TQ(s) as tab-separated text.`);
    } catch {
      toast("Clipboard is not available in this browser; use Download CSV.", "warn");
    }
  };

  return (
    <div>
      <div class="toolbar">
        <select class="select" value={bidder} onChange={(e) => setBidder((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">All bidders ({all.length})</option>
          {p.bidders.map((b) => (
            <option value={b.id}>
              {b.short || b.name} ({all.filter((t) => t.bidderId === b.id).length})
            </option>
          ))}
        </select>
        <button class="btn" onClick={copy} disabled={!rows.length}>Copy (paste into Excel / email)</button>
        <button class="btn" disabled={!rows.length} onClick={() => download(`${baseName(p)}_TQ_Register.csv`, "﻿" + [header, ...rows].map((r) => r.map(csv).join(",")).join("\r\n"), "text/csv")}>
          Download CSV
        </button>
        <span class="small muted">The TQ register is also a sheet in the Excel export.</span>
      </div>
      {!list.length ? (
        <div class="panel empty">No open technical queries.</div>
      ) : (
        <div class="panel" style={{ padding: 0, overflow: "auto" }}>
          <table class="simple">
            <thead>
              <tr>
                <th>TQ No.</th>
                <th>Bidder</th>
                <th>Item</th>
                <th>Requirement</th>
                <th>Status</th>
                <th>Vendor offer</th>
                <th>Query</th>
                <th>Reply</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr style={{ cursor: "pointer" }} onClick={() => onOpen(t.rowId, t.bidderId)}>
                  <td style={{ whiteSpace: "nowrap" }}><b>{t.tqNo}</b></td>
                  <td>{t.bidder}</td>
                  <td>{t.itemNo}</td>
                  <td style={{ maxWidth: 320 }}>{t.requirement}</td>
                  <td><StatusPill status={t.status} short /></td>
                  <td style={{ maxWidth: 240 }}>{t.offered}</td>
                  <td style={{ maxWidth: 340 }}>{t.query}</td>
                  <td style={{ maxWidth: 220 }}>{t.reply}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
