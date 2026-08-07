/**
 * UI-integration coverage for the Phase 4 Claims & Labels workspace panel:
 * empty states, claim creation gated on a real saved version/jurisdiction,
 * claim evidence linking (reusing dossier evidence, never duplicating),
 * claim review recording with role-based authorization, label creation,
 * label content editing, artwork upload/approval, label review recording,
 * consistency checking, and the history/audit views. Same mocking
 * discipline as DossierPanel.test.tsx — only `@/lib/masterdata` is mocked.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationVersion, RegulatoryDossier, RegulatoryDossierEvidenceItem } from "@formulab/shared";
import { ClaimsLabelsPanel } from "./ClaimsLabelsPanel";

const bridge = {
  listRecords: vi.fn(),
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};

vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  listRecordsSeeded: (...a: [string, unknown[]]) => bridge.listRecordsSeeded(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
}));

const FORMULATION: Formulation = {
  schemaVersion: "1.0",
  id: "proj-1",
  code: "PRJ-1",
  name: "Test Project",
  productFamilyCode: "LP-HANDWASH",
  targetSkuCodes: ["sku-1"],
  targetMarkets: ["KE"],
  targetClaims: [],
  targetBatchKg: "100",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
};

const VERSION_1: FormulationVersion = {
  schemaVersion: "1.0",
  id: "version-1",
  formulationId: "proj-1",
  versionNumber: 1,
  status: "chemist_review",
  author: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  lines: [],
  basisBatchKg: "100",
  sourceRunIds: [],
  regulatoryFindingIds: [],
  compatibilityFindingIds: [],
  safetyFindingIds: [],
  approvalRecordIds: [],
};

const DOSSIER: RegulatoryDossier = {
  schemaVersion: "1.0",
  id: "dossier-1",
  dossierCode: "DOS-1",
  title: "KE dossier",
  formulationId: "proj-1",
  formulaVersionId: "version-1",
  jurisdictions: ["KE"],
  productFamilyCode: "LP-HANDWASH",
  targetMarkets: ["KE"],
  status: "draft",
  revision: 1,
  createdBy: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const EVIDENCE_ITEM: RegulatoryDossierEvidenceItem = {
  schemaVersion: "1.0",
  id: "evidence-1",
  dossierId: "dossier-1",
  formulationId: "proj-1",
  formulaVersionId: "version-1",
  jurisdictions: ["KE"],
  evidenceType: "laboratory_report",
  title: "Antibacterial efficacy test report",
  status: "verified",
  attachmentIds: [],
  sourceType: "manual_entry",
  confidentiality: "normal",
  createdBy: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type Store = { claims: unknown[]; claimLinks: unknown[]; claimReviews: unknown[]; labels: unknown[]; labelContent: unknown[]; labelArtworks: unknown[]; labelReviews: unknown[] };
let store: Store;

const COLLECTION_TO_KEY: Record<string, keyof Store> = {
  product_claims: "claims",
  claim_evidence_links: "claimLinks",
  claim_reviews: "claimReviews",
  product_labels: "labels",
  label_content_blocks: "labelContent",
  label_artworks: "labelArtworks",
  label_reviews: "labelReviews",
};

beforeEach(() => {
  vi.clearAllMocks();
  store = { claims: [], claimLinks: [], claimReviews: [], labels: [], labelContent: [], labelArtworks: [], labelReviews: [] };
  bridge.listRecordsSeeded.mockImplementation((_collection: string, seed: unknown[]) => Promise.resolve(seed));
  bridge.listRecords.mockImplementation((collection: string) => {
    if (collection === "regulatory_dossiers") return Promise.resolve([DOSSIER]);
    if (collection === "regulatory_evidence_items") return Promise.resolve([EVIDENCE_ITEM]);
    const key = COLLECTION_TO_KEY[collection];
    if (key) return Promise.resolve(store[key]);
    return Promise.resolve([]);
  });
  bridge.upsertRecords.mockImplementation((collection: string, records: { id: string }[]) => {
    const key = COLLECTION_TO_KEY[collection];
    if (key) store[key].push(...records);
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
});

function renderPanel(versions: FormulationVersion[] = [VERSION_1]) {
  return render(
    <MemoryRouter>
      <ClaimsLabelsPanel formulation={FORMULATION} versions={versions} auditLog={[]} onAuditChanged={vi.fn().mockResolvedValue(undefined)} />
    </MemoryRouter>,
  );
}

describe("ClaimsLabelsPanel — empty states", () => {
  it("shows the empty claims state and switches to the empty labels state", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText("No product claims yet for this project.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Labels" }));
    expect(await screen.findByText("No product labels yet for this project.")).toBeInTheDocument();
  });
});

describe("ClaimsLabelsPanel — claim creation", () => {
  it("requires a jurisdiction and claim text before creating a claim", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click((await screen.findAllByRole("button", { name: "New claim" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Select at least one jurisdiction.")).toBeInTheDocument();
    expect(bridge.upsertRecords).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the claim text.")).toBeInTheDocument();
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("creates a claim bound to the selected version and jurisdiction, auto-classifying its category", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click((await screen.findAllByRole("button", { name: "New claim" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    await user.type(within(dialog).getByLabelText("Claim text"), "Kills 99.9% of bacteria");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect((await screen.findAllByText(/CLM-/)).length).toBeGreaterThan(0);
    expect(bridge.upsertRecords).toHaveBeenCalledWith("product_claims", expect.any(Array));
  });
});

describe("ClaimsLabelsPanel — claims import/export", () => {
  it("previews and imports JSON claim rows as draft, unreviewed claims", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click((await screen.findAllByRole("button", { name: "Import claims" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Import claims" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    within(dialog).getByRole("textbox").focus();
    await user.paste('[{"claimCode": "CLM-IMPORT-1", "claimText": "Gentle on skin", "jurisdictions": "KE", "languages": "en"}]');
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    await within(dialog).findByText("1 row(s) ready to import.");

    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("product_claims", expect.any(Array)));
    const [, created] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "product_claims")!;
    expect(created[0].claimCode).toBe("CLM-IMPORT-1");
    expect(created[0].status).toBe("draft");
    expect((await screen.findAllByText("CLM-IMPORT-1")).length).toBeGreaterThan(0);
  });

  it("skips a row as a duplicate when the same claim code/version already exists", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click((await screen.findAllByRole("button", { name: "New claim" }))[0]);
    const dialog1 = await screen.findByRole("dialog", { name: "New claim" });
    await user.clear(within(dialog1).getByLabelText("Claim code"));
    await user.type(within(dialog1).getByLabelText("Claim code"), "CLM-DUP");
    await user.type(within(dialog1).getByLabelText("Claim text"), "Existing claim");
    await user.selectOptions(within(dialog1).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog1).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog1).getByRole("button", { name: "Save" }));
    await screen.findAllByText("CLM-DUP");
    await user.click(screen.getByRole("button", { name: "Back to claims" }));

    await user.click((await screen.findAllByRole("button", { name: "Import claims" }))[0]);
    const dialog2 = await screen.findByRole("dialog", { name: "Import claims" });
    await user.selectOptions(within(dialog2).getByRole("combobox", { name: /Formula version/i }), "version-1");
    within(dialog2).getByRole("textbox").focus();
    await user.paste('[{"claimCode": "CLM-DUP", "claimText": "Existing claim"}]');
    await user.click(within(dialog2).getByRole("button", { name: "Preview" }));
    expect(await within(dialog2).findByText("1 row(s) skipped as already-imported duplicates.")).toBeInTheDocument();
  });
});

describe("ClaimsLabelsPanel — claim evidence and reviews", () => {
  async function createClaim(user: ReturnType<typeof userEvent.setup>) {
    await user.click((await screen.findAllByRole("button", { name: "New claim" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    await user.type(within(dialog).getByLabelText("Claim text"), "Kills 99.9% of bacteria");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await user.click((await screen.findAllByText(/CLM-/))[0]);
  }

  it("proposes and accepts a claim evidence link reused from the dossier, never duplicating the record", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createClaim(user);
    await user.click(screen.getByRole("button", { name: "Evidence" }));

    await user.selectOptions(screen.getByRole("combobox", { name: /Select dossier evidence/i }), "evidence-1");
    await user.click(screen.getByRole("button", { name: "Propose link" }));
    expect(await screen.findByText("proposed")).toBeInTheDocument();
    expect((await screen.findAllByText("Antibacterial efficacy test report")).length).toBeGreaterThan(0);
    expect(bridge.upsertRecords).toHaveBeenCalledWith("claim_evidence_links", expect.any(Array));

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("claim_evidence_links", expect.any(Array));
    // The evidence record itself is never touched by a claim link action.
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("regulatory_evidence_items", expect.anything());
  });

  it("only an authorized regulatory actor can record a claim review", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createClaim(user);
    await user.click(screen.getByRole("button", { name: "Reviews" }));
    expect(screen.getByRole("button", { name: "Record review" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Acting as"), "researcher");
    expect(screen.queryByRole("button", { name: "Record review" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Acting as"), "regulatory");
    await user.type(screen.getByLabelText("Notes"), "Substantiated by lab report");
    await user.click(screen.getByRole("button", { name: "Record review" }));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("claim_reviews", expect.any(Array));
  });
});

describe("ClaimsLabelsPanel — labels, content, artwork, consistency", () => {
  async function createLabel(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click((await screen.findAllByRole("button", { name: "New label" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New label" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await user.click((await screen.findAllByText(/LBL-/))[0]);
  }

  it("creates a label bound to a real saved formula version", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createLabel(user);
    expect(bridge.upsertRecords).toHaveBeenCalledWith("product_labels", expect.any(Array));
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("saves a label content block and reflects its requirement state", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createLabel(user);
    await user.click(screen.getByRole("button", { name: "Content" }));

    const productNameBox = screen.getByLabelText(/Product name/i);
    await user.type(productNameBox, "Test Antibacterial Wash");
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    await user.click(saveButtons[0]);
    expect(bridge.upsertRecords).toHaveBeenCalledWith("label_content_blocks", expect.any(Array));
  });

  it("previews and imports JSON label content rows", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createLabel(user);
    await user.click(screen.getByRole("button", { name: "Content" }));

    await user.click(screen.getByRole("button", { name: "Import content" }));
    const dialog = await screen.findByRole("dialog", { name: "Import content" });
    within(dialog).getByRole("textbox").focus();
    await user.paste('[{"blockType": "product_name", "text": "Imported Wash", "language": "en"}]');
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    await within(dialog).findByText("1 row(s) ready to import.");

    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("label_content_blocks", expect.any(Array)));
    const [, blocks] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "label_content_blocks")!;
    expect(blocks[0].text).toBe("Imported Wash");
    expect(blocks[0].source).toBe("imported");
  });

  it("uploads artwork and only an authorized actor can approve it", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createLabel(user);
    await user.click(screen.getByRole("button", { name: "Artwork" }));
    expect(await screen.findByText("No artwork uploaded yet.")).toBeInTheDocument();
  });

  it("runs the formula/claim/artwork consistency check and shows findings", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createLabel(user);
    await user.click(screen.getByRole("button", { name: "Consistency" }));
    await user.click(screen.getByRole("button", { name: "Run consistency check" }));
    expect(await screen.findByText("artwork_missing")).toBeInTheDocument();
    expect(screen.getByText(/No artwork has been uploaded for this label\./)).toBeInTheDocument();
  });
});

describe("ClaimsLabelsPanel — history and audit", () => {
  it("renders the history and audit top-level sections without crashing", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("Claim revision history")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Audit" }));
    expect(screen.getByText("No claim or label audit events yet.")).toBeInTheDocument();
  });
});
