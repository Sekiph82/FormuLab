import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listSessions, readSession, type SessionSummary } from "@/lib/formulationV2";
import { downloadFormulationReport } from "@/lib/formulationReport";
import { evaluateGeneratedFormulaCompatibility, type GeneratedFormulaCompatibility } from "@/lib/generatedFormulaCompatibility";
import { evaluateGeneratedFormulaSafety, type GeneratedFormulaSafety } from "@/lib/generatedFormulaSafety";
import { evaluateGeneratedFormulaRegulatory, type GeneratedFormulaRegulatory } from "@/lib/generatedFormulaRegulatory";
import { useMasterCostData } from "@/hooks/useMasterCostData";
import { useCompatibilityRules } from "@/hooks/useCompatibilityRules";
import { useSafetyRules } from "@/hooks/useSafetyRules";
import { useRegulatoryRules } from "@/hooks/useRegulatoryRules";

const ROWS = [
  { key: "formula", titleKey: "reports.formula.title", descKey: "reports.formula.description", href: "/formulation" },
  { key: "trial", titleKey: "reports.trial.title", descKey: "reports.trial.description", href: "/laboratory" },
  { key: "stability", titleKey: "reports.stability.title", descKey: "reports.stability.description", href: "/stability" },
  { key: "regulatory", titleKey: "reports.regulatory.title", descKey: "reports.regulatory.description", href: "/regulatory" },
  { key: "dossier", titleKey: "reports.dossier.title", descKey: "reports.dossier.description", href: "/dossiers" },
  { key: "claimsReview", titleKey: "reports.claimsReview.title", descKey: "reports.claimsReview.description", href: "/claims-labels" },
  { key: "labelReadiness", titleKey: "reports.labelReadiness.title", descKey: "reports.labelReadiness.description", href: "/claims-labels" },
  { key: "formulaLabelConsistency", titleKey: "reports.formulaLabelConsistency.title", descKey: "reports.formulaLabelConsistency.description", href: "/claims-labels" },
  { key: "artworkReview", titleKey: "reports.artworkReview.title", descKey: "reports.artworkReview.description", href: "/claims-labels" },
  { key: "doeDesignSummary", titleKey: "reports.doeDesignSummary.title", descKey: "reports.doeDesignSummary.description", href: "/doe" },
  { key: "doeRunSheet", titleKey: "reports.doeRunSheet.title", descKey: "reports.doeRunSheet.description", href: "/doe" },
  { key: "doeResponseMatrix", titleKey: "reports.doeResponseMatrix.title", descKey: "reports.doeResponseMatrix.description", href: "/doe" },
  { key: "doeStatisticalAnalysis", titleKey: "reports.doeStatisticalAnalysis.title", descKey: "reports.doeStatisticalAnalysis.description", href: "/doe" },
  { key: "doeCandidateRanking", titleKey: "reports.doeCandidateRanking.title", descKey: "reports.doeCandidateRanking.description", href: "/doe" },
  { key: "dataExchangeImportHistory", titleKey: "reports.dataExchangeImportHistory.title", descKey: "reports.dataExchangeImportHistory.description", href: "/data-exchange" },
  { key: "dataExchangeSchemaCatalog", titleKey: "reports.dataExchangeSchemaCatalog.title", descKey: "reports.dataExchangeSchemaCatalog.description", href: "/data-exchange" },
  { key: "approval", titleKey: "reports.approval.title", descKey: "reports.approval.description", href: "/approval" },
  { key: "audit", titleKey: "reports.audit.title", descKey: "reports.audit.description", href: undefined },
] as const;

const FORMATS = ["pdf", "docx", "html"] as const;
type ReportFormat = (typeof FORMATS)[number];

/**
 * Formulation reports as PDF, DOCX or HTML for every saved New Request session. The report is
 * the same one the result screen downloads: per-version compatibility, safety and regulatory
 * results are computed here from the same Material Master and live rule sets, never left out.
 */
function FormulationReports() {
  const { t } = useTranslation("session");
  const cost = useMasterCostData();
  const compatibility = useCompatibilityRules();
  const safety = useSafetyRules();
  const regulatory = useRegulatoryRules();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const ready = !cost.loading && !compatibility.loading && !safety.loading && !regulatory.loading;

  useEffect(() => {
    let live = true;
    listSessions()
      .then((rows) => { if (live) setSessions([...rows].filter((row) => row.card_count > 0).sort((a, b) => b.created - a.created)); })
      .catch((cause) => { if (live) { setSessions([]); setError(cause instanceof Error ? cause.message : String(cause)); } });
    return () => { live = false; };
  }, []);

  const download = async (id: string, format: ReportFormat) => {
    setBusy(`${id}:${format}`);
    setError("");
    try {
      const session = await readSession(id);
      const compatibilityByVersion: Record<string, GeneratedFormulaCompatibility | undefined> = {};
      const safetyByVersion: Record<string, GeneratedFormulaSafety | undefined> = {};
      const regulatoryByVersion: Record<string, GeneratedFormulaRegulatory | undefined> = {};
      for (const card of session.cards) {
        if (!card.formula) continue;
        compatibilityByVersion[card.version] = evaluateGeneratedFormulaCompatibility(card.formula, cost.materials, compatibility.rules);
        safetyByVersion[card.version] = evaluateGeneratedFormulaSafety(card.formula, cost.materials, safety.rules);
        regulatoryByVersion[card.version] = evaluateGeneratedFormulaRegulatory(card.formula, cost.materials, regulatory.rules,
          { market: session.brief?.market, claims: session.brief?.claims });
      }
      await downloadFormulationReport(session, id, safetyByVersion, regulatoryByVersion, compatibilityByVersion, format);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-[14px] font-medium text-text">{t("reports.formulationReports.heading")}</h2>
      <p className="mb-3 text-[11px] text-muted">{t("reports.formulationReports.description")}</p>
      {error && <p role="alert" className="mb-2 text-[11px] text-warning">{error}</p>}
      {sessions === null ? (
        <p className="text-[11px] text-muted">{t("reports.formulationReports.loading")}</p>
      ) : sessions.length === 0 ? (
        <p className="text-[11px] text-muted">{t("reports.formulationReports.empty")}</p>
      ) : (
        <ul className="divide-y divide-border-faint rounded-card border border-border">
          {sessions.slice(0, 25).map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-text">{row.brief?.target || row.id}</div>
                <div className="text-[10.5px] text-muted">
                  {new Date(row.created * (row.created < 1e12 ? 1000 : 1)).toLocaleString()} · {t("reports.formulationReports.versions", { count: row.card_count })}
                </div>
              </div>
              {FORMATS.map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={!ready || busy !== ""}
                  onClick={() => void download(row.id, format)}
                  className="shrink-0 rounded-input border border-border px-2.5 py-1 text-[11px] uppercase text-accent hover:bg-surface-2 disabled:opacity-50"
                >
                  {busy === `${row.id}:${format}` ? "…" : format}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Reports workspace: formulation reports to download, and the module report views. */
export function ReportsPage() {
  const { t } = useTranslation("session");
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="mb-1 font-serif text-xl text-text">{t("reports.heading")}</h1>
      <p className="mb-4 text-[12px] text-muted">{t("reports.description")}</p>
      <FormulationReports />
      <h2 className="mb-2 text-[14px] font-medium text-text">{t("reports.modulesHeading")}</h2>
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
