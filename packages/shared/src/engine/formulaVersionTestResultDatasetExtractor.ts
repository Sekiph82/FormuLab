/**
 * FVL-05.005 — the extractor: turns a persisted `FormulationVersion`'s
 * linked `LaboratoryTrial` records and their real, top-level, append-only
 * `TestResult` records into `FormulaVersionTestResultRow` dataset rows for
 * the future Historical Experiment Dataset Builder.
 *
 * See `schemas/dataset.ts`'s header comment on
 * `formulaVersionTestResultRowSchema` for the full recovered source
 * contract: `TestResult.trialId` is the ONE, direct, exact link to
 * `LaboratoryTrial.id` (never invented, never fuzzy); `TestResult` is its
 * own real top-level append-only collection (not embedded on the trial
 * the way `TrialProcessStep`/`TrialObservation` are), so `TestResult.id`
 * is a genuinely global identity and lineage citations for it never need
 * `parentRecordId`; every persisted `TestResult` for a linked trial is
 * emitted verbatim, including every entry in a `revisesResultId` chain —
 * never collapsed to "latest revision only". A trial is "linked" to the
 * requested formula version by the same rule FVL-05.004 established:
 * `sourceType === "saved_version"` AND `sourceFormulaVersionId` exactly
 * matches the requested version's id; a linked trial whose `projectId`
 * does not resolve to the version's owning formulation is a conflicting
 * link and fails closed.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs, no
 * generated ids/timestamps. Trials are ordered by `createdAt` then `id`
 * (never by input array order); test results within a trial are ordered
 * by the domain's own `performedAt` (when the test was actually
 * performed) then `id`. Both `createdAt` (trials) and `performedAt`
 * (test results) are validated as canonical `toISOString()`-format
 * timestamps before being used as a chronological sort key, failing
 * closed on a non-conforming value rather than silently lexically
 * mis-ordering history — the same discipline FVL-05.004 established.
 * Opaque-id tie-breakers use locale-independent ordinal comparison, never
 * `localeCompare`.
 *
 * Every constructed row is validated against
 * `formulaVersionTestResultRowSchema` before it is returned — fails
 * closed on a malformed row, and guarantees (via zod's always-rebuilding
 * parse) that the returned row shares no mutable array/object with the
 * source records it was built from.
 *
 * REFERENTIAL INTEGRITY FOR `revisesResultId`/`retestOf`
 * (`AUDIT_FVL05_GPT_000005` finding 1): both are real
 * `TestResult`-to-`TestResult` identity relationships (`engine/testResults.ts`'s
 * `reviseTestResult` sets `revisesResultId` to the exact predecessor
 * `id`), not decorative free text. The AUTHORITATIVE domain semantics for
 * both were recovered directly from `engine/resultHistory.ts` — the
 * existing, production-used (via `ResultHistoryBrowser.tsx`) engine
 * module that walks these exact relationships — rather than invented:
 * `buildResultRevisionChain`'s own doc comment establishes the
 * CONVENTIONAL scope for a `revisesResultId` chain as "every result for
 * one test definition on ONE TRIAL"; its cycle-detection code proves a
 * cyclic reference is a real, anticipated malformed state (it chooses to
 * warn-and-truncate there, because that module's job is graceful DISPLAY
 * of imperfect real-world data to a human); `groupRetestLineage`
 * similarly treats a dangling `retestOf` as detectable-but-tolerated in
 * that same browsing context. No source evidence anywhere proves
 * CROSS-TRIAL `revisesResultId`/`retestOf` linkage is a legitimate,
 * intended relationship (the generic utilities are merely agnostic to
 * trial scope, which is not the same as endorsing it) — per this task's
 * own "same-trial requirement must be enforced UNLESS current source
 * explicitly proves cross-trial linkage is legitimate" instruction, this
 * extractor therefore ENFORCES same-trial for both fields, and — unlike
 * `resultHistory.ts`'s UI-browsing tolerance for a human who can see and
 * dismiss a warning — FAILS CLOSED on a dangling reference, a
 * cross-trial reference, a self-reference, or any longer cycle, for
 * BOTH `revisesResultId` and `retestOf` identically (no source evidence
 * was found justifying a materially different rule for the two fields).
 * A trustworthy HISTORICAL DATASET, unlike an interactive UI a human is
 * actively looking at, has no way to surface "here's a warning, judge
 * for yourself" to a downstream ML/analysis consumer — an internally
 * inconsistent lineage reference silently baked into extracted output
 * would poison that consumer instead. See `validateResultReference`/
 * `findFirstReferenceCycle` below.
 */
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { LaboratoryTrial } from "../schemas/laboratory";
import type { TestResult } from "../schemas/testDefinitions";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionTestResultRowSchema,
  type FormulaVersionTestResultRow,
  type SourceRecordReference,
  type TrialTestResults,
} from "../schemas/dataset";

