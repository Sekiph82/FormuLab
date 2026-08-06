/**
 * Deterministic DOE design generation.
 *
 * Every generator here is a pure function of its inputs (factors,
 * constraints, settings, seed) — the same inputs always produce the same
 * design and the same randomized run order. `DOE_IMPLEMENTED_DESIGN_TYPES`
 * (schemas/doe.ts) lists exactly which `DoeDesignType`s `generateDoeDesign`
 * actually implements; every other enum value is refused with an explicit
 * "not implemented" error rather than silently producing a fake design.
 *
 * Coded units: every continuous/integer/mixture/process factor is generated
 * in coded units first (-1/0/+1, or ±alpha for axial points), then mapped
 * to its real engineering-unit `actualValue` via linear interpolation
 * between `lowValue`/`centerValue`/`highValue`. A categorical/ordinal
 * factor's coded value IS its level string — there is no numeric coding
 * for a level that has no natural order/scale.
 */
import {
  DOE_IMPLEMENTED_DESIGN_TYPES,
  DOE_STUDY_IMMUTABLE_STATUSES,
  doeDesignSchema,
  doeRunSchema,
  doeStudySchema,
  type DoeConstraint,
  type DoeDesign,
  type DoeDesignDiagnostics,
  type DoeDesignGenerationSettings,
  type DoeDesignType,
  type DoeFactor,
  type DoeFactorSetting,
  type DoeResponse,
  type DoeRun,
  type DoeStudy,
  type DoeStudyStatus,
} from "../schemas/doe";
import { evaluateDoeExpression, validateDoeExpressionSyntax } from "./doeExpression";
import { conditionNumber } from "./doeMath";
import { requireHumanActor } from "./regulatoryAuthorization";
import type { Actor } from "../schemas/status";

/** Ids are opaque and stable; time plus randomness is enough for a local app
 *  (matches `engine/versioning.ts`'s `newId` exactly — duplicated rather than
 *  imported so this module has no dependency on the formulation-versioning
 *  module, which is otherwise unrelated to DOE). */
export function newDoeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32. A small, fast, well-known generator: the same
// integer seed always produces the same sequence, which is the whole point
// (spec §6: "deterministic seed support… reproducible randomization").
// ---------------------------------------------------------------------------

export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle, using a seeded RNG so the result is reproducible. */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Study lifecycle
// ---------------------------------------------------------------------------

export interface CreateDoeStudyInput {
  studyCode: string;
  title: string;
  description?: string;
  projectId: string;
  formulationId: string;
  baselineFormulaVersionId: string;
  /** The baseline version's own `status` — passed in rather than re-deriving
   *  `effectiveStatus` here, since that requires the audit log and this
   *  module has no persistence dependency. A working draft has no saved
   *  version id at all, so callers pass the real saved version's status. */
  baselineFormulaVersionStatus: string;
  designType: DoeDesignType;
  randomizationEnabled?: boolean;
  blockingEnabled?: boolean;
  replicatePolicy?: DoeStudy["replicatePolicy"];
  centerPointPolicy?: DoeStudy["centerPointPolicy"];
}

/** Creates a new draft study bound to an exact saved formula version. Spec
 *  §5.1: "working drafts cannot be a DOE baseline" — enforced here, not just
 *  documented, by refusing a `baselineFormulaVersionStatus` that a working
 *  draft could never have reached (a draft has no `status` field at all in
 *  `FormulationDraft`; this check exists for the case a caller mistakenly
 *  passes a draft's derived/placeholder status through anyway). */
