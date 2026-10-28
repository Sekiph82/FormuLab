import { z } from "zod";
import type { RawMaterial } from "./materials";
import { rawMaterialSchema } from "./materials";
import type { IdentityFieldReview } from "./identityFieldReview";
import { identityFieldReviewSchema } from "./identityFieldReview";
import { IDENTITY_REVIEW_FIELDS } from "./identityFieldReview";
import type { ActiveMatterEvidence } from "./activeMatterEvidence";
import { activeMatterEvidenceSchema } from "./activeMatterEvidence";
import type { ApprovalRole } from "./status";
import { getDataExchangeTemplate } from "../engine/dataExchangeRegistry";
import { previewDataExchangeImport, type DataExchangePreview } from "../engine/dataExchangeValidation";

export const RAW_MATERIAL_DATA_EXCHANGE_TEMPLATE = "raw_materials" as const;

const dataExchangeRawMaterialRowSchema = z.object({
  material_code: z.string().trim().min(1),
  material_name: z.string().trim().min(1),
  inci_name: z.string(),
  cas_number: z.string(),
  ec_number: z.string(),
  material_function: z.string(),
  physical_form: z.string(),
  active_matter_percent: z.string(),
  density: z.string(),
  recommended_min_percent: z.string(),
  recommended_max_percent: z.string(),
  technical_max_percent: z.string(),
  manufacturer_name: z.string(),
  country_of_origin: z.string(),
  shelf_life_months: z.string(),
  storage_condition: z.string(),
  notes: z.string(),
}).strict();

function dataExchangeRowFromTarget(target: RawMaterial): z.infer<typeof dataExchangeRawMaterialRowSchema> {
  return {
    material_code: target.code,
    material_name: target.displayName,
    inci_name: target.inciName ?? "",
    cas_number: target.casNumbers.join(";"),
    ec_number: target.ecNumbers.join(";"),
    material_function: target.functions.join(";"),
    physical_form: target.physicalForm ?? "",
    active_matter_percent: target.activeMatterPercent ?? "",
    density: target.density ?? "",
    recommended_min_percent: target.recommendedMinPercent ?? "",
    recommended_max_percent: target.recommendedMaxPercent ?? "",
    technical_max_percent: target.technicalMaxPercent ?? "",
    manufacturer_name: target.manufacturer ?? "",
    country_of_origin: target.countryOfOrigin ?? "",
    shelf_life_months: target.shelfLifeMonths?.toString() ?? "",
    storage_condition: target.storageConditions ?? "",
    notes: target.notes ?? "",
  };
}

export const rawMaterialApplicationProposalSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  targetMaterialCode: z.string().trim().min(1),
  acceptedReviewId: z.string().trim().min(1),
  field: z.enum(IDENTITY_REVIEW_FIELDS),
  proposedValueSnapshot: z.string().min(1),
  targetValueSnapshot: z.string().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  sourceEvidenceRefs: z.array(z.string().trim().min(1)).min(1),
  targetSnapshotUpdatedAt: z.string().trim().min(1),
  status: z.enum(["ready_for_data_exchange_preview", "manual_merge_required", "stale_target_requires_reproposal"]),
  dataExchangeTemplateCode: z.literal(RAW_MATERIAL_DATA_EXCHANGE_TEMPLATE),
  dataExchangeRow: dataExchangeRawMaterialRowSchema.optional(),
  reasonCodes: z.array(z.string().trim().min(1)).min(1),
  requiresHumanDataExchangePreviewAndCommit: z.literal(true),
  autoApplied: z.literal(false),
  autoVerified: z.literal(false),
}).strict().superRefine((proposal, context) => {
  if ((proposal.status === "ready_for_data_exchange_preview") !== Boolean(proposal.dataExchangeRow)) {
    context.addIssue({ code: "custom", path: ["dataExchangeRow"], message: "Only a safe, supported proposal may include a Data Exchange preview row." });
  }
  if (proposal.dataExchangeRow && proposal.dataExchangeRow.material_code !== proposal.targetMaterialCode) {
    context.addIssue({ code: "custom", path: ["dataExchangeRow", "material_code"], message: "Data Exchange proposal row must target the identified RawMaterial." });
  }
  if (proposal.dataExchangeRow && proposal.status === "ready_for_data_exchange_preview") {
    let proposed: Record<string, unknown>;
    let current: Record<string, unknown>;
    try {
      proposed = JSON.parse(proposal.proposedValueSnapshot) as Record<string, unknown>;
      current = JSON.parse(proposal.targetValueSnapshot) as Record<string, unknown>;
    } catch {
      context.addIssue({ code: "custom", path: ["proposedValueSnapshot"], message: "Proposal snapshots must contain valid JSON." });
      return;
    }
    if (proposal.field === "canonical_identity") {
      const expected = dataExchangeRowFromTarget(rawMaterialSchema.parse(current));
      expected.inci_name = typeof proposed.inciName === "string" ? proposed.inciName.trim() : expected.inci_name;
      expected.cas_number = Array.isArray(proposed.casNumbers) ? proposed.casNumbers.join(";") : expected.cas_number;
      expected.ec_number = Array.isArray(proposed.ecNumbers) ? proposed.ecNumbers.join(";") : expected.ec_number;
      if (Object.keys(expected).some((key) => expected[key as keyof typeof expected] !== proposal.dataExchangeRow![key as keyof typeof expected])) {
        context.addIssue({ code: "custom", path: ["dataExchangeRow"], message: "Data Exchange row must preserve the target snapshot and apply only the accepted identity fields." });
      }
    } else if (proposal.field === "active_matter") {
      const acceptedValue = Number(proposed);
      const expected = dataExchangeRowFromTarget(rawMaterialSchema.parse(current));
      expected.active_matter_percent = acceptedValue.toString();
      if (!Number.isFinite(acceptedValue) || Object.keys(expected).some((key) => expected[key as keyof typeof expected] !== proposal.dataExchangeRow![key as keyof typeof expected])) {
        context.addIssue({ code: "custom", path: ["dataExchangeRow"], message: "Data Exchange row must preserve the target snapshot and apply only the accepted active-matter value." });
      }
    } else {
      context.addIssue({ code: "custom", path: ["field"], message: "This field cannot produce a ready Data Exchange proposal." });
    }
  }
});

export type RawMaterialApplicationProposal = z.infer<typeof rawMaterialApplicationProposalSchema>;

function parseSnapshot(review: IdentityFieldReview): unknown {
  return JSON.parse(review.proposedValueSnapshot) as unknown;
}

function unsupportedExistingFields(material: RawMaterial): string[] {
  const fields: Array<[string, unknown]> = [
    ["tradeName", material.tradeName], ["iupacName", material.iupacName], ["appearance", material.appearance],
    ["color", material.color], ["odor", material.odor], ["solidsPercent", material.solidsPercent], ["waterPercent", material.waterPercent],
    ["phMin", material.phMin], ["phMax", material.phMax], ["viscosityMin", material.viscosityMin], ["viscosityMax", material.viscosityMax],
    ["hlb", material.hlb], ["ionicCharacter", material.ionicCharacter], ["solubility", material.solubility],
    ["nonDefaultActiveMatterState", material.activeMatterState !== "known" && material.activeMatterState !== "missing" ? material.activeMatterState : undefined],
    ["inconsistentActiveMatterState", (material.activeMatterState === "known") !== Boolean(material.activeMatterPercent)],
    ["inactiveMaterial", !material.active],
  ];
  return fields.filter(([, value]) => value !== undefined && value !== false && value !== "").map(([name]) => name);
}

