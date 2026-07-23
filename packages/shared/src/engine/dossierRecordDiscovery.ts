// Phase 3 §7 — automatic discovery of dossier evidence candidates from
// existing FormuLab records (raw-material documents, laboratory trial/test
// results, stability study/results, packaging compatibility snapshots,
// regulatory reviews, regulatory evidence confirmations).
//
// This module never writes anything. `discoverDossierEvidenceCandidates`
// returns suggestions only — a human decides whether to accept one via
// `candidateToDraftEvidenceInput` + `addDraftEvidence` (which itself still
// requires a human actor and starts the resulting evidence item unverified).
// The source record is only ever referenced (`sourceEntityId`, and — for
// attachments — the exact same `AttachmentReference`), never copied or
// rewritten.
//
// Deliberately NOT covered, and why (documented here rather than silently
// omitted): `Supplier`/`MaterialSupplier` and packaging records
// (`PackagingBom`/`PackagingComponent`) have no document/attachment field in
// their current schema — adding one would be a schema change out of scope
// for wiring discovery, so supplier declarations and artwork can only be
// added as evidence manually (via the Evidence Library) until such a field
// exists. `CostSnapshot` is a cost figure, not documentary regulatory
// evidence, so it is not a discovery source. `ApprovalRecord` is deliberately
// excluded too: an approval record can itself depend on this same dossier
// (see `regulatoryDossierApproval.ts`), and suggesting it back as evidence
// for the dossier that may have gated it would be a circular reference.
import type { RawMaterial } from "../schemas/materials";
import type { LaboratoryTrial } from "../schemas/laboratory";
import type { TestResult } from "../schemas/testDefinitions";
import type { StabilityStudy, StabilityResult } from "../schemas/stability";
import type { CompatibilitySnapshot } from "../schemas/compatibility";
import type { RegulatoryReview, RegulatoryEvidenceConfirmation, RegulatoryJurisdiction } from "../schemas/regulatory";
import type { DossierEvidenceType } from "../schemas/dossier";
import type { AttachmentReference } from "../schemas/testDefinitions";
import type { AddDraftEvidenceInput } from "./regulatoryDossier";

export type DossierEvidenceCandidateSourceKind =
  | "raw_material_document"
  | "laboratory_trial_result"
  | "stability_study_result"
  | "compatibility_snapshot"
  | "regulatory_review"
  | "regulatory_evidence_confirmation";

export interface DossierEvidenceCandidate {
  sourceKind: DossierEvidenceCandidateSourceKind;
  /** The id of the record this candidate was discovered from — becomes
   *  `DossierEvidenceItem.sourceEntityId` if accepted. Never a dossier id. */
  sourceEntityId: string;
  sourceLabel: string;
  evidenceType: DossierEvidenceType;
  documentType?: string;
  title: string;
  description?: string;
  jurisdictions: RegulatoryJurisdiction[];
  /** The exact attachment reference on the source record, if any — reused
   *  by reference (same `id`/`location`), never duplicated as a new file. */
  attachment?: AttachmentReference;
  issuedAt?: string;
  expiresAt?: string;
  /** These three flags are never used to filter a candidate out — a
   *  mismatch must stay visible to the human deciding whether to accept it
   *  (spec §7: "wrong version/jurisdiction/packaging must be shown"). */
  matchesFormulaVersion: boolean;
  matchesPackagingSku: boolean;
  matchesJurisdiction: boolean;
}

export interface DossierEvidenceDiscoveryContext {
  formulationId: string;
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdictions: RegulatoryJurisdiction[];
  /** Material codes actually used in the target formula version's lines —
   *  scopes which raw-material documents are even candidates. */
  formulaVersionMaterialCodes: string[];
  materials?: RawMaterial[];
  laboratoryTrials?: LaboratoryTrial[];
  testResults?: TestResult[];
  stabilityStudies?: StabilityStudy[];
  stabilityResults?: StabilityResult[];
  compatibilitySnapshots?: CompatibilitySnapshot[];
  regulatoryReviews?: RegulatoryReview[];
  regulatoryEvidenceConfirmations?: RegulatoryEvidenceConfirmation[];
}