/** Locale/ICU-independent ordinal comparison for opaque ids — see
 *  `formulaVersionProcessDatasetExtractor.ts`'s identical helper for the
 *  full rationale (`localeCompare` is collation-aware and not guaranteed
 *  environment-independent; `<`/`>` compares UTF-16 code units directly). */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validates that `value` is EXACTLY the canonical
 *  `Date.prototype.toISOString()` format — see
 *  `formulaVersionProcessDatasetExtractor.ts`'s identical helper for the
 *  full rationale. A round-trip check (`new Date(value).toISOString() ===
 *  value`) confirms the shape without assuming any particular timezone. */
function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export interface FormulaVersionTestResultDatasetExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. Each is resolved against `formulationVersions`
   *  — a requested id absent from that pool fails closed rather than being
   *  silently skipped. */
  formulationVersionIds: string[];
  formulationVersions: FormulationVersion[];
  formulations: Formulation[];
  /** The pool of trials available to resolve each version's linked test
   *  results from. Only trials whose `sourceFormulaVersionId` exactly
   *  matches a requested version's id (and whose `sourceType` is
   *  `"saved_version"`) contribute to that version's row; every other
   *  supplied trial is legitimately irrelevant to that row and ignored. */
  trials: LaboratoryTrial[];
  /** The pool of persisted `TestResult` records available to resolve each
   *  linked trial's results from. Every result's `trialId` must resolve
   *  to a trial in the `trials` pool above (pool-wide, regardless of
   *  relevance to any requested version) or the whole extraction fails
   *  closed — see `test_result_trial_not_found`. */
  testResults: TestResult[];
}

export type FormulaVersionTestResultDatasetExtractionErrorCode =
  | "formula_version_not_found"
  | "duplicate_formula_version_id"
  | "formulation_not_found"
  | "duplicate_formulation_id"
  | "duplicate_trial_id"
  | "invalid_saved_version_trial_link"
  | "trial_formula_link_conflict"
  | "duplicate_test_result_id"
  | "test_result_trial_not_found"
  | "test_result_revision_cycle_detected"
  | "dangling_test_result_revision_reference"
  | "cross_trial_test_result_revision_reference"
  | "test_result_retest_cycle_detected"
  | "dangling_test_result_retest_reference"
  | "cross_trial_test_result_retest_reference"
  | "invalid_timestamp_format"
  | "row_schema_validation_failed";

/** Truthful, correctly-named structured error context — never a single
 *  overloaded field holding whatever identity happened to be at hand
 *  (the exact defect FVL-05.004's `AUDIT_FVL05_GPT_000001` finding J
 *  fixed there; this extractor starts from that corrected shape). */
export interface FormulaVersionTestResultDatasetExtractionErrorContext {
  formulaVersionId?: string;
  formulationId?: string;
  trialId?: string;
  testResultId?: string;
}

export class FormulaVersionTestResultDatasetExtractionError extends Error {
  readonly code: FormulaVersionTestResultDatasetExtractionErrorCode;
  readonly formulaVersionId?: string;
  readonly formulationId?: string;
  readonly trialId?: string;
  readonly testResultId?: string;

  constructor(
    code: FormulaVersionTestResultDatasetExtractionErrorCode,
    message: string,
    context: FormulaVersionTestResultDatasetExtractionErrorContext = {},
  ) {
    super(message);
    this.name = "FormulaVersionTestResultDatasetExtractionError";
    this.code = code;
    this.formulaVersionId = context.formulaVersionId;
    this.formulationId = context.formulationId;
    this.trialId = context.trialId;
    this.testResultId = context.testResultId;
  }
}

/** Builds the exact-id formula version lookup, failing closed on a duplicate
 *  `FormulationVersion.id` rather than silently letting the last one win. */
function buildVersionsById(formulationVersions: FormulationVersion[]): Map<string, FormulationVersion> {
  const byId = new Map<string, FormulationVersion>();
  for (const version of formulationVersions) {
    if (byId.has(version.id)) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "duplicate_formula_version_id",
        `Ambiguous exact formula version identity: more than one supplied formulation version has id "${version.id}".`,
        { formulaVersionId: version.id },
      );
    }
    byId.set(version.id, version);
  }
  return byId;
}

/** Builds the exact-id formula lookup, failing closed on a duplicate
 *  `Formulation.id` rather than silently letting the last one win. */
