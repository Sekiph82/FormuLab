import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Sparkles } from "lucide-react";
import {
  analyzeAnalyticalResults,
  generateCandidates,
  scoreReverseFormulaCandidate,
  type AnalyticalCompositionResult,
  type BenchmarkProduct,
  type Formulation,
  type GeneratedCandidate,
  type IngredientDeclarationLine,
  type IngredientMapping,
  type IngredientMappingResult,
  type RawMaterial,
  type ReverseConstraintSet,
  type ReverseFormulaCandidate,
  type ReverseFormulationStudy,
  type ScoringModelOutput,
  type TargetProductProfile,
} from "@formulab/shared";
import { cn } from "@/lib/cn";

/** Where the converted formula goes: a brand-new formulation, or a new
 *  version on an explicitly chosen existing one. Never decided silently —
 *  the user picks one via the target select. */
export type ConversionTarget = "new" | { formulationId: string };

export interface CreateFormulationParams {
  candidate: GeneratedCandidate;
  /** The already-saved candidate's own code — the traceability anchor. */
  candidateCode: string;
  target: ConversionTarget;
}

export interface CreateFormulationResult {
  formulationCode: string;
  versionLabel: string;
}

const SCORE_DIMENSIONS = ["evidence", "order", "analytical", "properties", "performance", "cost", "regulatory"] as const;

const DIMENSION_KEY = {
  evidence: "reverseFormulation.candidates.dimension.evidence",
  order: "reverseFormulation.candidates.dimension.order",
  analytical: "reverseFormulation.candidates.dimension.analytical",
  properties: "reverseFormulation.candidates.dimension.properties",
  performance: "reverseFormulation.candidates.dimension.performance",
  cost: "reverseFormulation.candidates.dimension.cost",
  regulatory: "reverseFormulation.candidates.dimension.regulatory",
} as const;

/** No constraint set is linked yet — an honest, empty, in-memory default
 *  (never persisted) so `generateCandidates` still has a well-formed
 *  `ReverseConstraintSet` to read, per its required parameter shape. */
function emptyConstraints(studyId: string): ReverseConstraintSet {
  return {
    id: "",
    code: "",
    name: "",
    studyId,
    requiredMaterials: [],
    preferredMaterials: [],
    excludedMaterials: [],
    requiredFunctions: [],
    minimumPercentages: {},
    maximumPercentages: {},
  };
}

/** Resolves the best (highest-confidence, non-rejected) mapping recorded
 *  for a declaration line, or an honest "not yet mapped" result — never a
 *  fabricated guess. */
function resolveMapping(line: IngredientDeclarationLine, mappings: IngredientMapping[], materials: RawMaterial[]): IngredientMappingResult {
  const candidates = mappings
    .filter((m) => m.declarationLineId === line.id && m.status !== "rejected")
    .slice()
    .sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  if (!best) {
    return { material: null, confidence: 0, reason: "unmapped", alternatives: [] };
  }
  const material = materials.find((m) => m.code === best.candidateMaterialId) ?? null;
  return { material, confidence: best.confidence, reason: best.evidence ?? best.mappingMethod, alternatives: [] };
}

/** Wraps an in-memory generated candidate in the persisted-record shape
 *  `scoreReverseFormulaCandidate` expects — a display-only adapter, not a
 *  saved record. */
function toScorableCandidate(generated: GeneratedCandidate, index: number, study: ReverseFormulationStudy): ReverseFormulaCandidate {
  return {
    id: `preview-${index}`,
    studyId: study.id,
    candidateCode: `${study.code || "STUDY"}-PREVIEW-${index + 1}`,
    name: `Candidate ${index + 1}`,
    revision: 0,
    generationMethod: "candidateGenerator",
    status: "generated",
    formulaLines: generated.formula.length > 0 ? (generated.formula as ReverseFormulaCandidate["formulaLines"]) : [{ materialId: "", percentage: 0 }],
    predictedProperties: generated.estimatedProperties,
    createdAt: new Date().toISOString(),
    createdBy: "local",
  };
}

export interface ScoredCandidate {
  candidate: GeneratedCandidate;
  score: ScoringModelOutput;
}

/** Undefined means the save was refused (e.g. an empty candidate) — the
 *  caller never fabricates a candidate id/code for that case. */
export type SavedCandidateInfo = { candidateId: string; candidateCode: string } | undefined;

export interface CandidateComparisonPanelProps {
  study: ReverseFormulationStudy;
  primaryProduct: BenchmarkProduct | null;
  declarationLines: IngredientDeclarationLine[];
  mappings: IngredientMapping[];
  analyticalResults: AnalyticalCompositionResult[];
  materials: RawMaterial[];
  target: TargetProductProfile | null;
  constraints: ReverseConstraintSet | null;
  onSaveCandidate: (result: ScoredCandidate) => Promise<SavedCandidateInfo>;
  /** Non-archived formulations the user may target for a new version — the
   *  brand-new-draft path is always offered alongside these. */
  existingFormulations: Formulation[];
  onCreateFormulation: (params: CreateFormulationParams) => Promise<CreateFormulationResult>;
}