const DOCUMENT_KIND_TO_EVIDENCE_TYPE: Record<string, DossierEvidenceType> = {
  sds: "sds",
  coa: "coa",
  tds: "technical_data_sheet",
  spec: "specification",
  certificate: "regulatory_certificate",
  other: "other",
};

function jurisdictionsOverlap(a: RegulatoryJurisdiction[], b: RegulatoryJurisdiction[]): boolean {
  return a.some((j) => b.includes(j));
}

export function discoverDossierEvidenceCandidates(ctx: DossierEvidenceDiscoveryContext): DossierEvidenceCandidate[] {
  const candidates: DossierEvidenceCandidate[] = [];
  const materialCodes = new Set(ctx.formulaVersionMaterialCodes);

  for (const material of ctx.materials ?? []) {
    if (!materialCodes.has(material.code)) continue;
    for (const doc of material.documents) {
      candidates.push({
        sourceKind: "raw_material_document",
        sourceEntityId: material.code,
        sourceLabel: `${material.displayName} (${material.code})`,
        evidenceType: DOCUMENT_KIND_TO_EVIDENCE_TYPE[doc.kind] ?? "other",
        documentType: doc.kind,
        title: doc.title,
        jurisdictions: ctx.jurisdictions,
        attachment: { id: `material:${material.code}:${doc.kind}:${doc.title}`, kind: "document", title: doc.title, location: doc.location },
        issuedAt: doc.issuedAt,
        expiresAt: doc.expiresAt,
        // A material document is not itself version-scoped, but it is only a
        // candidate here because the material appears in this exact version's
        // lines — treat that as the version match.
        matchesFormulaVersion: true,
        matchesPackagingSku: true,
        matchesJurisdiction: true,
      });
    }
  }

  const resultsByTrial = new Map<string, TestResult[]>();
  for (const result of ctx.testResults ?? []) {
    const list = resultsByTrial.get(result.trialId) ?? [];
    list.push(result);
    resultsByTrial.set(result.trialId, list);
  }
  for (const trial of ctx.laboratoryTrials ?? []) {
    if (trial.projectId !== ctx.formulationId) continue;
    const matchesFormulaVersion = !trial.sourceFormulaVersionId || trial.sourceFormulaVersionId === ctx.formulaVersionId;
    const matchesPackagingSku = !ctx.packagingSkuCode || trial.targetPackagingSkuIds.length === 0 || trial.targetPackagingSkuIds.includes(ctx.packagingSkuCode);
    for (const result of resultsByTrial.get(trial.id) ?? []) {
      for (const attachment of result.attachments) {
        candidates.push({
          sourceKind: "laboratory_trial_result",
          sourceEntityId: result.id,
          sourceLabel: `Trial ${trial.code} — result ${result.id}`,
          evidenceType: "laboratory_report",
          title: attachment.title,
          jurisdictions: ctx.jurisdictions,
          attachment,
          matchesFormulaVersion,
          matchesPackagingSku,
          matchesJurisdiction: true,
        });
      }
    }
  }

  const resultsByStudy = new Map<string, StabilityResult[]>();
  for (const result of ctx.stabilityResults ?? []) {
    const list = resultsByStudy.get(result.studyId) ?? [];
    list.push(result);
    resultsByStudy.set(result.studyId, list);
  }
  for (const study of ctx.stabilityStudies ?? []) {
    if (study.projectId !== ctx.formulationId) continue;
    const matchesFormulaVersion = !study.sourceFormulaVersionId || study.sourceFormulaVersionId === ctx.formulaVersionId;
    const matchesPackagingSku = !ctx.packagingSkuCode || study.packagingSkuCode === ctx.packagingSkuCode;
    for (const result of resultsByStudy.get(study.id) ?? []) {
      for (const attachment of result.attachments) {
        candidates.push({
          sourceKind: "stability_study_result",
          sourceEntityId: result.id,
          sourceLabel: `Stability study ${study.code} — result ${result.id}`,
          evidenceType: "stability_report",
          title: attachment.title,
          jurisdictions: ctx.jurisdictions,
          attachment,
          matchesFormulaVersion,
          matchesPackagingSku,
          matchesJurisdiction: true,
        });
      }
    }
  }

  for (const snapshot of ctx.compatibilitySnapshots ?? []) {
    if (snapshot.formulationId !== ctx.formulationId) continue;
    candidates.push({
      sourceKind: "compatibility_snapshot",
      sourceEntityId: snapshot.code,
      sourceLabel: `Compatibility snapshot ${snapshot.code} (${snapshot.findings.length} finding${snapshot.findings.length === 1 ? "" : "s"})`,
      evidenceType: "packaging_compatibility_report",
      title: `Packaging compatibility snapshot ${snapshot.code}`,
      description: "No attachment — this evidence references a computed compatibility snapshot's findings, not an uploaded document.",
      jurisdictions: ctx.jurisdictions,
      matchesFormulaVersion: snapshot.versionId === ctx.formulaVersionId,
      matchesPackagingSku: true,
      matchesJurisdiction: true,
    });
  }

  for (const review of ctx.regulatoryReviews ?? []) {
    if (review.formulationId !== ctx.formulationId) continue;
    candidates.push({
      sourceKind: "regulatory_review",
      sourceEntityId: review.id,
      sourceLabel: `Regulatory review by ${review.reviewedBy} (${review.outcome})`,
      evidenceType: "other",
      documentType: "regulatory_review",
      title: `Regulatory review — ${review.outcome}`,
      description: "No attachment — references a recorded human regulatory review, not an uploaded document.",
      jurisdictions: [review.jurisdiction],
      matchesFormulaVersion: review.formulaVersionId === ctx.formulaVersionId,
      matchesPackagingSku: !review.packagingSkuCode || !ctx.packagingSkuCode || review.packagingSkuCode === ctx.packagingSkuCode,
      matchesJurisdiction: jurisdictionsOverlap([review.jurisdiction], ctx.jurisdictions),
    });
  }

  for (const confirmation of ctx.regulatoryEvidenceConfirmations ?? []) {
    if (confirmation.formulationId !== ctx.formulationId) continue;
    candidates.push({
      sourceKind: "regulatory_evidence_confirmation",
      sourceEntityId: confirmation.id,
      sourceLabel: `Evidence confirmation — ${confirmation.requirementCode}`,
      evidenceType: "other",
      documentType: confirmation.requirementType,
      title: `Confirmed requirement — ${confirmation.requirementCode}`,
      description: "No attachment — references a Phase 2 regulatory evidence confirmation record.",
      jurisdictions: [confirmation.jurisdiction],
      matchesFormulaVersion: confirmation.formulaVersionId === ctx.formulaVersionId,
      matchesPackagingSku: !confirmation.packagingSkuCode || !ctx.packagingSkuCode || confirmation.packagingSkuCode === ctx.packagingSkuCode,
      matchesJurisdiction: jurisdictionsOverlap([confirmation.jurisdiction], ctx.jurisdictions),
    });
  }

  return candidates;
}

/** Turns an accepted suggestion into the input `addDraftEvidence` expects.
 *  Still requires a human actor and still starts unverified — acceptance of
 *  a suggestion is never itself a verification. */
export function candidateToDraftEvidenceInput(
  candidate: DossierEvidenceCandidate,
  dossier: { id: string; formulationId: string; formulaVersionId: string; packagingSkuCode?: string },
): AddDraftEvidenceInput {
  return {
    dossierId: dossier.id,
    formulationId: dossier.formulationId,
    formulaVersionId: dossier.formulaVersionId,
    packagingSkuCode: dossier.packagingSkuCode,
    jurisdictions: candidate.jurisdictions,
    evidenceType: candidate.evidenceType,
    documentType: candidate.documentType,
    title: candidate.title,
    description: candidate.description,
    sourceType: "formulab_record",
    sourceEntityId: candidate.sourceEntityId,
    attachmentIds: candidate.attachment ? [candidate.attachment] : [],
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
  };
}
