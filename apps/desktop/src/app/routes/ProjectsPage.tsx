import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FileCheck2, Plus } from "lucide-react";
import { buildKenyaCatalog, type Formulation, type RegulatoryDossier } from "@ai4s/shared";
import { appendAudit, auditEvent, listFormulations, saveFormulation } from "@/lib/formulations";
import { listRecords } from "@/lib/masterdata";
import { NewProjectDialog } from "@/components/formula/NewProjectDialog";

/**
 * The Projects workspace — every formulation project, independent of which
 * downstream module (Formulation/Laboratory/Stability/.../Approval) it's
 * being worked in. Extracted from the old FormulasPage.tsx, which used to
 * bundle the project list AND every downstream tab into one page — see
 * docs/INFORMATION_ARCHITECTURE.md.
 */
export function ProjectsPage() {
  const { t } = useTranslation("session");
  const navigate = useNavigate();
  const catalog = useMemo(() => buildKenyaCatalog(), []);
  const [projects, setProjects] = useState<Formulation[]>([]);
  const [creating, setCreating] = useState(false);
  // Compact status only — a count and a deep link, never a computed
  // readiness state (that belongs to the Dossiers workspace itself).
  const [dossierCountByProject, setDossierCountByProject] = useState<Map<string, number>>(new Map());

  const refresh = useCallback(async () => {
    const [all, dossiers] = await Promise.all([listFormulations(), listRecords("regulatory_dossiers")]);
    setProjects(all);
    const counts = new Map<string, number>();
    for (const d of dossiers as RegulatoryDossier[]) {
      if (d.status === "superseded" || d.status === "archived") continue;
      counts.set(d.formulationId, (counts.get(d.formulationId) ?? 0) + 1);
    }
    setDossierCountByProject(counts);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async (project: Formulation) => {
    await saveFormulation(project);
    await appendAudit(auditEvent(project.id, "project.created", { detail: project.name }));
    await refresh();
    setCreating(false);
    navigate(`/formulation?project=${project.id}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-[14px] font-medium text-text">{t("builder.projects")}</h1>
        <div className="flex-1" />
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
        >
          <Plus size={13} /> {t("builder.newProject")}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {projects.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13px] text-muted">{t("builder.noProjects")}</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center">
                <button
                  onClick={() => navigate(`/formulation?project=${p.id}`)}
                  className="flex flex-1 items-baseline gap-3 px-6 py-3 text-left hover:bg-surface-2"
                >
                  <span className="font-mono text-[11px] text-muted">{p.code}</span>
                  <span className="flex-1 text-[13px] text-text">{p.name}</span>
                  <span className="text-[11px] text-muted">{p.productFamilyCode}</span>
                  <span className="text-[11px] text-muted">{new Date(p.updatedAt).toLocaleDateString()}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/dossiers?project=${p.id}`);
                  }}
                  title={t("builder.projectDossiers")}
                  className="mr-4 flex items-center gap-1 rounded-input border border-border-faint px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2 hover:text-text"
                >
                  <FileCheck2 size={11} /> {t("builder.projectDossierCount", { n: dossierCountByProject.get(p.id) ?? 0 })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && <NewProjectDialog catalog={catalog} onCancel={() => setCreating(false)} onCreate={onCreate} />}
    </div>
  );
}