/** Prepare an accepted identity/property field proposal for the existing Data Exchange gate; never writes master data. */
export function createRawMaterialApplicationProposal(input: {
  target: RawMaterial;
  review: IdentityFieldReview;
  activeMatterEvidence?: ActiveMatterEvidence;
}): RawMaterialApplicationProposal {
  const target = rawMaterialSchema.parse(input.target);
  const review = identityFieldReviewSchema.parse(input.review);
  if (review.decision !== "accepted" || review.commercialProductId.trim() === "" || review.targetRecordId !== target.code) {
    throw new Error("RawMaterial application requires an accepted field review for this exact target material.");
  }
  const data = dataExchangeRowFromTarget(target);
  const snapshot = parseSnapshot(review);
  const reasonCodes: string[] = [];
  if (review.field === "canonical_identity") {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Accepted canonical identity must be a JSON object of RawMaterial identity fields.");
    const identity = snapshot as { inciName?: unknown; casNumbers?: unknown; ecNumbers?: unknown };
    if (identity.inciName !== undefined) {
      if (typeof identity.inciName !== "string" || !identity.inciName.trim()) throw new Error("Accepted INCI identity must be a non-empty string.");
      data.inci_name = identity.inciName.trim();
    }
    if (identity.casNumbers !== undefined) {
      if (!Array.isArray(identity.casNumbers) || identity.casNumbers.some((value) => typeof value !== "string" || !value.trim())) throw new Error("Accepted CAS identity must be a list of non-empty source values.");
      data.cas_number = identity.casNumbers.map((value) => (value as string).trim()).join(";");
    }
    if (identity.ecNumbers !== undefined) {
      if (!Array.isArray(identity.ecNumbers) || identity.ecNumbers.some((value) => typeof value !== "string" || !value.trim())) throw new Error("Accepted EC identity must be a list of non-empty source values.");
      data.ec_number = identity.ecNumbers.map((value) => (value as string).trim()).join(";");
    }
    if (identity.inciName === undefined && identity.casNumbers === undefined && identity.ecNumbers === undefined) throw new Error("Accepted canonical identity contains no supported RawMaterial identity fields.");
  } else if (review.field === "active_matter") {
    if (!input.activeMatterEvidence) throw new Error("Accepted active-matter proposal requires its source-backed evidence record.");
    const evidence = activeMatterEvidenceSchema.parse(input.activeMatterEvidence);
    if (evidence.commercialProductId !== review.commercialProductId || evidence.sourceEvidenceId !== review.sourceEvidenceId
      || evidence.quantityKind !== "active_matter" || evidence.basis !== "as_supplied"
      || evidence.percent.interpretation !== "exact" || evidence.percent.lowerBound === undefined
      || evidence.percent.upperBound !== evidence.percent.lowerBound || snapshot !== evidence.percent.lowerBound
      || evidence.evidenceRefs.some((ref) => !review.evidenceRefs.includes(ref))) {
      throw new Error("Accepted active-matter value must exactly match its cited as-supplied evidence and human review.");
    }
    data.active_matter_percent = evidence.percent.lowerBound.toString();
  } else {
    reasonCodes.push("field_not_supported_by_raw_materials_data_exchange_mapping");
  }

  if (reasonCodes.length === 0) {
    const unsupported = unsupportedExistingFields(target);
    if (unsupported.length) reasonCodes.push(`data_exchange_update_would_drop_existing_fields:${unsupported.join(",")}`);
  }
  const ready = reasonCodes.length === 0;
  return rawMaterialApplicationProposalSchema.parse({
    schemaVersion: "1.0",
    id: `raw-material-application:${review.id}`,
    commercialProductId: review.commercialProductId,
    targetMaterialCode: target.code,
    acceptedReviewId: review.id,
    field: review.field,
    proposedValueSnapshot: review.proposedValueSnapshot,
  targetValueSnapshot: JSON.stringify(target),
    sourceEvidenceId: review.sourceEvidenceId,
    sourceEvidenceRefs: review.evidenceRefs,
    targetSnapshotUpdatedAt: target.updatedAt,
    status: ready ? "ready_for_data_exchange_preview" : "manual_merge_required",
    dataExchangeTemplateCode: RAW_MATERIAL_DATA_EXCHANGE_TEMPLATE,
    ...(ready ? { dataExchangeRow: data } : {}),
    reasonCodes: ready ? ["accepted_field_proposal_ready_for_existing_data_exchange_preview"] : reasonCodes,
    requiresHumanDataExchangePreviewAndCommit: true,
    autoApplied: false,
    autoVerified: false,
  });
}

