import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const ROWS = [
  { key: "formula", titleKey: "reports.formula.title", descKey: "reports.formula.description", href: "/formulation" },
  { key: "trial", titleKey: "reports.trial.title", descKey: "reports.trial.description", href: "/laboratory" },
  { key: "stability", titleKey: "reports.stability.title", descKey: "reports.stability.description", href: "/stability" },
  { key: "regulatory", titleKey: "reports.regulatory.title", descKey: "reports.regulatory.description", href: "/regulatory" },
  { key: "dossier", titleKey: "reports.dossier.title", descKey: "reports.dossier.description", href: "/dossiers" },
  { key: "approval", titleKey: "reports.approval.title", descKey: "reports.approval.description", href: "/approval" },
  { key: "audit", titleKey: "reports.audit.title", descKey: "reports.audit.description", href: undefined },
] as const;

/**
 * The Reports workspace — a navigation shell over the export capabilities
 * that already exist (JSON export per formula version/trial/stability
 * study, CSV/Excel regulatory rule export). The full Phase 7 PDF/DOCX
 * report engine is explicitly out of scope for this task and is marked as
 * not yet implemented, never presented as available. See
 * docs/WORKSPACES.md.
 */
export function ReportsPage() {
  const { t } = useTranslation("session");
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="mb-1 font-serif text-xl text-text">{t("reports.heading")}</h1>
      <p className="mb-4 text-[12px] text-muted">{t("reports.description")}</p>
      <ul className="divide-y divide-border-faint rounded-card border border-border">
        {ROWS.map((row) => (
          <li key={row.key} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-text">{t(row.titleKey)}</div>
              <div className="text-[11px] text-muted">{t(row.descKey)}</div>
            </div>
            {row.href ? (
              <Link to={row.href} className="shrink-0 rounded-input border border-border px-2.5 py-1 text-[11px] text-accent hover:bg-surface-2">
                {t("reports.openAction")}
              </Link>
            ) : (
              <span className="shrink-0 rounded bg-surface-2 px-2 py-0.5 text-[10px] text-muted">{t("reports.notYetImplemented")}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] text-muted">{t("reports.futureExportNote")}</p>
    </div>
  );
}
