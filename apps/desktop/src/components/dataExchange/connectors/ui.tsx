import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/** Small shared visual primitives for the Connector Management screens —
 *  matching the existing Data Exchange Center's own card/table/badge
 *  conventions (`DataExchangePage.tsx`) rather than a new component
 *  library. */

export function Card({ title, actions, children }: { title?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="text-[13px] font-semibold text-text">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="flex flex-col items-center gap-2 py-8 text-center text-[12px] text-muted">{text}</div>;
}

export function Table({ headers, rows, onRowClick }: { headers: string[]; rows: { key: string; cells: React.ReactNode[] }[]; onRowClick?: (key: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-muted">
            {headers.map((h) => (
              <th key={h} className="px-1.5 py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} onClick={onRowClick ? () => onRowClick(row.key) : undefined} className={cn("border-t border-border-faint", onRowClick && "cursor-pointer hover:bg-surface-2")}>
              {row.cells.map((cell, j) => (
                <td key={j} className="px-1.5 py-1 text-text">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn" | "error"; children: React.ReactNode }) {
  const toneClass = tone === "ok" ? "bg-success/15 text-success" : tone === "warn" ? "bg-warning/15 text-warning" : tone === "error" ? "bg-error/15 text-error" : "bg-surface-2 text-muted";
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", toneClass)}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <span className="font-medium text-text">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const { t } = useTranslation("common");
  return (
    <div role="dialog" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className={cn("max-h-[85vh] w-full overflow-y-auto rounded-input border border-border bg-surface p-4", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-text">{title}</h2>
          {/* eslint-disable-next-line i18next/no-literal-string -- glyph icon, not natural-language text */}
          <button onClick={onClose} className="rounded-input px-2 py-1 text-[12px] text-muted hover:bg-surface-2" aria-label={t("actions.close")}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