/** Mark a proposal stale if the live RawMaterial no longer matches its captured snapshot. */
export function recheckRawMaterialApplicationProposalTarget(
  proposalInput: RawMaterialApplicationProposal,
  currentTargetInput: RawMaterial,
): RawMaterialApplicationProposal {
  const proposal = rawMaterialApplicationProposalSchema.parse(proposalInput);
  const currentTarget = rawMaterialSchema.parse(currentTargetInput);
  if (proposal.targetMaterialCode !== currentTarget.code) throw new Error("Proposal target does not match the supplied RawMaterial.");
  if (proposal.status !== "ready_for_data_exchange_preview") return proposal;
  if (proposal.targetSnapshotUpdatedAt === currentTarget.updatedAt
    && proposal.targetValueSnapshot === JSON.stringify(currentTarget)) return proposal;
  const { dataExchangeRow: _dataExchangeRow, ...staleProposal } = proposal;
  return rawMaterialApplicationProposalSchema.parse({
    ...staleProposal,
    status: "stale_target_requires_reproposal",
    reasonCodes: ["target_material_changed_since_proposal"],
  });
}

/** Create the normal Data Exchange preview for an unchanged proposal; this function never commits rows. */
export function previewRawMaterialApplicationProposal(input: {
  proposal: RawMaterialApplicationProposal;
  currentTarget: RawMaterial;
  acceptedReview: IdentityFieldReview;
  actorRole: ApprovalRole;
}): { status: "previewed" | "manual_merge_required" | "stale_target_requires_reproposal"; proposal: RawMaterialApplicationProposal; preview?: DataExchangePreview } {
  const acceptedReview = identityFieldReviewSchema.parse(input.acceptedReview);
  const suppliedProposal = rawMaterialApplicationProposalSchema.parse(input.proposal);
  if (acceptedReview.id !== suppliedProposal.acceptedReviewId || acceptedReview.decision !== "accepted"
    || acceptedReview.commercialProductId !== suppliedProposal.commercialProductId
    || acceptedReview.sourceEvidenceId !== suppliedProposal.sourceEvidenceId
    || acceptedReview.targetRecordId !== suppliedProposal.targetMaterialCode
    || acceptedReview.field !== suppliedProposal.field
    || acceptedReview.proposedValueSnapshot !== suppliedProposal.proposedValueSnapshot
    || acceptedReview.evidenceRefs.length !== suppliedProposal.sourceEvidenceRefs.length
    || acceptedReview.evidenceRefs.some((ref, index) => ref !== suppliedProposal.sourceEvidenceRefs[index])) {
    throw new Error("The proposal must be validated against its actual accepted identity review record before preview.");
  }
  const proposal = recheckRawMaterialApplicationProposalTarget(input.proposal, input.currentTarget);
  if (proposal.status === "stale_target_requires_reproposal") return { status: proposal.status, proposal };
  if (proposal.status === "manual_merge_required" || !proposal.dataExchangeRow) return { status: "manual_merge_required", proposal };
  const template = getDataExchangeTemplate(RAW_MATERIAL_DATA_EXCHANGE_TEMPLATE);
  if (!template) throw new Error("The existing raw_materials Data Exchange template is unavailable.");
  const headers = Object.keys(proposal.dataExchangeRow);
  const values = headers.map((header) => proposal.dataExchangeRow![header as keyof typeof proposal.dataExchangeRow] ?? "");
  const preview = previewDataExchangeImport(template, [headers, values], {
    actorRole: input.actorRole,
    existingNaturalKeys: new Set([proposal.targetMaterialCode]),
  });
  return { status: "previewed", proposal, preview };
}
