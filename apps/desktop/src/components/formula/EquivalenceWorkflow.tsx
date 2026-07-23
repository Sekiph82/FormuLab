/**
 * Declare (or revoke) a formula-version equivalence for laboratory/
 * stability evidence reuse — spec §1.3. `engine/approvalDerivation.ts`
 * already accepted `equivalentVersionIds`; this is the authorized-human
 * workflow that actually populates it, instead of leaving it engine-only.
 *
 * Nothing here assumes equivalence — the reviewer sees a real field-level
 * comparison (`compareVersions`, the same engine `VersionCompare` already
 * uses) before writing a justification, and the record is created only by
 * `engine/equivalence.ts`'s `declareEquivalence`, which refuses a
 * non-human actor.
 */
import { useState } from "react";
import { compareVersions } from "@ai4s/shared";
import type { EvidenceReuseScope, FormulaVersionEquivalence, FormulationVersion } from "@ai4s/shared";
import { EVIDENCE_REUSE_SCOPES } from "@ai4s/shared";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

export function EquivalenceWorkflow({
  versions,
  sourceVersion,
  activeEquivalences,
  findingCounts,
  onDeclare,
  onRevoke,
  t,
}: {
  versions: FormulationVersion[];
  sourceVersion: FormulationVersion;
  activeEquivalences: FormulaVersionEquivalence[];
  findingCounts: (version: FormulationVersion) => { compatibility: number; safety: number };
  onDeclare: (equivalentVersionId: string, scope: EvidenceReuseScope, justification: string) => Promise<void>;
  onRevoke: (eq: FormulaVersionEquivalence, reason: string) => Promise<void>;
  t: SimpleT;
}) {
  const candidates = versions.filter((v) => v.id !== sourceVersion.id);
  const [candidateId, setCandidateId] = useState(candidates[0]?.id ?? "");
  const candidate = candidates.find((v) => v.id === candidateId);
  const [scope, setScope] = useState<EvidenceReuseScope>("laboratory_and_stability");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comparison = candidate ? compareVersions(candidate, sourceVersion) : undefined;
  const sourceFindings = findingCounts(sourceVersion);
  const candidateFindings = candidate ? findingCounts(candidate) : undefined;

  const submit = async () => {
    if (!candidate || !justification.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onDeclare(candidate.id, scope, justification);
      setJustification("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {activeEquivalences.length > 0 && (
        <ul className="mb-3 space-y-1">
          {activeEquivalences.map((eq) => (
            <li key={eq.id} className="flex flex-wrap items-center gap-2 rounded-input border border-border-faint px-2 py-1 text-[11px]">
              <span className="text-text">{t("approval.equivalentTo", { id: eq.equivalentVersionId })}</span>
              <span className="rounded bg-surface-2 px-1 py-0.5 text-[10px] text-muted">{t(`approval.evidenceScope.${eq.evidenceReuseScope}`)}</span>
              <span className="text-[10px] text-muted">{eq.declaredBy}</span>
              <button
                onClick={() => {
                  const reason = window.prompt(t("approval.revokePromptReason"));
                  if (reason) void onRevoke(eq, reason);
                }}
                className="ml-auto text-[10px] text-error hover:underline"
              >
                {t("approval.revokeEquivalence")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">{t("approval.equivalenceCandidate")}</span>
          <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
            {candidates.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionLabel ?? `0.${v.versionNumber}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">{t("approval.evidenceReuseScope")}</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as EvidenceReuseScope)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
            {EVIDENCE_REUSE_SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`approval.evidenceScope.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {comparison && (
        <div className="mt-2 rounded-card border border-border p-2 text-[11px]">
          <p className="mb-1 font-medium text-muted">{t("approval.comparisonHeading")}</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            <span className="text-muted">{t("approval.comparisonLinesChanged", { count: comparison.lines.filter((l) => l.kind !== "unchanged").length })}</span>
            <span className="text-muted">{t("approval.comparisonActiveMatter", { delta: comparison.activeMatterDelta })}</span>
            <span className="text-muted">{t("approval.comparisonSkus", { added: comparison.skusAdded.length, removed: comparison.skusRemoved.length })}</span>
            {candidateFindings && (
              <>
                <span className="text-muted">
                  {t("approval.comparisonCompatibility", { candidate: candidateFindings.compatibility, source: sourceFindings.compatibility })}
                </span>
                <span className="text-muted">{t("approval.comparisonSafety", { candidate: candidateFindings.safety, source: sourceFindings.safety })}</span>
              </>
            )}
          </div>
          <p className="mt-1 text-[10px] text-muted">{t("approval.comparisonNoProcess")}</p>
        </div>
      )}

      <label className="mt-2 block">
        <span className="mb-1 block text-[10px] text-muted">{t("approval.justification")}</span>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
      </label>

      {error && <p className="mt-1 text-[10px] text-error">{error}</p>}

      <button
        onClick={() => void submit()}
        disabled={busy || !candidate || !justification.trim()}
        className="mt-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
      >
        {t("approval.declareEquivalence")}
      </button>
    </div>
  );
}
