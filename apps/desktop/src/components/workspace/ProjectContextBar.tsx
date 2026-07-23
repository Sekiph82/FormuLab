import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { Formulation, FormulationVersion } from "@ai4s/shared";
import { listFormulations } from "@/lib/formulations";

/**
 * Shared "which project (and which saved version) am I looking at" header
 * used by every project-bound workspace page (Laboratory/Stability/
 * Optimization/Regulatory/Approval). When no project is selected yet, shows
 * a picker instead of the panel below it — a workspace never guesses which
 * project the user means. See docs/NAVIGATION_AND_CONTEXT.md.
 */
export function ProjectPicker({ onPick }: { onPick: (id: string) => void }) {
  const { t } = useTranslation(["nav", "session"]);
  const [projects, setProjects] = useState<Formulation[] | null>(null);

  useEffect(() => {
    void listFormulations().then(setProjects);
  }, []);

  if (projects === null) return null;

  if (projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-center text-[13px] text-muted">
        {t("workspace.noProjectsYet")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <h2 className="mb-3 text-[13px] font-medium text-text">{t("workspace.pickProject")}</h2>
      <ul className="divide-y divide-border-faint rounded-card border border-border">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onPick(p.id)}
              className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-surface-2"
            >
              <span className="font-mono text-[11px] text-muted">{p.code}</span>
              <span className="flex-1 truncate text-[13px] text-text">{p.name}</span>
              <span className="text-[11px] text-muted">{p.productFamilyCode}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectContextBar({
  project,
  versions,
  versionId,
  onChangeVersion,
  onChangeProject,
  showVersionSelector = true,
}: {
  project: Formulation;
  versions: FormulationVersion[];
  versionId: string | null;
  onChangeVersion: (id: string | null) => void;
  onChangeProject: () => void;
  showVersionSelector?: boolean;
}) {
  const { t } = useTranslation(["nav", "session"]);
  return (
    <header className="print-hide flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
      <button onClick={onChangeProject} className="text-[12px] text-muted hover:text-text">
        ← {t("workspace.changeProject")}
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-[13px] font-medium text-text">{project.name}</h1>
        <p className="truncate text-[11px] text-muted">
          {project.code} · {project.productFamilyCode} · {project.targetMarkets.join(", ")}
        </p>
      </div>
      <div className="flex-1" />
      {showVersionSelector && versions.length > 0 && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          {t("workspace.versionLabel")}
          <select
            value={versionId ?? ""}
            onChange={(e) => onChangeVersion(e.target.value || null)}
            className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px] text-text"
          >
            <option value="">{t("workspace.currentDraft")}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionLabel ?? `0.${v.versionNumber}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <Link to={`/formulation?project=${project.id}`} className="text-[11px] text-accent hover:underline">
        {t("workspace.openInFormulation")}
      </Link>
    </header>
  );
}
