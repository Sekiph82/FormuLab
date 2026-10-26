import { describe, expect, it } from "vitest";
import { createActiveMatterEvidence, type AuthorizedProductClaimInput } from "./activeMatterEvidence";
import { recordIdentityFieldReview } from "./identityFieldReview";
import { createRawMaterialApplicationProposal, previewRawMaterialApplicationProposal, rawMaterialApplicationProposalSchema } from "./rawMaterialApplicationProposal";
import { rawMaterialSchema } from "./materials";
import type { Actor } from "./status";

const actor: Actor = { kind: "human", role: "raw_material", userId: "material-reviewer" };
const target = (overrides: Record<string, unknown> = {}) => rawMaterialSchema.parse({
  schemaVersion: "1.0", code: "MAT-1", displayName: "Decyl Glucoside", casNumbers: [], ecNumbers: [], functions: [],
  activeMatterState: "missing", documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [], incompatibilities: [],
  substituteCodes: [], active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-10-26T09:00:00.000Z", ...overrides,
});
const review = (field: "canonical_identity" | "active_matter" | "alias", value: unknown, sourceEvidenceId = "sds-1", evidenceRefs = ["sds:p2:l4"]) => recordIdentityFieldReview({
  id: `review-${field}`, commercialProductId: "product-1", sourceEvidenceId, targetRecordId: "MAT-1", field,
  decision: "accepted", proposedValueSnapshot: JSON.stringify(value), evidenceRefs, reviewedAt: "2026-10-26T09:00:00.000Z",
}, actor);

describe("RawMaterial application proposal", () => {
  it("prepares and previews a complete existing Data Exchange row for explicitly accepted supported identity fields", () => {
    const acceptedReview = review("canonical_identity", { inciName: "Decyl Glucoside", casNumbers: ["68515-73-1"], ecNumbers: ["500-220-1"] });
    const proposal = createRawMaterialApplicationProposal({
      target: target({ functions: ["nonionic_surfactant"], density: "1.05", storageConditions: "Below 25 C" }),
      review: acceptedReview,
    });
    expect(proposal).toMatchObject({
      status: "ready_for_data_exchange_preview", dataExchangeTemplateCode: "raw_materials",
      field: "canonical_identity", acceptedReviewId: "review-canonical_identity",
      dataExchangeRow: { material_code: "MAT-1", inci_name: "Decyl Glucoside", cas_number: "68515-73-1", ec_number: "500-220-1", material_function: "nonionic_surfactant", density: "1.05" },
      requiresHumanDataExchangePreviewAndCommit: true, autoApplied: false, autoVerified: false,
    });
    const dataExchange = previewRawMaterialApplicationProposal({ proposal, acceptedReview, currentTarget: target({ functions: ["nonionic_surfactant"], density: "1.05", storageConditions: "Below 25 C" }), actorRole: "administrator" });
    expect(dataExchange.status).toBe("previewed");
    expect(dataExchange.preview?.fatalError).toBeUndefined();
    expect(dataExchange.preview?.rows[0]).toMatchObject({ state: "valid_update" });
    expect(dataExchange.preview).toMatchObject({ templateCode: "raw_materials", updates: 1, validRows: 1, invalidRows: 0 });
    expect(() => rawMaterialApplicationProposalSchema.parse({
      ...proposal,
      dataExchangeRow: { ...proposal.dataExchangeRow, cas_number: "999-99-9" },
    })).toThrow(/preserve the target snapshot and apply only the accepted identity fields/);
    expect(() => previewRawMaterialApplicationProposal({ proposal, acceptedReview: review("canonical_identity", { inciName: "Other" }), currentTarget: target({ functions: ["nonionic_surfactant"], density: "1.05", storageConditions: "Below 25 C" }), actorRole: "administrator" }))
      .toThrow(/actual accepted identity review record/);
  });

  it("allows only exact, cited, as-supplied active matter and keeps the Data Exchange human gate", () => {
    const claim: AuthorizedProductClaimInput = {
      schemaVersion: "1.0", id: "active-1", commercialProductId: "product-1", sourceDocumentType: "TDS",
      sourceDocumentHash: "a".repeat(64), sourceEvidenceId: "tds-1", sourceFactId: "active-fact", quantityKind: "active_matter",
      explicitPropertyLabel: "Active matter as supplied", originalValue: "50%", basis: "as_supplied", evidenceRefs: ["tds:p2:l4"],
    };
    const evidence = createActiveMatterEvidence(claim);
    const proposal = createRawMaterialApplicationProposal({
      target: target(), review: review("active_matter", 50, "tds-1", ["tds:p2:l4"]), activeMatterEvidence: evidence,
    });
    expect(proposal.dataExchangeRow?.active_matter_percent).toBe("50");
    expect(proposal.autoApplied).toBe(false);
    expect(() => createRawMaterialApplicationProposal({
      target: target(), review: review("active_matter", 49, "tds-1", ["tds:p2:l4"]), activeMatterEvidence: evidence,
    })).toThrow(/exactly match/);
  });

  it("routes unsupported fields or lossy Data Exchange updates to manual merge without a commit row", () => {
    const unsupportedField = createRawMaterialApplicationProposal({ target: target(), review: review("alias", { value: "alternate name" }) });
    expect(unsupportedField.status).toBe("manual_merge_required");
    expect(unsupportedField).not.toHaveProperty("dataExchangeRow");
    const lossy = createRawMaterialApplicationProposal({ target: target({ appearance: "clear liquid" }), review: review("canonical_identity", { inciName: "Decyl Glucoside" }) });
    expect(lossy.status).toBe("manual_merge_required");
    expect(lossy.reasonCodes[0]).toContain("appearance");
  });

  it("requires a fresh target snapshot before creating the Data Exchange preview", () => {
    const original = target();
    const acceptedReview = review("canonical_identity", { inciName: "Decyl Glucoside" });
    const proposal = createRawMaterialApplicationProposal({ target: original, review: acceptedReview });
    const current = target({ density: "1.05", updatedAt: "2026-10-26T10:00:00.000Z" });
    const result = previewRawMaterialApplicationProposal({ proposal, acceptedReview, currentTarget: current, actorRole: "administrator" });
    expect(result.status).toBe("stale_target_requires_reproposal");
    expect(result.preview).toBeUndefined();
    expect(result.proposal).not.toHaveProperty("dataExchangeRow");
  });
});
