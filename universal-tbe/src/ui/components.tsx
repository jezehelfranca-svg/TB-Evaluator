import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { STATUS_CLASS, STATUS_LABEL } from "../engine/status";
import type { Status } from "../engine/types";

export function StatusPill({ status, short }: { status: Status; short?: boolean }) {
  return <span class={`pill st-${STATUS_CLASS[status]}`}>{short ? status : STATUS_LABEL[status]}</span>;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        {footer && <div class="row-flex" style={{ marginTop: 14, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }) {
  return (
    <label class="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      {children}
    </label>
  );
}

/** Text input that commits on blur / Enter instead of on every keystroke. */
export function TextInput({ value, onCommit, placeholder, multiline, rows }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number }) {
  const commit = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (v !== value) onCommit(v);
  };
  // Uncontrolled (defaultValue + key) so unrelated re-renders never overwrite what is being typed.
  if (multiline)
    return <textarea key={value} class="input" rows={rows ?? 3} defaultValue={value} placeholder={placeholder} onBlur={commit} />;
  return (
    <input
      key={value}
      class="input"
      defaultValue={value}
      placeholder={placeholder}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function pct(n: number) {
  return `${Math.round(n)}%`;
}