function buildFormulationsById(formulations: Formulation[]): Map<string, Formulation> {
  const byId = new Map<string, Formulation>();
  for (const formulation of formulations) {
    if (byId.has(formulation.id)) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "duplicate_formulation_id",
        `Ambiguous exact formulation identity: more than one supplied formulation has id "${formulation.id}".`,
        { formulationId: formulation.id },
      );
    }
    byId.set(formulation.id, formulation);
  }
  return byId;
}

function byTrialOrder(a: LaboratoryTrial, b: LaboratoryTrial): number {
  return compareOrdinal(a.createdAt, b.createdAt) || compareOrdinal(a.id, b.id);
}

function byTestResultOrder(a: TestResult, b: TestResult): number {
  return compareOrdinal(a.performedAt, b.performedAt) || compareOrdinal(a.id, b.id);
}

/** Builds the exact-id trial lookup over the ENTIRE supplied pool, failing
 *  closed on a duplicate `LaboratoryTrial.id`, and on a `"saved_version"`
 *  trial with a missing/blank `sourceFormulaVersionId` (documented as
 *  required by `schemas/laboratory.ts`'s own comment, but not
 *  Zod-enforced), and on a non-canonical `createdAt` — the same three
 *  checks `formulaVersionProcessDatasetExtractor.ts`'s `buildTrialsById`
 *  established, reused here identically since the underlying trial
 *  contract is unchanged. */
