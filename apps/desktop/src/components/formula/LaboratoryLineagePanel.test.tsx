import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LaboratoryLineagePanel } from "./LaboratoryLineagePanel";

const checksum = "a".repeat(64);
const dataset = { algorithm: "sha256", canonicalization: "formulab-canonical-json-v1", digest: "b".repeat(64) };

describe("LaboratoryLineagePanel", () => {
  it("navigates exact saved, measured, model, prediction and ranking records without mutating their source", () => {
    const records = {
      formulations: [{ id: "formula-1", code: "F-1" }],
      formulationVersions: [{ id: "version-1", formulationId: "formula-1", versionNumber: 1 }],
      laboratoryTrials: [{ id: "trial-1", sourceFormulaVersionId: "version-1", status: "completed" }],
      testResults: [{ id: "result-1", trialId: "trial-1", formulaVersionId: "version-1" }],
      predictiveModels: [
        { id: "model-v1", version: 1, schemaVersion: "1.0", productFamilyCode: "SHAMPOO", artifactChecksum: checksum, datasetFingerprint: dataset },
        { id: "model-v2", version: 2, artifactChecksum: "c".repeat(64), datasetFingerprint: { ...dataset, digest: "d".repeat(64) } },
      ],
      rankings: [{ code: "ranking-1", rankings: [{ candidate: { candidateId: "candidate-1", sourceFormulationVersionId: "version-1", dimensions: { performance: { status: "PREDICTED", sourceSnapshot: { modelId: "model-v1", prediction: { status: "PREDICTED", modelId: "model-v1", modelVersion: 1, modelChecksum: checksum, modelArtifactSchemaVersion: "1.0", productFamilyCode: "SHAMPOO", datasetFingerprint: dataset, formulaId: "formula-1", formulaVersionId: "version-1", formulaVersionNumber: 1 } } } } } }] }],
    };
    const before = structuredClone(records);
    render(<LaboratoryLineagePanel records={records} />);

    fireEvent.click(screen.getByRole("button", { name: /prediction_snapshot.*ranking-1\/candidate-1\/performance/i }));
    expect(screen.getByText("exact_model")).toBeInTheDocument();
    expect(screen.getByText("predictive_model:model-v1")).toBeInTheDocument();
    expect(screen.queryByText("predictive_model:model-v2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ranking.*ranking-1/i }));
    expect(screen.getByText("prediction_model")).toBeInTheDocument();
    expect(records).toEqual(before);
  });

  it("shows partial and broken lineage explicitly and never offers a link to a missing record", () => {
    render(<LaboratoryLineagePanel records={{
      laboratoryTrials: [{ id: "trial-partial", sourceFormulaVersionId: "version-missing" }],
      testResults: [{ id: "result-partial", trialId: "trial-partial", formulaVersionId: "version-missing" }],
    }} />);

    fireEvent.click(screen.getByRole("button", { name: /laboratory_trial.*trial-partial/i }));
    expect(screen.getByText("Missing record")).toBeInTheDocument();
    const missingReference = screen.getByText("formulation_version:version-missing").closest("[data-lineage-status]");
    expect(missingReference).toHaveAttribute("data-lineage-status", "missing");
    expect(within(missingReference as HTMLElement).queryByRole("button", { name: "Open record" })).not.toBeInTheDocument();
  });

  it("shows human-gate audit events in the read-only audit context", () => {
    const auditEvents = [
      { id: "audit-1", formulationId: "formula-1", at: "2026-10-22T10:00:00.000Z", actor: "alice", actorKind: "human" as const, action: "doe.recommendation_selected", detail: "Human accepted candidate DOE-C1." },
      { id: "audit-2", formulationId: "formula-1", at: "2026-10-22T10:01:00.000Z", actor: "alice", actorKind: "human" as const, action: "formula.note_updated" },
    ];
    const onSelectVersion = vi.fn();
    render(<LaboratoryLineagePanel records={{ formulationVersions: [{ id: "version-1", formulationId: "formula-1", versionNumber: 1 }] }} auditEvents={auditEvents} onSelectVersion={onSelectVersion} />);

    expect(screen.getByText("doe.recommendation_selected")).toBeInTheDocument();
    expect(screen.queryByText("formula.note_updated")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /formulation_version.*version-1/i }));
    expect(onSelectVersion).toHaveBeenCalledWith("version-1");
  });
});
