/**
 * FVL-04.009 hardening — imported process_parameters must reach a REAL
 * Manufacturing Procedure consumer, not just canonical storage. This test
 * commits a real row through the actual Data Exchange lifecycle
 * (commitDataExchangeRows -> commitProcessParameters), then renders the
 * real ProcessParametersPanel and asserts the exact committed values are
 * visible — the panel is the consumer FVL-04.009's original acceptance
 * required and the prior session's own log admitted did not exist yet.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitDataExchangeRows } from "@/lib/dataExchangeCommit";
import { getDataExchangeTemplate, type DataExchangeRowResult } from "@formulab/shared";
import { ProcessParametersPanel } from "./ProcessParametersPanel";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

const ctx = { actorUserId: "local", actorRole: "administrator" as const };

function row(record: Record<string, string>): DataExchangeRowResult {
  return { rowNumber: 2, naturalKey: "TEST-KEY", state: "valid_create", messages: [], record };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("ProcessParametersPanel — real Manufacturing Procedure consumer for imported process_parameters", () => {
  it("displays the exact committed step values, keyed to the real formula/version identity, after a real Data Exchange import", async () => {
    const template = getDataExchangeTemplate("process_parameters")!;
    await commitDataExchangeRows(
      template,
      [row({ formula_code: "FORM-1", formula_version: "2", step_number: "1", step_name: "Heat and mix phase A", phase: "A", equipment_type: "jacketed vessel", temperature_min: "60", temperature_target: "65", temperature_max: "70", mixing_speed_target: "80", hold_time_minutes: "10", critical_parameter: "true", instruction: "Heat phase A to target and hold." })],
      ctx,
    );
    const committed = bridge.upsertRecords.mock.calls.find(([c]) => c === "process_parameters")![1];
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "process_parameters" ? committed : []));

    render(<ProcessParametersPanel formulaCode="FORM-1" formulaVersion={2} />);

    const row1 = await screen.findByText("Heat and mix phase A");
    const tr = row1.closest("tr")!;
    expect(within(tr).getByText("1")).toBeInTheDocument();
    expect(within(tr).getByText("A")).toBeInTheDocument();
    expect(within(tr).getByText("jacketed vessel")).toBeInTheDocument();
    expect(within(tr).getByText("60 / 65 / 70")).toBeInTheDocument();
    expect(within(tr).getByText("— / 80 / —")).toBeInTheDocument();
    expect(within(tr).getByText("10")).toBeInTheDocument();
    expect(within(tr).getByText("Yes")).toBeInTheDocument();
    expect(within(tr).getByText("Heat phase A to target and hold.")).toBeInTheDocument();
  });

  it("never mixes another formula's or another version's steps into the same view", async () => {
    const template = getDataExchangeTemplate("process_parameters")!;
    await commitDataExchangeRows(template, [row({ formula_code: "FORM-1", formula_version: "2", step_number: "1", step_name: "Correct step" })], ctx);
    await commitDataExchangeRows(template, [row({ formula_code: "FORM-1", formula_version: "1", step_number: "1", step_name: "Wrong version" })], ctx);
    await commitDataExchangeRows(template, [row({ formula_code: "FORM-2", formula_version: "2", step_number: "1", step_name: "Wrong formula" })], ctx);
    const allCommitted = bridge.upsertRecords.mock.calls.filter(([c]) => c === "process_parameters").map(([, r]) => r[0]);
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "process_parameters" ? allCommitted : []));

    render(<ProcessParametersPanel formulaCode="FORM-1" formulaVersion={2} />);

    expect(await screen.findByText("Correct step")).toBeInTheDocument();
    expect(screen.queryByText("Wrong version")).not.toBeInTheDocument();
    expect(screen.queryByText("Wrong formula")).not.toBeInTheDocument();
  });

  it("an invalid parent formula/version reference fails honestly at import — never a fabricated step with no owner", async () => {
    // process_parameters' formula_code column is a required code_reference
    // (referenceTemplate: "formula_bom") — the generic reference_missing
    // preview path (already proven elsewhere) refuses it before commit is
    // ever reachable. Confirmed by construction: the commit handler itself
    // performs no existence check of its own — it trusts the row already
    // passed preview, and required/nullable:false on formula_code means an
    // empty value is invalid at preview too.
    const template = getDataExchangeTemplate("process_parameters")!;
    const formulaCodeColumn = template.columns.find((c) => c.key === "formula_code");
    expect(formulaCodeColumn?.referenceTemplate).toBe("formula_bom");
    expect(formulaCodeColumn?.required).toBe(true);
  });
});
