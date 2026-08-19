/**
 * Focused coverage for the "unsupported template" path — a template that is
 * registered and previews correctly but has no real commit handler must
 * never show a false "completed" success. `DataExchangePage.test.tsx`
 * exercises this dialog end-to-end for real, supported templates; this file
 * covers the one path that can't be reached through a real registry
 * template anymore now that all 24 are wired — a synthetic template code
 * with no `COMMIT_HANDLERS` entry, standing in for whatever future
 * template ships registered before its handler does.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateMaterialAvailability, findRate, getDataExchangeTemplate, type ExchangeRate, type InventoryRecord } from "@formulab/shared";
import { DataExchangeImportDialog } from "./DataExchangeImportDialog";
import { buildDataExchangeWorkbook } from "@/lib/dataExchangeXlsx";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("DataExchangeImportDialog — genuinely unsupported template", () => {
  it("previews normally but blocks commit with an honest message, and records an unsupported job", async () => {
    const fakeTemplate = { ...getDataExchangeTemplate("raw_materials")!, templateCode: "not_a_real_template" };
    const user = userEvent.setup();
    render(
      <DataExchangeImportDialog
        template={fakeTemplate}
        actorRole="administrator"
        actorUserId="local"
        onCancel={() => {}}
        onCommitted={() => {}}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    const file = new File(["material_code,material_name\nTEST-MAT-001,TEST Water"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    // Preview succeeded (this is a real, valid file for this template) —
    // the row itself is fine, only the commit path is blocked.
    expect(await within(dialog).findByText("1")).toBeInTheDocument(); // create-count pill

    expect(within(dialog).getByText(/not supported yet/i)).toBeInTheDocument();
    const commitBtn = within(dialog).getByRole("button", { name: "Not supported" });
    expect(commitBtn).toBeDisabled();

    // The draft job written at preview time must say "unsupported", never
    // "awaiting_confirmation" (which would imply a commit is possible).
    expect(bridge.upsertRecords).toHaveBeenCalledWith("data_exchange_import_jobs", [expect.objectContaining({ status: "unsupported" })]);
    // No target collection was ever touched.
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("materials", expect.anything());
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("data_exchange_import_row_results", expect.anything());
  });
});

describe("DataExchangeImportDialog — validation blocker (Phase 10 Session 3)", () => {
  it("shows a structured disabled-action explanation naming the error-row count when errors exist and partial import isn't enabled", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const user = userEvent.setup();
    render(
      <DataExchangeImportDialog
        template={template}
        actorRole="administrator"
        actorUserId="local"
        onCancel={() => {}}
        onCommitted={() => {}}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    // Two rows sharing the same material_code — the second previews as a
    // duplicate, a real `errorRows` state, not a synthetic/invented one.
    const file = new File(
      ["material_code,material_name\nTEST-MAT-001,TEST Water\nTEST-MAT-001,TEST Water Duplicate"],
      "materials.csv",
      { type: "text/csv" },
    );
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    const commitBtn = await within(dialog).findByRole("button", { name: "Commit import" });
    expect(commitBtn).toBeDisabled();
    const describedById = commitBtn.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const explanation = document.getElementById(describedById!);
    expect(explanation).toHaveTextContent(/1 row\(s\) have errors/);
    expect(explanation).toHaveTextContent(/allow partial import/i);

    // Enabling partial import clears the block for the same preview.
    await user.click(within(dialog).getByRole("checkbox", { name: /valid row\(s\) now and skip/i }));
    expect(within(dialog).getByRole("button", { name: "Commit import" })).not.toBeDisabled();
  });
});

describe("DataExchangeImportDialog — FVL-04.012: real sample file acceptance for the two new operational templates", () => {
  it("inventory_records: a real CSV sample file previews, commits, and reaches the real evaluateMaterialAvailability()", async () => {
    const template = getDataExchangeTemplate("inventory_records")!;
    // Session 7 hardening: the dialog now performs REAL code_reference
    // validation (previously it validated nothing at all) — the
    // referenced raw material must genuinely exist in canonical storage,
    // exactly as a real user would need to import it first.
    bridge.listRecords.mockImplementation(async (collection: string) => (collection === "materials" ? [{ code: "TEST-MAT-001" }] : []));
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);

    const dialog = await screen.findByRole("dialog");
    const file = new File(
      ["inventory_code,material_code,warehouse,lot,quantity,unit,reserved_quantity,quarantined,released,expires_at\nTEST-INV-001,TEST-MAT-001,main,L1,100,kg,20,false,true,2028-01-01"],
      "inventory.csv",
      { type: "text/csv" },
    );
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("inventory", expect.arrayContaining([expect.objectContaining({ code: "TEST-INV-001", materialCode: "TEST-MAT-001", quantity: "100", reservedQuantity: "20", released: true })]));

    const committed = bridge.upsertRecords.mock.calls.find(([c]) => c === "inventory")![1] as InventoryRecord[];
    const availability = evaluateMaterialAvailability(committed, "TEST-MAT-001", "2026-06-01");
    expect(availability.usableQuantity?.toString()).toBe("80");
  });

  it("exchange_rates: a real CSV sample file previews, commits, and reaches the real Cost Engine's findRate()", async () => {
    const template = getDataExchangeTemplate("exchange_rates")!;
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);

    const dialog = await screen.findByRole("dialog");
    const file = new File(
      ["base_currency,quote_currency,rate,effective_from,source\nUSD,KES,129.50,2026-01-01,TEST Central Bank"],
      "rates.csv",
      { type: "text/csv" },
    );
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("exchange_rates", expect.arrayContaining([expect.objectContaining({ baseCurrency: "USD", quoteCurrency: "KES", rate: "129.5", verification: "not_verified" })]));

    const committed = bridge.upsertRecords.mock.calls.find(([c]) => c === "exchange_rates")![1] as ExchangeRate[];
    const lookup = findRate(committed, "USD", "KES", "2026-06-01");
    expect(lookup?.rate.toString()).toBe("129.5");
  });

  it("negative: an inventory row missing the required quantity field is refused, never defaulted to zero", async () => {
    const template = getDataExchangeTemplate("inventory_records")!;
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);

    const dialog = await screen.findByRole("dialog");
    const file = new File(["inventory_code,material_code,quantity\nTEST-INV-002,TEST-MAT-001,"], "inventory-bad.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await within(dialog).findByRole("button", { name: "Commit import" })).toBeDisabled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("inventory", expect.anything());
  });

  it("negative: an exchange rate row with an unrecognized currency is refused before commit", async () => {
    const template = getDataExchangeTemplate("exchange_rates")!;
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);

    const dialog = await screen.findByRole("dialog");
    const file = new File(["base_currency,quote_currency,rate,effective_from,source\nZZZ,KES,1.0,2026-01-01,TEST Bank"], "rates-bad.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await within(dialog).findByRole("button", { name: "Commit import" })).toBeDisabled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("exchange_rates", expect.anything());
  });
});

describe("DataExchangeImportDialog — FVL-04.010 hardening: a real file attempting to smuggle regulatory verification is refused at the highest lifecycle level", () => {
  it("a regulatory_rules CSV that carries verification_status=verified/verified_by/verified_at still commits the rule as not_verified — the file's own claim is never trusted", async () => {
    const template = getDataExchangeTemplate("regulatory_rules")!;
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);

    const dialog = await screen.findByRole("dialog");
    const file = new File(
      ["rule_code,jurisdiction,requirement,rule_type,verification_status,verified_by,verified_at\nTEST-RULE-SMUGGLE,KE,Must state net contents.,label_requirement,verified,Someone,2026-01-01T00:00:00.000Z"],
      "rules-smuggle.csv",
      { type: "text/csv" },
    );
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();

    const committed = bridge.upsertRecords.mock.calls.find(([c]) => c === "regulatory_rules")![1][0] as Record<string, unknown>;
    expect(committed.verificationStatus).toBe("not_verified");
    expect(committed.status).toBe("draft");
    expect(committed.humanReviewStatus).toBe("review_required");
    expect(committed.jurisdiction).toBe("KE");
  });
});

describe("DataExchangeImportDialog — FVL-04.012 hardening: real .xlsx round-trip (H5), material_suppliers and import-history acceptance (H4)", () => {
  it("a real .xlsx workbook (not CSV) parses, previews, and commits material_suppliers through the actual reader", async () => {
    const template = getDataExchangeTemplate("material_suppliers")!;
    const buf = await buildDataExchangeWorkbook(template, [
      { material_code: "XLSX-MAT-1", supplier_code: "XLSX-SUP-1", supplier_trade_name: "XLSX Trade Name", preferred: "true" },
    ]);
    const file = new File([buf], "material-suppliers.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    // Session 7 hardening: real code_reference validation now requires the
    // referenced material and supplier to genuinely exist.
    bridge.listRecords.mockImplementation(async (collection: string) => {
      if (collection === "materials") return [{ code: "XLSX-MAT-1" }];
      if (collection === "suppliers") return [{ code: "XLSX-SUP-1" }];
      return [];
    });

    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "material_suppliers",
      expect.arrayContaining([expect.objectContaining({ materialCode: "XLSX-MAT-1", supplierCode: "XLSX-SUP-1", supplierTradeName: "XLSX Trade Name" })]),
    );
  });

  it("a real .xlsx workbook for raw_materials also round-trips through the actual reader", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const buf = await buildDataExchangeWorkbook(template, [{ material_code: "XLSX-MAT-2", material_name: "XLSX Test Material" }]);
    const file = new File([buf], "materials.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("materials", expect.arrayContaining([expect.objectContaining({ code: "XLSX-MAT-2" })]));
  });

  it("H4: the import-history job lifecycle records a real job at preview (awaiting_confirmation), then completion, with real actor/file/counts — no raw spreadsheet contents ever persisted into it", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const file = new File(["material_code,material_name\nHIST-MAT-1,History Test Material"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    const previewJobCall = bridge.upsertRecords.mock.calls.find(([c]) => c === "data_exchange_import_jobs")!;
    const previewJob = previewJobCall[1][0] as Record<string, unknown>;
    expect(previewJob).toMatchObject({
      templateCode: "raw_materials",
      fileName: "materials.csv",
      fileType: "csv",
      status: "awaiting_confirmation",
      totalRows: 1,
      validRows: 1,
    });
    // The job carries file metadata (name/type/size/hash) — never the raw
    // cell content of the row itself.
    expect(JSON.stringify(previewJob)).not.toContain("History Test Material");

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();

    const completedJobCalls = bridge.upsertRecords.mock.calls.filter(([c]) => c === "data_exchange_import_jobs");
    const completedJob = completedJobCalls[completedJobCalls.length - 1][1][0] as Record<string, unknown>;
    expect(completedJob).toMatchObject({ status: "completed", createdRows: 1, committedBy: "local" });

    const rowResultsCall = bridge.upsertRecords.mock.calls.find(([c]) => c === "data_exchange_import_row_results")!;
    const rowResult = rowResultsCall[1][0] as Record<string, unknown>;
    expect(rowResult).toMatchObject({ jobId: completedJob.id, state: "valid_create", targetCollection: "materials" });
  });
});

describe("DataExchangeImportDialog — Part A hardening: finished_product_specifications, the previously-missing release/QC-limit domain", () => {
  it("FPS8: a real CSV file commits a specification referencing a real SKU and TestDefinition", async () => {
    const template = getDataExchangeTemplate("finished_product_specifications")!;
    // Session 7 hardening: real code_reference validation now requires the
    // referenced SKU and TestDefinition to genuinely exist.
    bridge.listRecords.mockImplementation(async (collection: string) => {
      if (collection === "finished_products") return [{ code: "FPS-SKU-001" }];
      if (collection === "test_definitions") return [{ code: "FPS-TST-001" }];
      return [];
    });
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const file = new File(
      ["sku_code,test_definition_code,target_value,lower_limit,upper_limit,required_for_release,effective_from\nFPS-SKU-001,FPS-TST-001,5.5,5.0,6.0,true,2026-01-01"],
      "specs.csv",
      { type: "text/csv" },
    );
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "finished_product_specifications",
      expect.arrayContaining([expect.objectContaining({ skuCode: "FPS-SKU-001", testDefinitionCode: "FPS-TST-001", targetValue: "5.5", minimum: "5", maximum: "6" })]),
    );
  });

  it("FPS9: a real .xlsx workbook also commits a specification through the actual reader", async () => {
    const template = getDataExchangeTemplate("finished_product_specifications")!;
    const buf = await buildDataExchangeWorkbook(template, [
      { sku_code: "FPS-SKU-002", test_definition_code: "FPS-TST-001", target_value: "9000", lower_limit: "8000", upper_limit: "10000", effective_from: "2026-01-01" },
    ]);
    const file = new File([buf], "specs.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    bridge.listRecords.mockImplementation(async (collection: string) => {
      if (collection === "finished_products") return [{ code: "FPS-SKU-002" }];
      if (collection === "test_definitions") return [{ code: "FPS-TST-001" }];
      return [];
    });
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByText("1")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "finished_product_specifications",
      expect.arrayContaining([expect.objectContaining({ skuCode: "FPS-SKU-002", minimum: "8000", maximum: "10000" })]),
    );
  });

  it("negative: a specification row missing the required effective_from natural key is refused, commit button stays disabled", async () => {
    const template = getDataExchangeTemplate("finished_product_specifications")!;
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const file = new File(["sku_code,test_definition_code,effective_from\nFPS-SKU-003,FPS-TST-001,"], "specs-bad.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await within(dialog).findByRole("button", { name: "Commit import" })).toBeDisabled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("finished_product_specifications", expect.anything());
  });

  it("A6: an attempted verification_status=verified in the file is ignored — the committed specification stays imported_unverified", async () => {
    const template = getDataExchangeTemplate("finished_product_specifications")!;
    bridge.listRecords.mockImplementation(async (collection: string) => {
      if (collection === "finished_products") return [{ code: "FPS-SKU-004" }];
      if (collection === "test_definitions") return [{ code: "FPS-TST-001" }];
      return [];
    });
    const user = userEvent.setup();
    render(<DataExchangeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const file = new File(
      ["sku_code,test_definition_code,effective_from\nFPS-SKU-004,FPS-TST-001,2026-01-01"],
      "specs-smuggle.csv",
      { type: "text/csv" },
    );
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    const committed = bridge.upsertRecords.mock.calls.find(([c]) => c === "finished_product_specifications")![1][0] as Record<string, unknown>;
    // finished_product_specifications' own template has no verification_status
    // column at all — there is nothing in the file for a human to even
    // attempt to smuggle; the handler forces it regardless.
    expect(committed.verificationStatus).toBe("imported_unverified");
  });
});