export function createDoeStudy(input: CreateDoeStudyInput, actor: Actor): DoeStudy {
  requireHumanActor(actor, "create a DOE study");
  if (!input.baselineFormulaVersionId.trim()) {
    throw new Error("A DOE study must be bound to a saved formula version id.");
  }
  if (!input.baselineFormulaVersionStatus || input.baselineFormulaVersionStatus === "draft") {
    throw new Error("A DOE study cannot use a working draft as its baseline — save the formula version first.");
  }
  const now = new Date().toISOString();
  const study: DoeStudy = doeStudySchema.parse({
    schemaVersion: "1.0",
    id: newDoeId("doestudy"),
    studyCode: input.studyCode,
    title: input.title,
    description: input.description,
    projectId: input.projectId,
    formulationId: input.formulationId,
    baselineFormulaVersionId: input.baselineFormulaVersionId,
    status: "draft",
    designType: input.designType,
    randomizationEnabled: input.randomizationEnabled ?? true,
    blockingEnabled: input.blockingEnabled ?? false,
    replicatePolicy: input.replicatePolicy ?? "none",
    centerPointPolicy: input.centerPointPolicy ?? "none",
    revision: 1,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  return study;
}

/** Revises a study: a new revision number, `supersedesStudyId` pointing at
 *  the original. Refused once the original has reached an immutable status
 *  (spec §5.1: "analyzed and completed revisions are immutable… a new
 *  study revision" is the only way forward from there). */
export function reviseDoeStudy(original: DoeStudy, changes: Partial<CreateDoeStudyInput>, actor: Actor): DoeStudy {
  requireHumanActor(actor, "revise a DOE study");
  const now = new Date().toISOString();
  const revised: DoeStudy = doeStudySchema.parse({
    ...original,
    id: newDoeId("doestudy"),
    ...changes,
    status: "draft",
    revision: original.revision + 1,
    updatedBy: actor.userId,
    updatedAt: now,
    startedAt: undefined,
    completedAt: undefined,
    supersedesStudyId: original.id,
  });
  return revised;
}

export function isDoeStudyImmutable(status: DoeStudyStatus): boolean {
  return DOE_STUDY_IMMUTABLE_STATUSES.includes(status);
}

const DOE_STUDY_ALLOWED_NEXT: Record<DoeStudyStatus, readonly DoeStudyStatus[]> = {
  draft: ["design_ready", "cancelled"],
  design_ready: ["runs_generated", "draft", "cancelled"],
  runs_generated: ["in_progress", "cancelled"],
  in_progress: ["data_complete", "cancelled"],
  data_complete: ["analysis_ready", "in_progress", "cancelled"],
  analysis_ready: ["analyzed", "cancelled"],
  analyzed: ["candidate_selected", "superseded", "archived"],
  candidate_selected: ["completed", "superseded", "archived"],
  completed: ["archived"],
  cancelled: ["archived"],
  superseded: ["archived"],
  archived: [],
};

export function canTransitionDoeStudyStatus(from: DoeStudyStatus, to: DoeStudyStatus): boolean {
  return DOE_STUDY_ALLOWED_NEXT[from]?.includes(to) ?? false;
}

/** Derives the honest status a study should show given what actually
 *  exists — never assumed, always recomputed from real counts. A caller
 *  (the desktop workspace) uses this to keep `DoeStudy.status` in sync as
 *  runs/observations/analyses are added, rather than requiring a human to
 *  remember to flip a dropdown. */
export function deriveDoeStudyStatus(input: {
  currentStatus: DoeStudyStatus;
  hasDesign: boolean;
  runCount: number;
  completedRunCount: number;
  totalObservationSlots: number;
  recordedObservationCount: number;
  hasAnalysis: boolean;
  hasSelectedCandidate: boolean;
}): DoeStudyStatus {
  if (isDoeStudyImmutable(input.currentStatus)) return input.currentStatus;
  if (input.hasSelectedCandidate) return "candidate_selected";
  if (input.hasAnalysis) return "analyzed";
  if (input.totalObservationSlots > 0 && input.recordedObservationCount >= input.totalObservationSlots) return "analysis_ready";
  if (input.recordedObservationCount > 0) return "data_complete" === input.currentStatus ? input.currentStatus : "in_progress";
  if (input.completedRunCount > 0) return "in_progress";
  if (input.runCount > 0) return "runs_generated";
  if (input.hasDesign) return "design_ready";
  return "draft";
}

/** Walks `supersedesStudyId` backwards to return the full revision chain,
 *  oldest first — the same convention `resolveEvidenceRevisionChain`
 *  (Phase 3) and label/artwork supersession chains already use. */
export function resolveDoeRevisionChain(study: DoeStudy, allStudies: readonly DoeStudy[]): DoeStudy[] {
  const chain: DoeStudy[] = [study];
  let current = study;
  const byId = new Map(allStudies.map((s) => [s.id, s]));
  const seen = new Set([study.id]);
  while (current.supersedesStudyId) {
    const parent = byId.get(current.supersedesStudyId);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent);
    seen.add(parent.id);
    current = parent;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Factors, constraints, responses — validation only (persistence-agnostic
// records themselves are just `doeFactorSchema.parse(...)` at the call site).
// ---------------------------------------------------------------------------

export interface DoeValidationIssue {
  field: string;
  message: string;
}

export function validateDoeFactors(factors: readonly DoeFactor[]): DoeValidationIssue[] {
  const issues: DoeValidationIssue[] = [];
  if (factors.length === 0) {
    issues.push({ field: "factors", message: "At least one factor is required." });
    return issues;
  }
  const codes = new Set<string>();
  for (const f of factors) {
    if (codes.has(f.factorCode)) issues.push({ field: f.factorCode, message: `Duplicate factor code "${f.factorCode}".` });
    codes.add(f.factorCode);

    if (f.factorType === "categorical" || f.factorType === "ordinal") {
      if (f.categoricalLevels.length < 2) issues.push({ field: f.factorCode, message: `Factor "${f.factorCode}" needs at least 2 categorical levels.` });
    } else {
      if (f.lowValue === undefined || f.highValue === undefined) {
        issues.push({ field: f.factorCode, message: `Factor "${f.factorCode}" needs a low and high value.` });
      } else if (Number(f.lowValue) >= Number(f.highValue)) {
        issues.push({ field: f.factorCode, message: `Factor "${f.factorCode}"'s low value must be less than its high value.` });
      }
    }
    if (!f.sourceEntityId && f.sourceType !== "custom") {
      issues.push({ field: f.factorCode, message: `Factor "${f.factorCode}" must reference a source entity (material id, or a named process parameter) — a factor can never silently apply to "whatever is in the formula".` });
    }
  }
  const mixtureFactors = factors.filter((f) => f.isMixtureComponent);
  if (mixtureFactors.length === 1) {
    issues.push({ field: "mixture", message: "A mixture design needs at least 2 mixture-component factors." });
  }
  return issues;
}

export function validateDoeConstraints(constraints: readonly DoeConstraint[], factors: readonly DoeFactor[]): DoeValidationIssue[] {
  const issues: DoeValidationIssue[] = [];
  const factorCodes = factors.map((f) => f.factorCode);
  for (const c of constraints) {
    const syntax = validateDoeExpressionSyntax(c.expression, factorCodes);
    if (!syntax.valid) issues.push({ field: c.id, message: `Constraint "${c.expression}": ${syntax.error}` });
  }
  return issues;
}

export function validateDoeResponses(responses: readonly DoeResponse[]): DoeValidationIssue[] {
  const issues: DoeValidationIssue[] = [];
  if (responses.length === 0) issues.push({ field: "responses", message: "At least one response is required." });
  const codes = new Set<string>();
  for (const r of responses) {
    if (codes.has(r.responseCode)) issues.push({ field: r.responseCode, message: `Duplicate response code "${r.responseCode}".` });
    codes.add(r.responseCode);
    if (r.objective === "target" && r.targetValue === undefined) issues.push({ field: r.responseCode, message: `Response "${r.responseCode}" has objective "target" but no target value.` });
    if (r.objective === "within_range" && (r.lowerLimit === undefined || r.upperLimit === undefined)) {
      issues.push({ field: r.responseCode, message: `Response "${r.responseCode}" has objective "within_range" but is missing a lower or upper limit.` });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Factor level resolution — coded <-> actual mapping shared by every generator.
// ---------------------------------------------------------------------------

interface FactorLevel {
  coded: string;
  actual: string;
}

function round(value: number, precision: number): string {
  const factor = Math.pow(10, precision);
  return (Math.round(value * factor) / factor).toString();
}

export function continuousActualFromCoded(factor: DoeFactor, coded: number): string {
  const low = Number(factor.lowValue ?? "0");
  const high = Number(factor.highValue ?? "1");
  const center = factor.centerValue !== undefined ? Number(factor.centerValue) : (low + high) / 2;
  // coded in [-1, +1] maps linearly onto [low, high]; coded 0 maps to center;
  // a coded magnitude beyond 1 (axial/alpha points) extrapolates the same line.
  const half = (high - low) / 2;
  const actual = center + coded * half;
  return round(actual, factor.precision);
}

/** The two extreme (coded -1 / +1) levels for a continuous-ish factor, or
 *  the full set of levels for a categorical/ordinal factor. */
function twoLevels(factor: DoeFactor): FactorLevel[] {
  if (factor.factorType === "categorical" || factor.factorType === "ordinal") {
    return factor.categoricalLevels.map((level) => ({ coded: level, actual: level }));
  }
  return [
    { coded: "-1", actual: continuousActualFromCoded(factor, -1) },
    { coded: "+1", actual: continuousActualFromCoded(factor, 1) },
  ];
}

function axialLevel(factor: DoeFactor, sign: 1 | -1, alpha: number): FactorLevel {
  return { coded: (sign * alpha).toString(), actual: continuousActualFromCoded(factor, sign * alpha) };
}

// ---------------------------------------------------------------------------
// Run assembly — shared by every generator: turns a list of per-factor coded
// points into DoeRun-shaped rows (without ids/order — `finalizeDesignRuns`
// assigns standard order, randomization, ids).
// ---------------------------------------------------------------------------

interface RawRunPoint {
  settings: DoeFactorSetting[];
  isCenterPoint: boolean;
}

function cartesianProduct(levelSets: FactorLevel[][]): FactorLevel[][] {
  return levelSets.reduce<FactorLevel[][]>((acc, levels) => acc.flatMap((combo) => levels.map((level) => [...combo, level])), [[]]);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

export function generateFullFactorialDesign(factors: readonly DoeFactor[]): RawRunPoint[] {
  const nonMixture = factors.filter((f) => !f.isMixtureComponent);
  const levelSets = nonMixture.map((f) => twoLevels(f));
  const combos = cartesianProduct(levelSets);
  return combos.map((combo) => ({
    settings: combo.map((level, i) => ({ factorCode: nonMixture[i].factorCode, codedValue: level.coded, actualValue: level.actual })),
    isCenterPoint: false,
  }));
}

/** Semantically identical generator to full factorial for the (typical)
 *  case where every factor is continuous/integer/categorical with exactly
 *  2 levels — kept as its own named entry point per the spec's design-type
 *  list, since a caller/UI benefits from the explicit distinction even
 *  though the underlying construction is the same "every combination of
 *  2 levels per factor". */
export function generateTwoLevelFactorialDesign(factors: readonly DoeFactor[]): RawRunPoint[] {
  return generateFullFactorialDesign(factors);
}

/** A 2^(k-1) half-fraction (Resolution IV, generator = product of every
 *  base factor's sign) — the single most commonly used fractional design.
 *  Quarter-fractions and higher (`fractionDenominator > 2`) are not yet
 *  implemented and are refused explicitly rather than faked. */
export function generateFractionalFactorialDesign(factors: readonly DoeFactor[], settings: DoeDesignGenerationSettings): RawRunPoint[] {
  const denom = settings.fractionDenominator ?? 2;
  if (denom !== 2) {
    throw new Error(`Fractional factorial designs with fractionDenominator=${denom} are not implemented — only a 2^(k-1) half-fraction (fractionDenominator=2) is currently supported.`);
  }
  const nonMixture = factors.filter((f) => !f.isMixtureComponent);
  if (nonMixture.length < 3) throw new Error("A fractional factorial half-fraction needs at least 3 factors.");
  const baseFactors = nonMixture.slice(0, -1);
  const derivedFactor = nonMixture[nonMixture.length - 1];
  const baseLevelSets = baseFactors.map((f) => twoLevels(f));
  const baseCombos = cartesianProduct(baseLevelSets);
  return baseCombos.map((combo) => {
    const signProduct = combo.reduce((prod, level) => prod * (Number(level.coded) >= 0 ? 1 : -1), 1);
    const derivedLevel: FactorLevel = { coded: signProduct.toString(), actual: continuousActualFromCoded(derivedFactor, signProduct) };
    const settingsRow = [
      ...combo.map((level, i) => ({ factorCode: baseFactors[i].factorCode, codedValue: level.coded, actualValue: level.actual })),
      { factorCode: derivedFactor.factorCode, codedValue: derivedLevel.coded, actualValue: derivedLevel.actual },
    ];
    return { settings: settingsRow, isCenterPoint: false };
  });
}

/** Classic published Plackett-Burman generator rows (N runs, N-1 columns).
 *  Constructed by cyclically shifting the generator row N-2 times, then
 *  appending a final row of all -1. Supports the two most common screening
 *  sizes; larger PB designs (N=16, 20, 24…) are not yet implemented. */
const PLACKETT_BURMAN_GENERATORS: Record<number, number[]> = {
  8: [1, 1, 1, -1, 1, -1, -1],
  12: [1, 1, -1, 1, 1, 1, -1, -1, -1, 1, -1],
};

export function generatePlackettBurmanDesign(factors: readonly DoeFactor[]): RawRunPoint[] {
  const nonMixture = factors.filter((f) => !f.isMixtureComponent);
  const k = nonMixture.length;
  const runSize = [8, 12].find((n) => n - 1 >= k);
  if (!runSize) {
    throw new Error(`Plackett-Burman designs for ${k} factors are not implemented — only run sizes 8 (up to 7 factors) and 12 (up to 11 factors) are currently supported.`);
  }
  const generator = PLACKETT_BURMAN_GENERATORS[runSize];
  const cols = generator.length;
  const rows: number[][] = [];
  for (let shift = 0; shift < cols; shift++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(generator[(c + shift) % cols]);
    rows.push(row);
  }
  rows.push(new Array(cols).fill(-1));
  return rows.map((row) => ({
    settings: nonMixture.map((f, i) => {
      const sign = row[i] as 1 | -1;
      return { factorCode: f.factorCode, codedValue: sign.toString(), actualValue: continuousActualFromCoded(f, sign) };
    }),
    isCenterPoint: false,
  }));
}

export function generateCentralCompositeDesign(factors: readonly DoeFactor[], settings: DoeDesignGenerationSettings, centerPointCount: number): RawRunPoint[] {
  const nonMixture = factors.filter((f) => !f.isMixtureComponent);
  const k = nonMixture.length;
  if (k < 2) throw new Error("A central composite design needs at least 2 factors.");
  const factorialRuns = generateFullFactorialDesign(nonMixture);
  const alpha = settings.alphaValue !== undefined ? Number(settings.alphaValue) : Math.pow(factorialRuns.length, 0.25);
  const axialRuns: RawRunPoint[] = [];
  for (const f of nonMixture) {
    for (const sign of [1, -1] as const) {
      const level = axialLevel(f, sign, alpha);
      axialRuns.push({
        settings: nonMixture.map((other) => (other.factorCode === f.factorCode ? { factorCode: f.factorCode, codedValue: level.coded, actualValue: level.actual } : { factorCode: other.factorCode, codedValue: "0", actualValue: continuousActualFromCoded(other, 0) })),
        isCenterPoint: false,
      });
    }
  }
  const centerRuns: RawRunPoint[] = Array.from({ length: Math.max(centerPointCount, 1) }, () => ({
    settings: nonMixture.map((f) => ({ factorCode: f.factorCode, codedValue: "0", actualValue: continuousActualFromCoded(f, 0) })),
    isCenterPoint: true,
  }));
  return [...factorialRuns, ...axialRuns, ...centerRuns];
}

/** General k-factor Box-Behnken construction: for every unordered pair of
 *  factors, all 4 sign combinations of that pair with every other factor
 *  held at its center — the standard construction, valid for any k >= 3
 *  (not restricted to the small published tables for k=3/4/5, though those
 *  happen to be a special, more run-efficient case of the same family for
 *  some k). */
export function generateBoxBehnkenDesign(factors: readonly DoeFactor[], centerPointCount: number): RawRunPoint[] {
  const nonMixture = factors.filter((f) => !f.isMixtureComponent);
  const k = nonMixture.length;
  if (k < 3) throw new Error("A Box-Behnken design needs at least 3 factors.");
  const runs: RawRunPoint[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      for (const si of [1, -1] as const) {
        for (const sj of [1, -1] as const) {
          const settings = nonMixture.map((f, idx) => {
            if (idx === i) return { factorCode: f.factorCode, codedValue: si.toString(), actualValue: continuousActualFromCoded(f, si) };
            if (idx === j) return { factorCode: f.factorCode, codedValue: sj.toString(), actualValue: continuousActualFromCoded(f, sj) };
            return { factorCode: f.factorCode, codedValue: "0", actualValue: continuousActualFromCoded(f, 0) };
          });
          runs.push({ settings, isCenterPoint: false });
        }
      }
    }
  }
  const centerRuns: RawRunPoint[] = Array.from({ length: Math.max(centerPointCount, 1) }, () => ({
    settings: nonMixture.map((f) => ({ factorCode: f.factorCode, codedValue: "0", actualValue: continuousActualFromCoded(f, 0) })),
    isCenterPoint: true,
  }));
  return [...runs, ...centerRuns];
}

export function generateLatinHypercubeDesign(factors: readonly DoeFactor[], sampleCount: number, seed: number): RawRunPoint[] {
  const nonMixture = factors.filter((f) => !f.isMixtureComponent);
  if (nonMixture.length === 0) throw new Error("A Latin hypercube design needs at least 1 factor.");
  const n = Math.max(sampleCount, nonMixture.length + 1);
  const rng = createSeededRandom(seed);
  const perFactorPermutations = nonMixture.map(() => seededShuffle(Array.from({ length: n }, (_, i) => i), rng));
  const runs: RawRunPoint[] = [];
  for (let row = 0; row < n; row++) {
    const settings = nonMixture.map((f, fi) => {
      if (f.factorType === "categorical" || f.factorType === "ordinal") {
        const idx = Math.floor(rng() * f.categoricalLevels.length);
        const level = f.categoricalLevels[idx];
        return { factorCode: f.factorCode, codedValue: level, actualValue: level };
      }
      const stratum = perFactorPermutations[fi][row];
      const coded = -1 + (2 * (stratum + rng())) / n; // maps stratum -> coded in (-1, +1)
      return { factorCode: f.factorCode, codedValue: coded.toFixed(4), actualValue: continuousActualFromCoded(f, coded) };
    });
    runs.push({ settings, isCenterPoint: false });
  }
  return runs;
}

/** {q, m} simplex-lattice mixture design: every composition of `m` into
 *  `q` non-negative integer parts, each part i representing component
 *  value i/m — guarantees every generated point sums to exactly 1. */
export function generateMixtureSimplexLatticeDesign(factors: readonly DoeFactor[], degree: number): RawRunPoint[] {
  const mixtureFactors = factors.filter((f) => f.isMixtureComponent);
  if (mixtureFactors.length < 2) throw new Error("A simplex-lattice mixture design needs at least 2 mixture-component factors.");
  const q = mixtureFactors.length;
  const compositions: number[][] = [];
  const build = (remaining: number, slotsLeft: number, current: number[]): void => {
    if (slotsLeft === 1) {
      compositions.push([...current, remaining]);
      return;
    }
    for (let v = 0; v <= remaining; v++) build(remaining - v, slotsLeft - 1, [...current, v]);
  };
  build(degree, q, []);
  return compositions.map((composition) => ({
    settings: mixtureFactors.map((f, i) => {
      const fraction = composition[i] / degree;
      return { factorCode: f.factorCode, codedValue: fraction.toString(), actualValue: round(fraction, f.precision) };
    }),
    isCenterPoint: false,
  }));
}

export interface ManualRunInput {
  factorSettings: DoeFactorSetting[];
  isCenterPoint?: boolean;
}

/** No generation logic — freezes exactly the rows a human supplied. Exists
 *  so a custom, hand-designed set of runs still gets the same standard-
 *  order/randomization/diagnostics/immutability treatment as a generated
 *  design, per spec §5.5 ("custom_manual"). */
export function generateManualDesign(runs: readonly ManualRunInput[]): RawRunPoint[] {
  if (runs.length === 0) throw new Error("A manual design needs at least one run.");
  return runs.map((r) => ({ settings: r.factorSettings, isCenterPoint: r.isCenterPoint ?? false }));
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function codedDesignMatrix(rawRuns: readonly RawRunPoint[], factors: readonly DoeFactor[]): number[][] | null {
  const codedFactors = factors.filter((f) => f.factorType !== "categorical" && f.factorType !== "ordinal");
  if (codedFactors.length === 0) return null;
  return rawRuns.map((run) =>
    codedFactors.map((f) => {
      const setting = run.settings.find((s) => s.factorCode === f.factorCode);
      return setting ? Number(setting.codedValue) : 0;
    }),
  );
}

export function calculateDesignDiagnostics(rawRuns: readonly RawRunPoint[], factors: readonly DoeFactor[], constraints: readonly DoeConstraint[]): DoeDesignDiagnostics {
  const warnings: string[] = [];
  const runCount = rawRuns.length;
  const centerPointCount = rawRuns.filter((r) => r.isCenterPoint).length;

  // Duplicate detection: same coded settings for every factor.
  const signatures = rawRuns.map((r) => r.settings.map((s) => `${s.factorCode}=${s.codedValue}`).sort().join("|"));
  const signatureCounts = new Map<string, number>();
  for (const sig of signatures) signatureCounts.set(sig, (signatureCounts.get(sig) ?? 0) + 1);
  const nonCenterDuplicates = signatures.filter((sig, i) => !rawRuns[i].isCenterPoint && (signatureCounts.get(sig) ?? 0) > 1);
  const duplicateRunCount = Math.max(0, nonCenterDuplicates.length - new Set(nonCenterDuplicates).size);
  const replicateCount = runCount - new Set(signatures).size - Math.max(0, centerPointCount - 1);

  // Balance: for each coded (non-categorical) factor, does -1 appear as often as +1?
  const codedFactors = factors.filter((f) => f.factorType !== "categorical" && f.factorType !== "ordinal" && !f.isMixtureComponent);
  let isBalanced = true;
  for (const f of codedFactors) {
    const values = rawRuns.filter((r) => !r.isCenterPoint).map((r) => Number(r.settings.find((s) => s.factorCode === f.factorCode)?.codedValue ?? 0));
    const positives = values.filter((v) => v > 0).length;
    const negatives = values.filter((v) => v < 0).length;
    if (positives !== negatives) isBalanced = false;
  }

  // Orthogonality + condition number, from the coded design matrix (intercept + coded factor columns).
  const matrix = codedDesignMatrix(rawRuns, factors);
  let isOrthogonal = true;
  let cond: number | undefined;
  const estimableTerms: string[] = ["intercept", ...codedFactors.map((f) => f.factorCode)];
  const aliasedTerms: string[] = [];
  if (matrix && matrix.length > 0) {
    const withIntercept = matrix.map((row) => [1, ...row]);
    const cols = withIntercept[0].length;
    for (let a = 1; a < cols; a++) {
      for (let b = a + 1; b < cols; b++) {
        const colA = withIntercept.map((row) => row[a]);
        const colB = withIntercept.map((row) => row[b]);
        const dot = colA.reduce((sum, v, i) => sum + v * colB[i], 0);
        if (Math.abs(dot) > 1e-9) isOrthogonal = false;
      }
    }
    const xtx = withIntercept[0].map((_, i) => withIntercept[0].map((_, j) => withIntercept.reduce((sum, row) => sum + row[i] * row[j], 0)));
    cond = conditionNumber(xtx);
    if (cond === undefined) {
      warnings.push("The coded design matrix is singular for a full main-effects model — one or more terms cannot be estimated from these runs.");
    } else if (cond > 1000) {
      warnings.push(`The design's condition number (${cond.toFixed(1)}) indicates a poorly-conditioned model — coefficient estimates may be unstable.`);
    }
  }

  // Constraint violations, evaluated against every run's actual values.
  let constraintViolationCount = 0;
  for (const run of rawRuns) {
    const vars: Record<string, number> = {};
    for (const s of run.settings) {
      const numeric = Number(s.actualValue);
      if (!Number.isNaN(numeric)) vars[s.factorCode] = numeric;
    }
    for (const c of constraints) {
      const evaluated = evaluateDoeExpression(c.expression, vars);
      if (evaluated.ok && evaluated.satisfied === false) {
        constraintViolationCount++;
        if (c.severity === "hard") warnings.push(`Run violates hard constraint "${c.expression}".`);
      }
    }
  }

  if (runCount === 0) warnings.push("The design has no runs.");
  if (centerPointCount === 0 && codedFactors.length > 0) warnings.push("No center points — pure lack-of-fit and curvature cannot be assessed.");

  return {
    runCount,
    degreesOfFreedom: runCount - estimableTerms.length,
    duplicateRunCount,
    estimableTerms,
    aliasedTerms,
    isOrthogonal,
    isBalanced,
    conditionNumber: cond,
    centerPointCount,
    replicateCount: Math.max(0, replicateCount),
    constraintViolationCount,
    warnings,
  };
}

export function validateGeneratedDesign(rawRuns: readonly RawRunPoint[], constraints: readonly DoeConstraint[]): DoeValidationIssue[] {
  const issues: DoeValidationIssue[] = [];
  if (rawRuns.length === 0) issues.push({ field: "design", message: "The generated design has no runs." });
  const hardConstraints = constraints.filter((c) => c.severity === "hard");
  if (hardConstraints.length > 0) {
    for (const [i, run] of rawRuns.entries()) {
      const vars: Record<string, number> = {};
      for (const s of run.settings) {
        const numeric = Number(s.actualValue);
        if (!Number.isNaN(numeric)) vars[s.factorCode] = numeric;
      }
      for (const c of hardConstraints) {
        const evaluated = evaluateDoeExpression(c.expression, vars);
        if (evaluated.ok && evaluated.satisfied === false) {
          issues.push({ field: `run-${i + 1}`, message: `Run ${i + 1} violates hard constraint: ${c.expression}` });
        }
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Randomization + finalization
// ---------------------------------------------------------------------------

/** Assigns a reproducible randomized order to a set of standard-order rows.
 *  Same seed -> same order, always (spec §6/§9.6: "randomization order is
 *  reproducible from the saved seed"). */
export function randomizeDoeRuns<T>(standardOrderRows: readonly T[], seed: number): { row: T; randomizedOrder: number }[] {
  const rng = createSeededRandom(seed);
  const indices = seededShuffle(standardOrderRows.map((_, i) => i), rng);
  const randomizedOrderByIndex = new Map(indices.map((originalIndex, position) => [originalIndex, position + 1]));
  return standardOrderRows.map((row, i) => ({ row, randomizedOrder: randomizedOrderByIndex.get(i) ?? i + 1 }));
}

export interface GenerateDoeDesignInput {
  study: DoeStudy;
  factors: readonly DoeFactor[];
  constraints: readonly DoeConstraint[];
  responses: readonly DoeResponse[];
  designType: DoeDesignType;
  seed: number;
  centerPointCount?: number;
  generationSettings?: DoeDesignGenerationSettings;
  manualRuns?: readonly ManualRunInput[];
  supersedesDesignId?: string;
}

export interface GenerateDoeDesignResult {
  design: DoeDesign;
  runs: DoeRun[];
}

/** The single entry point every design type goes through. Refuses (throws)
 *  a `designType` not in `DOE_IMPLEMENTED_DESIGN_TYPES`, a factor/constraint/
 *  response set that fails validation, or a generated design with a hard-
 *  constraint violation — nothing is persisted before every check passes. */
export function generateDoeDesign(input: GenerateDoeDesignInput, actor: Actor): GenerateDoeDesignResult {
  requireHumanActor(actor, "generate a DOE design");
  if (!DOE_IMPLEMENTED_DESIGN_TYPES.includes(input.designType)) {
    throw new Error(`Design type "${input.designType}" is not yet implemented. Implemented types: ${DOE_IMPLEMENTED_DESIGN_TYPES.join(", ")}.`);
  }
  const factorIssues = validateDoeFactors(input.factors);
  if (factorIssues.length > 0) throw new Error(`Cannot generate a design: ${factorIssues.map((i) => i.message).join(" ")}`);
  const constraintIssues = validateDoeConstraints(input.constraints, input.factors);
  if (constraintIssues.length > 0) throw new Error(`Cannot generate a design: ${constraintIssues.map((i) => i.message).join(" ")}`);
  const responseIssues = validateDoeResponses(input.responses);
  if (responseIssues.length > 0) throw new Error(`Cannot generate a design: ${responseIssues.map((i) => i.message).join(" ")}`);

  const settings = input.generationSettings ?? {};
  const centerPointCount = input.centerPointCount ?? (input.designType === "central_composite" || input.designType === "box_behnken" ? 3 : 0);

  let rawRuns: RawRunPoint[];
  switch (input.designType) {
    case "full_factorial":
      rawRuns = generateFullFactorialDesign(input.factors);
      break;
    case "two_level_factorial":
      rawRuns = generateTwoLevelFactorialDesign(input.factors);
      break;
    case "fractional_factorial":
      rawRuns = generateFractionalFactorialDesign(input.factors, settings);
      break;
    case "plackett_burman":
      rawRuns = generatePlackettBurmanDesign(input.factors);
      break;
    case "central_composite":
      rawRuns = generateCentralCompositeDesign(input.factors, settings, centerPointCount);
      break;
    case "box_behnken":
      rawRuns = generateBoxBehnkenDesign(input.factors, centerPointCount);
      break;
    case "latin_hypercube":
      rawRuns = generateLatinHypercubeDesign(input.factors, settings.latinHypercubeSampleCount ?? Math.max(input.factors.length * 3, 8), input.seed);
      break;
    case "mixture_simplex_lattice":
      rawRuns = generateMixtureSimplexLatticeDesign(input.factors, settings.mixtureLatticeDegree ?? 2);
      break;
    case "custom_manual":
      rawRuns = generateManualDesign(input.manualRuns ?? []);
      break;
    default:
      throw new Error(`Design type "${input.designType}" is not yet implemented.`);
  }

  const designIssues = validateGeneratedDesign(rawRuns, input.constraints);
  const hardIssues = designIssues.filter((issue) => input.constraints.some((c) => c.severity === "hard" && issue.message.includes(c.expression)));
  if (hardIssues.length > 0) {
    throw new Error(`Generated design violates a hard constraint and was refused: ${hardIssues.map((i) => i.message).join(" ")}`);
  }

  const diagnostics = calculateDesignDiagnostics(rawRuns, input.factors, input.constraints);
  const now = new Date().toISOString();
  const designId = newDoeId("doedesign");

  const design: DoeDesign = doeDesignSchema.parse({
    schemaVersion: "1.0",
    id: designId,
    studyId: input.study.id,
    studyRevision: input.study.revision,
    designType: input.designType,
    factorSnapshot: input.factors,
    constraintSnapshot: input.constraints,
    responseSnapshot: input.responses,
    generationSettings: settings,
    seed: input.seed,
    runCount: rawRuns.length,
    replicateCount: diagnostics.replicateCount,
    centerPointCount: diagnostics.centerPointCount,
    blockCount: input.study.blockingEnabled ? Math.max(1, Math.ceil(rawRuns.length / 8)) : 1,
    generatedBy: actor.userId,
    generatedAt: now,
    diagnostics,
    supersedesDesignId: input.supersedesDesignId,
  });

  const randomized = input.study.randomizationEnabled ? randomizeDoeRuns(rawRuns, input.seed) : rawRuns.map((row, i) => ({ row, randomizedOrder: i + 1 }));
  const blockSize = design.blockCount > 0 ? Math.ceil(rawRuns.length / design.blockCount) : rawRuns.length;

  const runs: DoeRun[] = randomized.map(({ row, randomizedOrder }, standardIndex) => {
    // Replicate number: how many prior rows (in standard order) share this exact signature.
    const signature = row.settings.map((s) => `${s.factorCode}=${s.codedValue}`).sort().join("|");
    let replicate = 1;
    for (let j = 0; j < standardIndex; j++) {
      const otherSig = rawRuns[j].settings.map((s) => `${s.factorCode}=${s.codedValue}`).sort().join("|");
      if (otherSig === signature && !rawRuns[j].isCenterPoint === !row.isCenterPoint) replicate++;
    }
    return doeRunSchema.parse({
      schemaVersion: "1.0",
      id: newDoeId("doerun"),
      studyId: input.study.id,
      studyRevision: input.study.revision,
      designId,
      runNumber: standardIndex + 1,
      standardOrder: standardIndex + 1,
      randomizedOrder,
      block: Math.min(design.blockCount, Math.floor(standardIndex / Math.max(blockSize, 1)) + 1),
      replicate,
      isCenterPoint: row.isCenterPoint,
      factorSettings: row.settings,
      status: "planned",
      createdAt: now,
    });
  });

  return { design, runs };
}