function buildTrialsById(trials: LaboratoryTrial[]): Map<string, LaboratoryTrial> {
  const byId = new Map<string, LaboratoryTrial>();
  for (const trial of trials) {
    if (byId.has(trial.id)) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "duplicate_trial_id",
        `Ambiguous exact trial identity: more than one supplied laboratory trial has id "${trial.id}".`,
        { trialId: trial.id },
      );
    }
    if (trial.sourceType === "saved_version" && (trial.sourceFormulaVersionId === undefined || trial.sourceFormulaVersionId.trim() === "")) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "invalid_saved_version_trial_link",
        `Laboratory trial "${trial.id}" has sourceType "saved_version" but no (or a blank) sourceFormulaVersionId — this is a contradictory, malformed saved-version link.`,
        { trialId: trial.id },
      );
    }
    if (!isCanonicalIsoTimestamp(trial.createdAt)) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "invalid_timestamp_format",
        `Laboratory trial "${trial.id}" has a createdAt value ("${trial.createdAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { trialId: trial.id },
      );
    }
    byId.set(trial.id, trial);
  }
  return byId;
}

type TestResultReferenceField = "revisesResultId" | "retestOf";

const REFERENCE_FIELD_ERROR_CODES: Record<
  TestResultReferenceField,
  {
    cycle: FormulaVersionTestResultDatasetExtractionErrorCode;
    dangling: FormulaVersionTestResultDatasetExtractionErrorCode;
    crossTrial: FormulaVersionTestResultDatasetExtractionErrorCode;
    verb: string;
  }
> = {
  revisesResultId: {
    cycle: "test_result_revision_cycle_detected",
    dangling: "dangling_test_result_revision_reference",
    crossTrial: "cross_trial_test_result_revision_reference",
    verb: "revises",
  },
  retestOf: {
    cycle: "test_result_retest_cycle_detected",
    dangling: "dangling_test_result_retest_reference",
    crossTrial: "cross_trial_test_result_retest_reference",
    verb: "is a retest of",
  },
};

/** Validates one `result[field]` reference (immediate neighbor only — self,
 *  dangling, cross-trial). Longer cycles (length >= 2) are caught
 *  separately by `findFirstReferenceCycle` once every individual edge is
 *  known to resolve. Self-reference is checked FIRST: a self-reference
 *  would otherwise trivially "resolve" (the target is the result itself)
 *  and pass both the dangling and cross-trial checks, masking the real
 *  problem. */
function validateResultReference(
  result: TestResult,
  field: TestResultReferenceField,
  resultsById: Map<string, TestResult>,
): void {
  const targetId = result[field];
  if (targetId === undefined) return;
  const codes = REFERENCE_FIELD_ERROR_CODES[field];

  if (targetId === result.id) {
    throw new FormulaVersionTestResultDatasetExtractionError(
      codes.cycle,
      `Test result "${result.id}" ${codes.verb} itself — a self-reference is not a valid ${field === "revisesResultId" ? "revision" : "retest"} relationship.`,
      { testResultId: result.id, trialId: result.trialId },
    );
  }

  const target = resultsById.get(targetId);
  if (!target) {
    throw new FormulaVersionTestResultDatasetExtractionError(
      codes.dangling,
      `Test result "${result.id}" ${codes.verb} "${targetId}", which was not found among the supplied test results.`,
      { testResultId: result.id, trialId: result.trialId },
    );
  }

  if (target.trialId !== result.trialId) {
    throw new FormulaVersionTestResultDatasetExtractionError(
      codes.crossTrial,
      `Test result "${result.id}" (trial "${result.trialId}") ${codes.verb} "${targetId}", which belongs to a different trial ("${target.trialId}").`,
      { testResultId: result.id, trialId: result.trialId },
    );
  }
}

/** Walks the `field` chain from every result in `testResults`, returning
 *  the first result found to be part of a cycle (length >= 2 — a direct
 *  self-reference is already rejected by `validateResultReference` before
 *  this ever runs). Every edge is already known to resolve (no dangling
 *  reference survives `validateResultReference`), so `resultsById.get`
 *  here is always defined for a set `field`. */
function findFirstReferenceCycle(
  testResults: TestResult[],
  field: TestResultReferenceField,
  resultsById: Map<string, TestResult>,
): TestResult | undefined {
  for (const start of testResults) {
    const visited = new Set<string>();
    let current: TestResult | undefined = start;
    while (current) {
      if (visited.has(current.id)) return start;
      visited.add(current.id);
      const nextId = current[field];
      if (nextId === undefined) break;
      current = resultsById.get(nextId);
    }
  }
  return undefined;
}

/** Builds the trial-id -> test-results index over the ENTIRE supplied
 *  `testResults` pool. Pass 1: fails closed on a duplicate `TestResult.id`,
 *  a `trialId` that does not resolve to any supplied trial, and a
 *  non-canonical `performedAt` (mirrors `formulation_not_found`'s "audit
 *  the whole pool up front" discipline). Pass 2: validates every
 *  `revisesResultId`/`retestOf` immediate reference (self/dangling/
 *  cross-trial — see `validateResultReference`). Pass 3: detects any
 *  longer (length >= 2) reference cycle in either field, now that every
 *  individual edge is known to resolve. */
function buildTestResultsByTrialId(
  testResults: TestResult[],
  trialsById: Map<string, LaboratoryTrial>,
): Map<string, TestResult[]> {
  const resultsById = new Map<string, TestResult>();
  const byTrialId = new Map<string, TestResult[]>();
  for (const result of testResults) {
    if (resultsById.has(result.id)) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "duplicate_test_result_id",
        `Ambiguous exact test result identity: more than one supplied test result has id "${result.id}".`,
        { testResultId: result.id },
      );
    }
    if (!trialsById.has(result.trialId)) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "test_result_trial_not_found",
        `Test result "${result.id}" references trialId "${result.trialId}", which was not found among the supplied laboratory trials.`,
        { testResultId: result.id, trialId: result.trialId },
      );
    }
    if (!isCanonicalIsoTimestamp(result.performedAt)) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "invalid_timestamp_format",
        `Test result "${result.id}" has a performedAt value ("${result.performedAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { testResultId: result.id, trialId: result.trialId },
      );
    }
    resultsById.set(result.id, result);
    const bucket = byTrialId.get(result.trialId);
    if (bucket) {
      bucket.push(result);
    } else {
      byTrialId.set(result.trialId, [result]);
    }
  }

  for (const result of testResults) {
    validateResultReference(result, "revisesResultId", resultsById);
    validateResultReference(result, "retestOf", resultsById);
  }

  const revisionCycleMember = findFirstReferenceCycle(testResults, "revisesResultId", resultsById);
  if (revisionCycleMember) {
    throw new FormulaVersionTestResultDatasetExtractionError(
      "test_result_revision_cycle_detected",
      `Test result "${revisionCycleMember.id}" is part of a circular revisesResultId reference chain.`,
      { testResultId: revisionCycleMember.id, trialId: revisionCycleMember.trialId },
    );
  }
  const retestCycleMember = findFirstReferenceCycle(testResults, "retestOf", resultsById);
  if (retestCycleMember) {
    throw new FormulaVersionTestResultDatasetExtractionError(
      "test_result_retest_cycle_detected",
      `Test result "${retestCycleMember.id}" is part of a circular retestOf reference chain.`,
      { testResultId: retestCycleMember.id, trialId: retestCycleMember.trialId },
    );
  }

  return byTrialId;
}

/** Resolves every trial linked to `version`, failing closed on a conflicting
 *  link (a trial whose `sourceFormulaVersionId` matches but whose
 *  `projectId` does not resolve to the version's own owning formulation) —
 *  never silently attributing or silently dropping it. Order is by
 *  `createdAt` then `id`, independent of the supplied pool's order. */
