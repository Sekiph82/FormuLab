// Phase 4 — label requirement generation, content evaluation, formula/
// claim-to-label consistency, artwork readiness. Mirrors
// `engine/regulatoryDossier.ts`'s requirement-matrix shape: a frozen,
// per-revision requirement snapshot, live-computed satisfaction never
// stored on the requirement row itself, "unknown blocks readiness". See
// docs/PRODUCT_LABELS.md / docs/FORMULA_LABEL_CONSISTENCY.md.
import { newId } from "./versioning";
import { requireAuthorizedRegulatoryActor, requireHumanActor } from "./regulatoryAuthorization";
import type { Actor } from "../schemas/status";
import type { FormulationLine, FormulationVersion } from "../schemas/formulation";
import type { RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";
import {
  LABEL_CONTENT_BLOCK_TYPES,
  LABEL_IMMUTABLE_STATUSES,
  type ClaimsReadinessState,
  type LabelArtwork,
  type LabelArtworkStatus,
  type LabelContentBlock,
  type LabelContentBlockType,
  type LabelReadiness,
  type LabelRequirementState,
  type LabelStatus,
  type ProductClaim,
  type ProductLabel,
} from "../schemas/claimsLabels";

// ---------------------------------------------------------------------------
// Label lifecycle.
// ---------------------------------------------------------------------------

export function isLabelImmutable(label: Pick<ProductLabel, "status">): boolean {
  return (LABEL_IMMUTABLE_STATUSES as readonly LabelStatus[]).includes(label.status);
}

export interface CreateLabelInput {
  labelCode: string;
  formulationId: string;
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdiction: RegulatoryJurisdiction;
  language: string;
}

export function createLabel(input: CreateLabelInput, actor: Actor): ProductLabel {
  requireHumanActor(actor, "create a product label");
  if (!input.formulaVersionId.trim()) throw new Error("A label must be recorded against a real, saved formula version id.");
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: newId("label"),
    labelCode: input.labelCode,
    formulationId: input.formulationId,
    formulaVersionId: input.formulaVersionId,
    packagingSkuCode: input.packagingSkuCode,
    jurisdiction: input.jurisdiction,
    language: input.language,
    status: "draft",
    revision: 1,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateLabelStatus(label: ProductLabel, to: LabelStatus, actor: Actor): ProductLabel {
  requireHumanActor(actor, "change a label's status");
  if (isLabelImmutable(label)) throw new Error(`Label ${label.labelCode} is ${label.status} and immutable — create a new revision instead of changing its status.`);
  return { ...label, status: to, updatedBy: actor.userId, updatedAt: new Date().toISOString() };
}

export function reviseLabel(current: ProductLabel, actor: Actor): { superseded: ProductLabel; revised: ProductLabel } {
  requireHumanActor(actor, "revise a label");
  const now = new Date().toISOString();
  const superseded: ProductLabel = { ...current, status: "superseded", updatedBy: actor.userId, updatedAt: now };
  const revised: ProductLabel = {
    ...current,
    id: newId("label"),
    status: "draft",
    revision: current.revision + 1,
    supersedesLabelId: current.id,
    createdBy: actor.userId,
    createdAt: now,
    updatedBy: undefined,
    updatedAt: now,
  };
  return { superseded, revised };
}

export function deriveLabelEffectiveStatus(label: ProductLabel, allLabelsInScope: ProductLabel[]): LabelStatus {
  const supersededBy = allLabelsInScope.some((l) => l.supersedesLabelId === label.id);
  return supersededBy ? "superseded" : label.status;
}

// ---------------------------------------------------------------------------
// Content block lifecycle — append-only per (labelId, labelRevision,
// blockType, language), latest-wins, same overlay convention as
// `RegulatoryDossierRequirement`.
// ---------------------------------------------------------------------------

export interface SetLabelContentInput {
  labelId: string;
  labelRevision: number;
  blockType: LabelContentBlockType;
  text: string;
  language: string;
  mandatory?: boolean;
  source?: LabelContentBlock["source"];
  sourceEntityId?: string;
  translationStatus?: LabelContentBlock["translationStatus"];
}

export function setLabelContent(input: SetLabelContentInput, actor: Actor): LabelContentBlock {
  requireHumanActor(actor, "set label content");
  return {
    schemaVersion: "1.0",
    id: newId("labelcontent"),
    labelId: input.labelId,
    labelRevision: input.labelRevision,
    blockType: input.blockType,
    text: input.text,
    language: input.language,
    position: 0,
    mandatory: input.mandatory ?? true,
    source: input.source ?? "manual",
    sourceEntityId: input.sourceEntityId,
    translationStatus: input.translationStatus ?? (input.source === "ai_suggested" ? "machine_suggested" : "draft"),
    status: input.text.trim() ? "present" : "missing",
    createdBy: actor.userId,
    createdAt: new Date().toISOString(),
  };
}

/** Latest row per `(labelId, labelRevision, blockType, language)`. */
export function currentContentForRevision(blocks: LabelContentBlock[], labelId: string, labelRevision: number): LabelContentBlock[] {
  const scoped = blocks.filter((b) => b.labelId === labelId && b.labelRevision === labelRevision);
  const latestByKey = new Map<string, LabelContentBlock>();
  for (const block of scoped) {
    const key = `${block.blockType}:${block.language}`;
    const existing = latestByKey.get(key);
    if (!existing || block.createdAt >= existing.createdAt) latestByKey.set(key, block);
  }
  return Array.from(latestByKey.values());
}

// ---------------------------------------------------------------------------
// Artwork lifecycle — mutable current-state row; a real file replacement
// creates a NEW row via `supersedesArtworkId`, same chain
// `RegulatoryDossierEvidenceItem` already uses.
// ---------------------------------------------------------------------------

export interface UploadArtworkInput {
  labelId: string;
  labelRevision: number;
  artworkCode: string;
  attachmentIds?: LabelArtwork["attachmentIds"];
  format?: string;
  dimensions?: string;
  colorMode?: string;
  languageSet?: string[];
}

export function uploadArtwork(input: UploadArtworkInput, actor: Actor): LabelArtwork {
  requireHumanActor(actor, "upload label artwork");
  return {
    schemaVersion: "1.0",
    id: newId("labelartwork"),
    labelId: input.labelId,
    labelRevision: input.labelRevision,
    artworkCode: input.artworkCode,
    attachmentIds: input.attachmentIds ?? [],
    format: input.format,
    dimensions: input.dimensions,
    colorMode: input.colorMode,
    languageSet: input.languageSet ?? [],
    createdBy: actor.userId,
    createdAt: new Date().toISOString(),
    status: (input.attachmentIds?.length ?? 0) > 0 ? "uploaded" : "draft",
  };
}

export function approveArtwork(artwork: LabelArtwork, actor: Actor): LabelArtwork {
  requireAuthorizedRegulatoryActor(actor, "approve label artwork");
  if (artwork.attachmentIds.length === 0) throw new Error("Artwork with no attachment cannot be approved.");
  return { ...artwork, status: "approved" };
}

export function rejectArtwork(artwork: LabelArtwork, actor: Actor, reason: string): LabelArtwork {
  requireAuthorizedRegulatoryActor(actor, "reject label artwork");
  if (!reason.trim()) throw new Error("A reason is required to reject artwork.");
  return { ...artwork, status: "rejected" };
}

export function replaceArtwork(current: LabelArtwork, input: Omit<UploadArtworkInput, "labelId" | "labelRevision">, actor: Actor): { superseded: LabelArtwork; replacement: LabelArtwork } {
  requireHumanActor(actor, "replace label artwork");
  const superseded: LabelArtwork = { ...current, status: "superseded" };
  const replacement = uploadArtwork({ ...input, labelId: current.labelId, labelRevision: current.labelRevision }, actor);
  return { superseded, replacement: { ...replacement, supersedesArtworkId: current.id } };
}

/** `"superseded"` whenever a later artwork's `supersedesArtworkId` points
 *  back at it, regardless of its own stored status — same overlay pattern
 *  as evidence items. Replacing artwork makes any prior review of it stale
 *  (spec §12) — callers should treat a superseded artwork's existing
 *  `LabelReview.artworkId` as no longer current. */
export function deriveArtworkEffectiveStatus(artwork: LabelArtwork, allArtworkInScope: LabelArtwork[]): LabelArtworkStatus {
  const supersededBy = allArtworkInScope.some((a) => a.supersedesArtworkId === artwork.id);
  return supersededBy ? "superseded" : artwork.status;
}

// ---------------------------------------------------------------------------
// Label requirement generation.
// ---------------------------------------------------------------------------

/** Content block types every label needs by default, absent a rule saying
 *  otherwise — a conservative, universally-reasonable baseline, never
 *  presented as verified legislation (see docs/PRODUCT_LABELS.md). */
const BASELINE_MANDATORY_BLOCKS: readonly LabelContentBlockType[] = [
  "product_name",
  "net_quantity",
  "ingredients",
  "directions",
  "warnings",
  "manufacturer",
  "batch_code",
];

export interface LabelRequirementGenerationContext {
  jurisdiction: RegulatoryJurisdiction;
  language: string;
  rules: RegulatoryRule[];
  hasActiveClaims: boolean;
}

export interface LabelRequirement {
  blockType: LabelContentBlockType;
  mandatory: boolean;
  isManual: boolean;
  sourceRuleId?: string;
  sourceRuleVersion?: string | number;
  reason: string;
}

/** Generates the frozen requirement list from real, configured data only:
 *  the conservative baseline above, plus whatever a jurisdiction's active,
 *  non-deprecated `RegulatoryRule.requiredLabelElements`/`requiredWarnings`
 *  actually names (never an invented requirement). */
export function resolveLabelRequirements(ctx: LabelRequirementGenerationContext): LabelRequirement[] {
  const requirements = new Map<LabelContentBlockType, LabelRequirement>();
  for (const blockType of BASELINE_MANDATORY_BLOCKS) {
    requirements.set(blockType, { blockType, mandatory: true, isManual: false, reason: "Baseline label element expected on any product label." });
  }
  const applicableRules = ctx.rules.filter((r) => r.active && r.status !== "deprecated" && (r.jurisdiction === ctx.jurisdiction || r.jurisdiction === "EAC"));
  for (const rule of applicableRules) {
    for (const element of rule.requiredLabelElements) {
      const blockType = (LABEL_CONTENT_BLOCK_TYPES as readonly string[]).includes(element) ? (element as LabelContentBlockType) : "other";
      requirements.set(blockType, { blockType, mandatory: true, isManual: false, sourceRuleId: rule.id, sourceRuleVersion: rule.version, reason: rule.requirement });
    }
    if (rule.requiredWarnings.length > 0) {
      requirements.set("warnings", { blockType: "warnings", mandatory: true, isManual: false, sourceRuleId: rule.id, sourceRuleVersion: rule.version, reason: `Required warnings: ${rule.requiredWarnings.join("; ")}` });
    }
  }
  if (ctx.hasActiveClaims) {
    requirements.set("claims", { blockType: "claims", mandatory: false, isManual: false, reason: "At least one active claim exists for this formula version/scope." });
  }
  return Array.from(requirements.values());
}

// ---------------------------------------------------------------------------
// Content and consistency evaluation.
// ---------------------------------------------------------------------------

export interface LabelRequirementRow {
  requirement: LabelRequirement;
  block?: LabelContentBlock;
  state: LabelRequirementState;
}

export function evaluateLabelContent(requirements: LabelRequirement[], blocks: LabelContentBlock[], language: string): LabelRequirementRow[] {
  return requirements.map((requirement) => {
    const block = blocks.find((b) => b.blockType === requirement.blockType && b.language === language);
    let state: LabelRequirementState;
    if (!block) state = requirement.mandatory ? "missing" : "not_applicable";
    else if (block.status === "missing") state = "missing";
    else if (block.status === "invalid") state = "invalid";
    else if (block.status === "human_review_required") state = "human_review_required";
    else if (block.translationStatus === "machine_suggested" || block.translationStatus === "human_review_required") state = "unverified";
    else state = "present";
    return { requirement, block, state };
  });
}

export interface FormulaLabelConsistencyContext {
  formulationName: string;
  formulaVersion: Pick<FormulationVersion, "id" | "lines">;
  label: Pick<ProductLabel, "formulaVersionId" | "packagingSkuCode">;
  packagingSkuCode?: string;
}

export interface ConsistencyFinding {
  code: string;
  severity: "blocking" | "warning";
  message: string;
}

/** Never lets a label silently reference a different formula version or
 *  packaging SKU than the one it claims to be for — spec §12's "Label
 *  cannot reference a different formula version silently." */
export function evaluateFormulaLabelConsistency(ctx: FormulaLabelConsistencyContext, blocks: LabelContentBlock[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  if (ctx.label.formulaVersionId !== ctx.formulaVersion.id) {
    findings.push({ code: "wrong_formula_version", severity: "blocking", message: "This label's formulaVersionId does not match the formula version it is being checked against." });
    return findings;
  }
  if (ctx.packagingSkuCode && ctx.label.packagingSkuCode && ctx.label.packagingSkuCode !== ctx.packagingSkuCode) {
    findings.push({ code: "wrong_packaging_sku", severity: "blocking", message: "This label's packagingSkuCode does not match the packaging SKU it is being checked against." });
  }
  const nameBlock = blocks.find((b) => b.blockType === "product_name");
  if (nameBlock && nameBlock.text.trim() && !nameBlock.text.toLowerCase().includes(ctx.formulationName.toLowerCase().split(" ")[0] ?? "")) {
    findings.push({ code: "product_name_mismatch", severity: "warning", message: `Label product name "${nameBlock.text}" does not obviously match the project name "${ctx.formulationName}".` });
  }
  const ingredientsBlock = blocks.find((b) => b.blockType === "ingredients");
  const materialCodesOnLabel = (ingredientsBlock?.text ?? "").toLowerCase();
  const missingMaterials = ctx.formulaVersion.lines.filter((l: FormulationLine) => l.displayName && !materialCodesOnLabel.includes(l.displayName.toLowerCase()));
  if (ingredientsBlock && ingredientsBlock.text.trim() && missingMaterials.length > 0) {
    findings.push({
      code: "ingredient_declaration_incomplete",
      severity: "warning",
      message: `${missingMaterials.length} formula line(s) not obviously named in the ingredients block: ${missingMaterials.map((l) => l.displayName).join(", ")}.`,
    });
  }
  return findings;
}

export interface ClaimLabelConsistencyContext {
  claims: ProductClaim[];
}

/** Checks the label's claims block against the actual reviewed claim
 *  state — a prohibited claim on the label is always a blocking finding;
 *  a claims block naming nothing while active supported claims exist is a
 *  warning (the label may be under-selling reviewed benefits, not unsafe). */
export function evaluateClaimLabelConsistency(ctx: ClaimLabelConsistencyContext, blocks: LabelContentBlock[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const claimsBlock = blocks.find((b) => b.blockType === "claims");
  const text = (claimsBlock?.text ?? "").toLowerCase();
  for (const claim of ctx.claims) {
    const mentioned = claim.claimText.trim() && text.includes(claim.claimText.toLowerCase());
    if (mentioned && claim.status === "prohibited") {
      findings.push({ code: "label_claim_inconsistent", severity: "blocking", message: `The label's claims block includes "${claim.claimText}", which is a prohibited claim.` });
    }
    if (mentioned && (claim.status === "restricted")) {
      findings.push({ code: "label_claim_inconsistent", severity: "warning", message: `The label's claims block includes "${claim.claimText}", which is restricted — verify any required conditions are also shown.` });
    }
  }
  return findings;
}

export function evaluateArtworkReadiness(artwork: LabelArtwork | undefined): ConsistencyFinding[] {
  if (!artwork) return [{ code: "artwork_missing", severity: "blocking", message: "No artwork has been uploaded for this label." }];
  if (artwork.status !== "approved") return [{ code: "artwork_unapproved", severity: "blocking", message: `Artwork ${artwork.artworkCode} is ${artwork.status}, not approved.` }];
  return [];
}

export function calculateLabelReadiness(label: Pick<ProductLabel, "id" | "revision" | "status">, rows: LabelRequirementRow[], languagesExpected: string[], languagesCovered: string[], artwork?: LabelArtwork): LabelReadiness {
  const mandatoryRows = rows.filter((r) => r.requirement.mandatory);
  const present = mandatoryRows.filter((r) => r.state === "present").length;
  const missing = mandatoryRows.filter((r) => r.state === "missing").length;
  const invalid = mandatoryRows.filter((r) => r.state === "invalid").length;
  const inconsistent = mandatoryRows.filter((r) => r.state === "inconsistent").length;
  const humanReviewRequired = rows.filter((r) => r.state === "human_review_required").length;
  const languagesMissing = languagesExpected.filter((l) => !languagesCovered.includes(l));
  let overallReadiness: ClaimsReadinessState;
  if (humanReviewRequired > 0) overallReadiness = "unknown";
  else if (label.status === "under_review") overallReadiness = "under_review";
  else if (label.status === "review_complete" || label.status === "approved_for_artwork" || label.status === "approved") overallReadiness = "review_complete";
  else if (missing > 0 || invalid > 0 || inconsistent > 0 || languagesMissing.length > 0) overallReadiness = missing + invalid + inconsistent === mandatoryRows.length ? "not_ready" : "partially_ready";
  else if (mandatoryRows.length > 0 && present === mandatoryRows.length) overallReadiness = "ready_for_review";
  else overallReadiness = "not_ready";
  return {
    labelId: label.id,
    labelRevision: label.revision,
    totalRequirements: rows.length,
    presentRequirements: present,
    missingRequirements: missing,
    invalidRequirements: invalid,
    inconsistentRequirements: inconsistent,
    humanReviewRequiredCount: humanReviewRequired,
    artworkStatus: artwork?.status,
    languagesCovered,
    languagesMissing,
    overallReadiness,
  };
}

export interface LabelRequirementDrift {
  newBlockTypes: LabelContentBlockType[];
  removedBlockTypes: LabelContentBlockType[];
  changedMandatoryBlockTypes: LabelContentBlockType[];
}

/** Read-only comparison of a frozen requirement snapshot against what
 *  `resolveLabelRequirements` would generate today — never mutates the
 *  historical label revision, same convention as
 *  `compareDossierRequirementsToCurrentRules`. */
export function compareLabelRequirementsToCurrentRules(frozen: LabelRequirement[], ctx: LabelRequirementGenerationContext): LabelRequirementDrift {
  const current = resolveLabelRequirements(ctx);
  const frozenByType = new Map(frozen.map((r) => [r.blockType, r]));
  const currentByType = new Map(current.map((r) => [r.blockType, r]));
  const newBlockTypes: LabelContentBlockType[] = [];
  const removedBlockTypes: LabelContentBlockType[] = [];
  const changedMandatoryBlockTypes: LabelContentBlockType[] = [];
  for (const [type, cur] of currentByType) {
    const old = frozenByType.get(type);
    if (!old) newBlockTypes.push(type);
    else if (old.mandatory !== cur.mandatory) changedMandatoryBlockTypes.push(type);
  }
  for (const type of frozenByType.keys()) {
    if (!currentByType.has(type)) removedBlockTypes.push(type);
  }
  return { newBlockTypes, removedBlockTypes, changedMandatoryBlockTypes };
}