/**
 * Generates and compares Reverse Formulation candidates using the real
 * shared engine (`generateCandidates`/`scoreReverseFormulaCandidate` from
 * `@formulab/shared`) — this component only assembles their inputs from already
 * -loaded records and renders their (unmodified) output. No candidate
 * generation, scoring, or validation logic is reimplemented here.
 */
export function CandidateComparisonPanel({
  study,
  primaryProduct,
  declarationLines,
  mappings,
  analyticalResults,
  materials,
  target,
  constraints,
  onSaveCandidate,
  existingFormulations,
  onCreateFormulation,
}: CandidateComparisonPanelProps) {
  const { t } = useTranslation("session");
  const [results, setResults] = useState<ScoredCandidate[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savedCandidates, setSavedCandidates] = useState<Map<number, { candidateId: string; candidateCode: string }>>(new Map());

  const canGenerate = Boolean(primaryProduct) && declarationLines.length > 0 && Boolean(target);

  const materialsByCode = useMemo(() => new Map(materials.map((m) => [m.code, m])), [materials]);

  const generate = () => {
    if (!primaryProduct || !target) return;
    setGenerating(true);
    setSelectedIndex(null);
    setSavedCandidates(new Map());
    try {
      const mappedIngredients = declarationLines
        .slice()
        .sort((a, b) => a.declaredOrder - b.declaredOrder)
        .map((line) => ({ line, mapping: resolveMapping(line, mappings, materials) }));
      const analysis = analyzeAnalyticalResults(analyticalResults);
      const effectiveConstraints = constraints ?? emptyConstraints(study.id);

      const generated = generateCandidates({
        mappedIngredients,
        analysis,
        target,
        constraints: effectiveConstraints,
        availableMaterials: materials,
      });

      const scored: ScoredCandidate[] = generated
        .map((candidate, index) => ({
          candidate,
          score: scoreReverseFormulaCandidate(toScorableCandidate(candidate, index, study), mappedIngredients, analysis, target, new Map()),
        }))
        // Deterministic given deterministic engine output — ranks the
        // already-computed scores, does not recompute them.
        .sort((a, b) => b.score.overallScore - a.score.overallScore);

      setResults(scored);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={generate}
          disabled={!canGenerate || generating}
          className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          <Sparkles size={13} />
          {generating ? t("reverseFormulation.candidates.generating") : t("reverseFormulation.candidates.generate")}
        </button>
        {!primaryProduct || declarationLines.length === 0 ? (
          <span className="text-[11px] text-warn">{t("reverseFormulation.candidates.noProduct")}</span>
        ) : !target ? (
          <span className="text-[11px] text-warn">{t("reverseFormulation.candidates.noTarget")}</span>
        ) : null}
      </div>

      {results === null ? (
        <p className="px-2 py-6 text-center text-[12px] text-muted">{t("reverseFormulation.candidates.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {results.map(({ candidate, score }, i) => (
            <CandidateCard
              key={i}
              index={i}
              candidate={candidate}
              score={score}
              materialsByCode={materialsByCode}
              selected={selectedIndex === i}
              savedInfo={savedCandidates.get(i)}
              saving={savingIndex === i}
              existingFormulations={existingFormulations}
              onSelect={() => setSelectedIndex(i)}
              onSave={async () => {
                setSavingIndex(i);
                try {
                  const saved = await onSaveCandidate({ candidate, score });
                  if (saved) setSavedCandidates((m) => new Map(m).set(i, saved));
                } finally {
                  setSavingIndex(null);
                }
              }}
              onCreateFormulation={onCreateFormulation}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  index,
  candidate,
  score,
  materialsByCode,
  selected,
  savedInfo,
  saving,
  existingFormulations,
  onSelect,
  onSave,
  onCreateFormulation,
}: {
  index: number;
  candidate: GeneratedCandidate;
  score: ScoringModelOutput;
  materialsByCode: Map<string, RawMaterial>;
  selected: boolean;
  savedInfo: { candidateId: string; candidateCode: string } | undefined;
  saving: boolean;
  existingFormulations: Formulation[];
  onSelect: () => void;
  onSave: () => void;
  onCreateFormulation: (params: CreateFormulationParams) => Promise<CreateFormulationResult>;
}) {
  const { t } = useTranslation("session");
  const [conversionTarget, setConversionTarget] = useState<string>("new");
  const [converting, setConverting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<CreateFormulationResult | null>(null);

  const saved = Boolean(savedInfo);
  const missingMaterials = candidate.formula.map((l) => l.materialId).filter((id) => !materialsByCode.has(id));
  const eligible = candidate.formula.length > 0 && missingMaterials.length === 0;

  const confirmCreate = async () => {
    if (!savedInfo || converting || createdResult) return;
    setConverting(true);
    setCreateError(null);
    try {
      const target: ConversionTarget = conversionTarget === "new" ? "new" : { formulationId: conversionTarget };
      const result = await onCreateFormulation({ candidate, candidateCode: savedInfo.candidateCode, target });
      setCreatedResult(result);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2.5 rounded-card border p-3", selected ? "border-accent bg-accent/5" : "border-border bg-surface")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-medium text-text">{t("reverseFormulation.candidates.cardTitle", { index: index + 1 })}</div>
          <div className="text-[11px] text-muted">
            <span>
              {t("reverseFormulation.candidates.overallScore")}: <span className="font-mono tabular-nums text-text">{score.overallScore.toFixed(2)}</span>
            </span>
            {" · "}
            <span>
              {t("reverseFormulation.candidates.evidenceConfidence")}: <span className="font-mono tabular-nums text-text">{score.evidenceConfidence.toFixed(2)}</span>
            </span>
          </div>
        </div>
        {selected && <CheckCircle2 size={15} className="shrink-0 text-accent" aria-hidden />}
      </div>

      {candidate.formula.length === 0 ? (
        <p className="text-[11px] text-warn">{t("reverseFormulation.candidates.noFormula")}</p>
      ) : (
        <table className="w-full text-[11px]">
          <tbody>
            {candidate.formula.map((line, li) => (
              <tr key={li} className="border-t border-border-faint first:border-t-0">
                <td className="py-0.5 pr-2 text-text">{materialsByCode.get(line.materialId)?.displayName ?? line.materialId}</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-muted">{line.percentage.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
        {SCORE_DIMENSIONS.map((dim) => {
          const evaluated = score.evaluatedDimensions.includes(dim);
          return (
            <div key={dim} className="flex items-center justify-between gap-1">
              <span className="text-muted">{t(DIMENSION_KEY[dim])}</span>
              <span className="flex items-center gap-1">
                <span className="font-mono tabular-nums text-text">{(score.scores[dim] ?? 0).toFixed(2)}</span>
                <span
                  className={cn(
                    "rounded px-1 py-0.5 text-[9px] uppercase tracking-wide",
                    evaluated ? "bg-ok/15 text-ok" : "bg-surface-2 text-muted",
                  )}
                >
                  {evaluated ? t("reverseFormulation.candidates.evaluated") : t("reverseFormulation.candidates.unevaluated")}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {candidate.notes.length > 0 && (
        <div className="rounded-input bg-surface-2 px-2 py-1.5 text-[10.5px] text-muted">
          <span className="font-medium text-text">{t("reverseFormulation.candidates.notes")}</span>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {candidate.notes.map((n, ni) => (
              <li key={ni}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={onSelect}
          className={cn(
            "flex-1 rounded-input border px-2 py-1 text-[11px]",
            selected ? "border-accent text-accent" : "border-border text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          {selected ? t("reverseFormulation.candidates.selected") : t("reverseFormulation.candidates.select")}
        </button>
        <button
          onClick={onSave}
          disabled={saving || saved || candidate.formula.length === 0}
          title={t("reverseFormulation.candidates.saveHint")}
          className="flex-1 rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {saved ? t("reverseFormulation.candidates.saved") : t("reverseFormulation.candidates.save")}
        </button>
      </div>

      {/* Conversion requires both an explicit selection and a saved
       *  (persisted) candidate — this is the only path that ever writes to
       *  `formulations`, and it is always a deliberate, distinct action
       *  from "Save as candidate record" above. */}
      {saved && selected && (
        <div className="border-t border-border-faint pt-2">
          {score.evidenceConfidence < 0.5 && (
            <p role="alert" className="mb-1.5 text-[10.5px] text-warn">
              {t("reverseFormulation.candidates.conversion.lowConfidenceWarning")}
            </p>
          )}
          <p className="mb-1.5 text-[10px] text-muted">{t("reverseFormulation.candidates.conversion.decisionSupportNotice")}</p>
          {!eligible ? (
            <p role="alert" className="text-[11px] text-error">
              {t("reverseFormulation.candidates.conversion.missingMaterials", { codes: missingMaterials.join(", ") })}
            </p>
          ) : createdResult ? (
            <p className="text-[11px] text-ok">
              {t("reverseFormulation.candidates.conversion.success", { code: createdResult.formulationCode, version: createdResult.versionLabel })}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={conversionTarget}
                onChange={(e) => setConversionTarget(e.target.value)}
                aria-label={t("reverseFormulation.candidates.conversion.targetLabel")}
                className="rounded-input border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text"
              >
                <option value="new">{t("reverseFormulation.candidates.conversion.newFormulationOption")}</option>
                {existingFormulations.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} — {f.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void confirmCreate()}
                disabled={converting}
                className="rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {converting
                  ? t("reverseFormulation.candidates.conversion.creating")
                  : conversionTarget === "new"
                    ? t("reverseFormulation.candidates.conversion.createDraft")
                    : t("reverseFormulation.candidates.conversion.createVersion")}
              </button>
            </div>
          )}
          {createError && (
            <p role="alert" className="mt-1 text-[11px] text-error">
              {createError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
