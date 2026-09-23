import type { Derived } from "../derive";

export function Checks({ d, onOpen }: { d: Derived; onOpen: (rowId?: string, bidderId?: string) => void }) {
  const list = d.checks();
  const count = (s: string) => list.filter((i) => i.severity === s).length;
  return (
    <div class="panel">
      <h3>Issue readiness</h3>
      <p class="small muted">
        {count("blocker")} blocker(s), {count("warning")} warning(s), {count("info")} note(s). Blockers must be cleared before the TBE is issued; warnings need an engineer's decision.
      </p>
      {!list.length && <div class="empty">No issues found.</div>}
      {list.map((i) => (
        <div class="issue">
          <span class={`sev ${i.severity}`}>{i.severity}</span>
          <span class="grow">{i.message}</span>
          {(i.rowId || i.code === "pending") && (
            <button class="btn" onClick={() => onOpen(i.rowId, i.bidderId)}>
              {i.rowId ? "Open" : "Show"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