function resolveLinkedTrials(
  version: FormulationVersion,
  formulation: Formulation,
  trialsById: Map<string, LaboratoryTrial>,
): LaboratoryTrial[] {
  const linked: LaboratoryTrial[] = [];
  for (const trial of trialsById.values()) {
    if (trial.sourceType !== "saved_version" || trial.sourceFormulaVersionId !== version.id) continue;
    if (trial.projectId !== formulation.id) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "trial_formula_link_conflict",
        `Laboratory trial "${trial.id}" links to formula version "${version.id}" but its projectId "${trial.projectId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, trialId: trial.id },
      );
    }
    linked.push(trial);
  }
  return linked.sort(byTrialOrder);
}

/** Builds one `TrialTestResults` entry plus the exact source-record
 *  citations it contributes. `testResult` citations never set
 *  `parentRecordId` — `TestResult.id` is a genuinely global identity
 *  (its own top-level append-only collection), not parent-scoped the way
 *  `TrialProcessStep`/`TrialObservation` are. */
function buildTrialTestResults(
  trial: LaboratoryTrial,
  testResultsByTrialId: Map<string, TestResult[]>,
): { entry: TrialTestResults; citations: SourceRecordReference[] } {
  const results = [...(testResultsByTrialId.get(trial.id) ?? [])].sort(byTestResultOrder);
  const citations: SourceRecordReference[] = [{ sourceEntity: "laboratoryTrial", sourceRecordId: trial.id }];
  for (const result of results) {
    citations.push({ sourceEntity: "testResult", sourceRecordId: result.id });
  }
  return {
    entry: { trialId: trial.id, trialCode: trial.code, testResults: results },
    citations,
  };
}

function extractOne(
  version: FormulationVersion,
  formulationsById: Map<string, Formulation>,
  trialsById: Map<string, LaboratoryTrial>,
  testResultsByTrialId: Map<string, TestResult[]>,
): FormulaVersionTestResultRow {
  const formulation = formulationsById.get(version.formulationId);
  if (!formulation) {
    throw new FormulaVersionTestResultDatasetExtractionError(
      "formulation_not_found",
      `FormulationVersion "${version.id}" references formulationId "${version.formulationId}", which was not found among the supplied formulations.`,
      { formulaVersionId: version.id, formulationId: version.formulationId },
    );
  }

  const linkedTrials = resolveLinkedTrials(version, formulation, trialsById);
  const sourceRecords: SourceRecordReference[] = [
    { sourceEntity: "formulation", sourceRecordId: formulation.id },
    { sourceEntity: "formulationVersion", sourceRecordId: version.id },
  ];
  const trials: TrialTestResults[] = [];
  for (const trial of linkedTrials) {
    const { entry, citations } = buildTrialTestResults(trial, testResultsByTrialId);
    trials.push(entry);
    sourceRecords.push(...citations);
  }

  const row = {
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords,
    formulaId: formulation.id,
    formulaCode: formulation.code,
    formulaVersionId: version.id,
    formulaVersionNumber: version.versionNumber,
    trials,
  };

  const parsed = formulaVersionTestResultRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionTestResultDatasetExtractionError(
      "row_schema_validation_failed",
      `Extracted row for formula version "${version.id}" failed schema validation: ${issues}`,
      { formulaVersionId: version.id },
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionTestResultRow` per requested formula
 *  version id, in the requested order. Throws (fails closed) on the first
 *  requested id, formula, trial pool, or test-result identity that cannot
 *  be resolved to an exact, unambiguous source record, or on the first
 *  constructed row that fails schema validation — it never silently drops
 *  or partially emits a row instead. */
export function extractFormulaVersionTestResultRows(
  input: FormulaVersionTestResultDatasetExtractionInput,
): FormulaVersionTestResultRow[] {
  const formulationsById = buildFormulationsById(input.formulations);
  const versionsById = buildVersionsById(input.formulationVersions);
  const trialsById = buildTrialsById(input.trials);
  const testResultsByTrialId = buildTestResultsByTrialId(input.testResults, trialsById);
  return input.formulationVersionIds.map((requestedId) => {
    const version = versionsById.get(requestedId);
    if (!version) {
      throw new FormulaVersionTestResultDatasetExtractionError(
        "formula_version_not_found",
        `Requested formula version id "${requestedId}" was not found among the supplied formulation versions.`,
        { formulaVersionId: requestedId },
      );
    }
    return extractOne(version, formulationsById, trialsById, testResultsByTrialId);
  });
}
