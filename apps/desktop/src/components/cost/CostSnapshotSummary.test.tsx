import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CostSnapshot } from "@formulab/shared";
import { CostSnapshotSummary } from "./CostSnapshotSummary";

function snapshot(over: Partial<CostSnapshot> = {}): CostSnapshot {
  return {
    schemaVersion: "1.0",
    code: "live",
    formulationId: "sess-1",
    versionId: "v1",
    currency: "KES",
    batchKg: "100",
    calculatedAt: "2026-07-19T00:00:00Z",
    calculatedBy: "local",
    priceRecordCodes: [],
    exchangeRateCodes: [],
    packagingComponentCodes: [],
    lines: [],
    skuCosts: [],
    missingDataWarnings: [],
    totalManufacturingCost: "123.45",
    rawMaterialCost: "100.00",
    ...over,
  };
}

describe("CostSnapshotSummary — FVL-03.003", () => {
  it("renders a not-yet-available state without a snapshot", () => {
    render(<CostSnapshotSummary snapshot={undefined} currency="KES" />);
    expect(screen.queryByText(/123\.45/)).not.toBeInTheDocument();
  });

  it("renders the real total from a complete snapshot", () => {
    render(<CostSnapshotSummary snapshot={snapshot()} currency="KES" />);
    expect(screen.getByText(/123\.45/)).toBeInTheDocument();
  });

  it("shows missing-data warnings when the snapshot is incomplete, never hides them", () => {
    render(
      <CostSnapshotSummary
        snapshot={snapshot({ missingDataWarnings: ["Phenoxyethanol: no price on record"] })}
        currency="KES"
      />,
    );
    expect(screen.getByText(/no price on record/)).toBeInTheDocument();
  });
});
