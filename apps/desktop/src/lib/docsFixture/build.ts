/**
 * Phase 10 Session 5 — the documentation fixture's data. A pure, deterministic
 * builder: no `Date.now()`, no `Math.random()`, no filesystem access. Every
 * record is either a real, already-existing catalog entry (`HC-SHAMPOO-REG`,
 * `raw_materials`) or a literal built directly against — and validated
 * against — the real Zod schema from `@formulab/shared`, the same schemas
 * `masterdata.rs`'s collections and `formulation_v2.rs`'s project layout
 * actually read. Never derived from a real user's project (see
 * `docs/handoffs/PHASE10_CURRENT.md`'s Session 5 summary for why this file
 * exists instead of copying `data/formulations/*` from the dev's own
 * checkout).
 *
 * The output is a flat map of project-root-relative path -> content. `.json`
 * values are plain objects/arrays (the writer serializes them); `.md`/`.jsonl`
 * values are already-formatted strings. This mirrors exactly what
 * `masterdata.rs`/`formulation_v2.rs` read: one JSON array per
 * `data/master/<collection>.json`, one `data/formulations/<id>/` folder per
 * project, one `data/sessions/<id>/` folder per saved session.
 */
import {
  formulationSchema,
  formulationVersionSchema,
  approvalRecordSchema,
  auditEventSchema,
  rawMaterialSchema,
  materialPriceSchema,
  testDefinitionSchema,
  laboratoryStandardSchema,
  laboratoryTestMethodSchema,
  laboratoryTrialSchema,
  stabilityStudySchema,
  stabilitySampleSchema,
  regulatoryDossierSchema,
  regulatoryDossierRequirementSchema,
  regulatoryDossierEvidenceItemSchema,
  regulatoryRequirementEvidenceLinkSchema,
  productClaimSchema,
  productLabelSchema,
  doeStudySchema,
  doeFactorSchema,
  doeResponseSchema,
  dataExchangeImportJobSchema,
  snapshotFormulaForTrial,
  type Formulation,
  type FormulationLine,
  type FormulationVersion,
} from "@formulab/shared";

/** Every generated id/code/name that stands for "this is fixture content,
 *  never mistake it for a real record" carries this prefix — same
 *  convention Data Exchange's own synthetic rows already use (`TEST-`),
 *  just for documentation rather than import-preview fixtures. */
export const DOCS_FIXTURE_PREFIX = "DEMO-";

/** One fixed instant for every timestamp in the fixture. Not "today" on
 *  purpose — a deterministic fixture must never depend on when it was
 *  built. */
export const DOCS_FIXTURE_FIXED_ISO = "2026-01-01T00:00:00.000Z";

export const DOCS_FIXTURE_PROJECT_ID = "demo-formulation-anti-dandruff-shampoo";
export const DOCS_FIXTURE_VERSION_ID = "demo-version-1";
export const DOCS_FIXTURE_APPROVAL_ID = "demo-approval-1";
export const DOCS_FIXTURE_SESSION_ID = "2026-01-01-0000-demo-anti-dandruff-shampoo";

/** Real Kenya catalog product family — `packages/shared/src/catalog/kenya.ts`
 *  — reused rather than invented, matching every other module's "use the
 *  real catalog" discipline in this codebase. */
const PRODUCT_FAMILY_CODE = "HC-SHAMPOO-REG";

export interface DocsFixturePlan {
  /** Project-root-relative path (forward slashes) -> content. `.json`
   *  entries are plain values (the writer serializes them); `.md`/`.jsonl`
   *  entries are pre-formatted strings. */
  files: Record<string, unknown>;
}

function demoLine(
  id: string,
  lineNumber: number,
  materialCode: string,
  displayName: string,
  functions: FormulationLine["functions"],
  percent: string,
  opts: Partial<FormulationLine> = {},
): FormulationLine {
  return {
    id,
    lineNumber,
    phase: "A",
    materialCode,
    displayName,
    functions,
    percent,
    isQsToHundred: false,
    provenance: { origin: "chemist_override", evidenceClaimIds: [] },
    ...opts,
  };
}

function demoFormulationLines(): FormulationLine[] {
  return [
    demoLine("demo-line-water", 1, `${DOCS_FIXTURE_PREFIX}MAT-WATER`, "DEMO Water", ["water"], "68.5", { isQsToHundred: true }),
    demoLine("demo-line-sles", 2, `${DOCS_FIXTURE_PREFIX}MAT-SLES`, "DEMO Sodium Laureth Sulfate", ["anionic_surfactant"], "12.0", { activeMatterPercent: "70.00" }),
    demoLine("demo-line-capb", 3, `${DOCS_FIXTURE_PREFIX}MAT-CAPB`, "DEMO Cocamidopropyl Betaine", ["amphoteric_surfactant"], "6.0", { activeMatterPercent: "30.00" }),
    demoLine("demo-line-zpto", 4, `${DOCS_FIXTURE_PREFIX}MAT-ZPTO`, "DEMO Zinc Pyrithione", ["conditioning_agent"], "1.0"),
    demoLine("demo-line-glycerin", 5, `${DOCS_FIXTURE_PREFIX}MAT-GLYCERIN`, "DEMO Glycerin", ["humectant"], "2.0"),
    demoLine("demo-line-preservative", 6, `${DOCS_FIXTURE_PREFIX}MAT-PRESERVATIVE`, "DEMO Preservative Blend", ["preservative"], "0.5"),
    demoLine("demo-line-fragrance", 7, `${DOCS_FIXTURE_PREFIX}MAT-FRAGRANCE`, "DEMO Fragrance", ["fragrance"], "0.5"),
    // Deliberately no `functions` — exercises the real "unclassified" state
    // FormulaBuilder's group-totals badges show, not a fabricated one.
    demoLine("demo-line-citric", 8, `${DOCS_FIXTURE_PREFIX}MAT-CITRIC`, "DEMO Citric Acid", [], "9.5"),
  ];
}

function buildFormulation(): Formulation {
  const f: Formulation = {
    schemaVersion: "1.0",
    id: DOCS_FIXTURE_PROJECT_ID,
    code: `${DOCS_FIXTURE_PREFIX}SHAMPOO-001`,
    name: `${DOCS_FIXTURE_PREFIX}Anti-Dandruff Shampoo`,
    productFamilyCode: PRODUCT_FAMILY_CODE,
    targetSkuCodes: [`${DOCS_FIXTURE_PREFIX}SKU-500ML`],
    targetMarkets: ["KE"],
    brief: "Documentation fixture project — synthetic, never a real formulation.",
    targetClaims: [`${DOCS_FIXTURE_PREFIX}gentle-daily-use`],
    targetBatchKg: "100",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
    currentVersionId: DOCS_FIXTURE_VERSION_ID,
    archived: false,
  };
  return formulationSchema.parse(f);
}

function buildFormulationVersion(): FormulationVersion {
  const lines = demoFormulationLines();
  const v: FormulationVersion = {
    schemaVersion: "1.0",
    id: DOCS_FIXTURE_VERSION_ID,
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    versionNumber: 1,
    versionLabel: "0.1",
    status: "chemist_review",
    author: "local",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    changeReason: "Initial documentation fixture version.",
    lines,
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [DOCS_FIXTURE_APPROVAL_ID],
  };
  return formulationVersionSchema.parse(v);
}

function buildApprovalRecord() {
  return approvalRecordSchema.parse({
    schemaVersion: "1.0",
    id: DOCS_FIXTURE_APPROVAL_ID,
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    versionId: DOCS_FIXTURE_VERSION_ID,
    status: "pilot_approved",
    decision: "approved",
    previousStatus: "chemist_review",
    requestedStatus: "pilot_approved",
    approvedBy: `${DOCS_FIXTURE_PREFIX}Reviewer`,
    approvedByRole: "chemist",
    approvedAt: DOCS_FIXTURE_FIXED_ISO,
    justification: "Documentation fixture — pilot-approved for screenshot purposes only.",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
  });
}

function buildAuditLine(): string {
  const event = auditEventSchema.parse({
    id: "demo-audit-1",
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    versionId: DOCS_FIXTURE_VERSION_ID,
    at: DOCS_FIXTURE_FIXED_ISO,
    actor: `${DOCS_FIXTURE_PREFIX}Reviewer`,
    actorKind: "human",
    action: "version.saved",
    detail: "Documentation fixture — initial version.",
  });
  return `${JSON.stringify(event)}\n`;
}

// --------------------------------------------------------------- session ---

function buildSessionFiles(): Record<string, string> {
  const brief = {
    brief: {
      target: "DEMO anti-dandruff shampoo",
      category: "shampoo",
      audience: "unspecified",
      market: "kenya",
    },
  };
  function card(version: string, note: string, ingredients: { name: string; weight_pct: string; function: string }[]): string {
    const rows = ingredients.map((i) => `| ${i.name} | ${i.weight_pct}% | ${i.function} |`).join("\n");
    return [
      `# DEMO Candidate ${version.toUpperCase()}`,
      "",
      note,
      "",
      "## Formula",
      "",
      "| Ingredient | % | Function |",
      "|---|---|---|",
      rows,
      "",
    ].join("\n");
  }
  return {
    [`data/sessions/${DOCS_FIXTURE_SESSION_ID}/brief.json`]: `${JSON.stringify(brief, null, 2)}\n`,
    [`data/sessions/${DOCS_FIXTURE_SESSION_ID}/Formulation_Card_${DOCS_FIXTURE_SESSION_ID}_v1.md`]: card("v1", "Sulfate-based, cost-optimized.", [
      { name: "Water", weight_pct: "70", function: "solvent" },
      { name: "Sodium Laureth Sulfate", weight_pct: "12", function: "anionic surfactant" },
      { name: "Cocamidopropyl Betaine", weight_pct: "6", function: "amphoteric surfactant" },
      { name: "Zinc Pyrithione", weight_pct: "1", function: "conditioning agent" },
    ]),
    [`data/sessions/${DOCS_FIXTURE_SESSION_ID}/Formulation_Card_${DOCS_FIXTURE_SESSION_ID}_v2.md`]: card("v2", "Sulfate-free, milder surfactant system.", [
      { name: "Water", weight_pct: "75", function: "solvent" },
      { name: "Coco Glucoside", weight_pct: "10", function: "nonionic surfactant" },
      { name: "Cocamidopropyl Betaine", weight_pct: "8", function: "amphoteric surfactant" },
      { name: "Zinc Pyrithione", weight_pct: "1", function: "conditioning agent" },
    ]),
    [`data/sessions/${DOCS_FIXTURE_SESSION_ID}/Formulation_Card_${DOCS_FIXTURE_SESSION_ID}_v3.md`]: card("v3", "Higher-actives variant — carries an unresolved validation warning by design (a real, honest fixture state, not a fabricated pass).", [
      { name: "Water", weight_pct: "60", function: "solvent" },
      { name: "Sodium Laureth Sulfate", weight_pct: "15", function: "anionic surfactant" },
      { name: "Zinc Pyrithione", weight_pct: "2", function: "conditioning agent" },
    ]),
  };
}

// -------------------------------------------------------------- master data ---

function buildMaterials() {
  const now = DOCS_FIXTURE_FIXED_ISO;
  const base = (code: string, displayName: string, functions: string[]) =>
    rawMaterialSchema.parse({
      schemaVersion: "1.0",
      code,
      displayName,
      casNumbers: [],
      ecNumbers: [],
      functions,
      activeMatterState: "missing",
      documents: [],
      regulatoryStatuses: [],
      hazardClassifications: [],
      allergens: [],
      incompatibilities: [],
      substituteCodes: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  return [
    base(`${DOCS_FIXTURE_PREFIX}MAT-SLES`, "DEMO Sodium Laureth Sulfate", ["anionic_surfactant"]),
    base(`${DOCS_FIXTURE_PREFIX}MAT-CAPB`, "DEMO Cocamidopropyl Betaine", ["amphoteric_surfactant"]),
    base(`${DOCS_FIXTURE_PREFIX}MAT-ZPTO`, "DEMO Zinc Pyrithione", ["conditioning_agent"]),
  ];
}

function buildMaterialPrices() {
  return [
    materialPriceSchema.parse({
      schemaVersion: "1.0",
      code: `${DOCS_FIXTURE_PREFIX}PRICE-SLES-1`,
      materialCode: `${DOCS_FIXTURE_PREFIX}MAT-SLES`,
      price: "450.00",
      currency: "KES",
      priceUnit: "kg",
      effectiveFrom: DOCS_FIXTURE_FIXED_ISO,
      recordedAt: DOCS_FIXTURE_FIXED_ISO,
    }),
  ];
}

function buildTestDefinitions() {
  const now = DOCS_FIXTURE_FIXED_ISO;
  return [
    testDefinitionSchema.parse({
      schemaVersion: "1.0",
      code: `${DOCS_FIXTURE_PREFIX}TEST-PH`,
      name: "DEMO pH",
      category: "physical_chemical",
      resultType: "numeric",
      replicatesRequired: 1,
      requiredEquipment: [],
      requiredAttachment: false,
      applicableProductFamilies: [],
      applicableProductSkus: [],
      criticalTestFlag: false,
      verificationStatus: "not_verified",
      active: true,
      createdAt: now,
      updatedAt: now,
    }),
    testDefinitionSchema.parse({
      schemaVersion: "1.0",
      code: `${DOCS_FIXTURE_PREFIX}TEST-VISCOSITY`,
      name: "DEMO Viscosity",
      category: "physical_chemical",
      resultType: "numeric",
      unit: "cP",
      replicatesRequired: 2,
      requiredEquipment: [],
      requiredAttachment: false,
      applicableProductFamilies: [],
      applicableProductSkus: [],
      criticalTestFlag: false,
      verificationStatus: "not_verified",
      active: true,
      createdAt: now,
      updatedAt: now,
    }),
  ];
}

function buildLaboratoryStandardAndMethod() {
  const now = DOCS_FIXTURE_FIXED_ISO;
  const standard = laboratoryStandardSchema.parse({
    schemaVersion: "1.0",
    id: "demo-standard-1",
    standardCode: `${DOCS_FIXTURE_PREFIX}ISO-4316`,
    title: "DEMO Determination of pH",
    issuingOrganization: "ISO",
    status: "active",
    jurisdiction: [],
    applicableProductCategories: [],
    createdAt: now,
    updatedAt: now,
  });
  const method = laboratoryTestMethodSchema.parse({
    schemaVersion: "1.0",
    id: "demo-method-1",
    testDefinitionCode: `${DOCS_FIXTURE_PREFIX}TEST-PH`,
    standardId: "demo-standard-1",
    methodName: "DEMO pH determination",
    assignmentType: "primary",
    status: "active",
    requiredEquipment: [],
    reagentsAndConsumables: [],
    instrumentSettings: [],
    procedureSteps: [],
    safetyWarnings: [],
    relatedTestDefinitionCodes: [],
    createdAt: now,
    updatedAt: now,
    updatedBy: "local",
  });
  return { standard, method };
}

/** `snapshotFormulaForTrial`/`snapshotFormulaForStability` are real engine
 *  functions, reused for their actual copy-semantics — but both stamp
 *  `capturedAt` with `new Date().toISOString()`, which would break
 *  determinism, so the fixed instant is substituted in afterward. */
function demoFormulaSnapshot() {
  return { ...snapshotFormulaForTrial({ lines: demoFormulationLines(), basisBatchKg: "100" }), capturedAt: DOCS_FIXTURE_FIXED_ISO };
}

function buildLaboratoryTrial() {
  return laboratoryTrialSchema.parse({
    schemaVersion: "1.0",
    id: "demo-trial-1",
    code: `${DOCS_FIXTURE_PREFIX}TRIAL-001`,
    projectId: DOCS_FIXTURE_PROJECT_ID,
    sourceType: "saved_version",
    sourceFormulaVersionId: DOCS_FIXTURE_VERSION_ID,
    formulaSnapshot: demoFormulaSnapshot(),
    productFamilyId: PRODUCT_FAMILY_CODE,
    targetPackagingSkuIds: [],
    title: `${DOCS_FIXTURE_PREFIX}Anti-dandruff shampoo trial`,
    batchSize: "1",
    batchUnit: "kg",
    status: "planned",
    priority: "normal",
    equipmentIds: [],
    materialUsage: [],
    processSteps: [],
    observations: [],
    hasOpenCriticalDeviation: false,
    createdBy: "local",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
  });
}

function buildStabilityStudyAndSample() {
  const study = stabilityStudySchema.parse({
    schemaVersion: "1.0",
    id: "demo-stability-study-1",
    code: `${DOCS_FIXTURE_PREFIX}STAB-001`,
    projectId: DOCS_FIXTURE_PROJECT_ID,
    sourceType: "saved_version",
    sourceFormulaVersionId: DOCS_FIXTURE_VERSION_ID,
    formulaSnapshot: demoFormulaSnapshot(),
    productFamilyId: PRODUCT_FAMILY_CODE,
    packagingSkuCode: `${DOCS_FIXTURE_PREFIX}SKU-500ML`,
    packagingSnapshot: { skuCode: `${DOCS_FIXTURE_PREFIX}SKU-500ML`, lines: [], capturedAt: DOCS_FIXTURE_FIXED_ISO },
    title: `${DOCS_FIXTURE_PREFIX}Shampoo stability study`,
    owner: "local",
    status: "active",
    startDate: DOCS_FIXTURE_FIXED_ISO,
    conditionIds: [],
    timePointIds: [],
    requiredTestDefinitionIds: [],
    replicatesPerPullPoint: 1,
    hasOpenCriticalFailure: false,
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    createdBy: "local",
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const sample = stabilitySampleSchema.parse({
    schemaVersion: "1.0",
    id: "demo-stability-sample-1",
    sampleCode: `${DOCS_FIXTURE_PREFIX}STAB-001-S1`,
    studyId: study.id,
    conditionId: "demo-condition-25c",
    timePointId: "demo-timepoint-initial",
    packagingSkuCode: `${DOCS_FIXTURE_PREFIX}SKU-500ML`,
    replicateNumber: 1,
    status: "stored",
    testDefinitionIds: [],
    createdAt: DOCS_FIXTURE_FIXED_ISO,
  });
  return { study, sample };
}

function buildDossierBundle() {
  const dossier = regulatoryDossierSchema.parse({
    schemaVersion: "1.0",
    id: "demo-dossier-1",
    dossierCode: `${DOCS_FIXTURE_PREFIX}DOS-001`,
    title: `${DOCS_FIXTURE_PREFIX}Shampoo dossier — Kenya`,
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    formulaVersionId: DOCS_FIXTURE_VERSION_ID,
    packagingSkuCode: `${DOCS_FIXTURE_PREFIX}SKU-500ML`,
    jurisdictions: ["KE"],
    productFamilyCode: PRODUCT_FAMILY_CODE,
    targetMarkets: ["KE"],
    status: "draft",
    revision: 1,
    createdBy: "local",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const requirementSatisfied = regulatoryDossierRequirementSchema.parse({
    schemaVersion: "1.0",
    id: "demo-requirement-1",
    dossierId: dossier.id,
    dossierRevision: 1,
    jurisdiction: "KE",
    requirementCode: `${DOCS_FIXTURE_PREFIX}REQ-SDS`,
    requirementType: "document",
    title: "DEMO Safety Data Sheet",
    isManual: false,
    mandatory: true,
    critical: false,
    applicabilityStatus: "applicable",
    applicabilityReason: "Documentation fixture — always applicable to this product family.",
    evidenceRequirement: true,
    documentTypesAccepted: ["sds"],
    minimumEvidenceCount: 1,
    status: "active",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const requirementMissing = regulatoryDossierRequirementSchema.parse({
    schemaVersion: "1.0",
    id: "demo-requirement-2",
    dossierId: dossier.id,
    dossierRevision: 1,
    jurisdiction: "KE",
    requirementCode: `${DOCS_FIXTURE_PREFIX}REQ-STABILITY`,
    requirementType: "stability_evidence",
    title: "DEMO Stability report",
    isManual: false,
    mandatory: true,
    critical: false,
    applicabilityStatus: "applicable",
    applicabilityReason: "Documentation fixture — always applicable to this product family.",
    evidenceRequirement: true,
    documentTypesAccepted: ["stability_report"],
    minimumEvidenceCount: 1,
    status: "active",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const evidence = regulatoryDossierEvidenceItemSchema.parse({
    schemaVersion: "1.0",
    id: "demo-evidence-1",
    dossierId: dossier.id,
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    formulaVersionId: DOCS_FIXTURE_VERSION_ID,
    jurisdictions: ["KE"],
    evidenceType: "sds",
    title: "DEMO Safety Data Sheet v1",
    status: "present_unverified",
    sourceType: "manual_entry",
    attachmentIds: [],
    confidentiality: "normal",
    createdBy: "local",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const link = regulatoryRequirementEvidenceLinkSchema.parse({
    schemaVersion: "1.0",
    id: "demo-link-1",
    dossierId: dossier.id,
    requirementId: requirementSatisfied.id,
    evidenceItemId: evidence.id,
    linkStatus: "accepted",
    linkedBy: "local",
    linkedAt: DOCS_FIXTURE_FIXED_ISO,
  });
  return { dossier, requirements: [requirementSatisfied, requirementMissing], evidence: [evidence], links: [link] };
}

function buildClaimsAndLabels() {
  const claim = productClaimSchema.parse({
    schemaVersion: "1.0",
    id: "demo-claim-1",
    claimCode: `${DOCS_FIXTURE_PREFIX}CLAIM-GENTLE`,
    claimText: "Gentle enough for daily use",
    normalizedClaim: "gentle enough for daily use",
    claimCategory: "performance",
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    formulaVersionId: DOCS_FIXTURE_VERSION_ID,
    jurisdictions: ["KE"],
    languages: ["en"],
    status: "draft",
    riskLevel: "unknown",
    proposedBy: "local",
    proposedAt: DOCS_FIXTURE_FIXED_ISO,
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const label = productLabelSchema.parse({
    schemaVersion: "1.0",
    id: "demo-label-1",
    labelCode: `${DOCS_FIXTURE_PREFIX}LABEL-001`,
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    formulaVersionId: DOCS_FIXTURE_VERSION_ID,
    jurisdiction: "KE",
    language: "en",
    status: "draft",
    revision: 1,
    createdBy: "local",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
  });
  return { claim, label };
}

function buildDoeBundle() {
  const study = doeStudySchema.parse({
    schemaVersion: "1.0",
    id: "demo-doe-study-1",
    studyCode: `${DOCS_FIXTURE_PREFIX}DOE-001`,
    title: `${DOCS_FIXTURE_PREFIX}Surfactant ratio screening`,
    projectId: DOCS_FIXTURE_PROJECT_ID,
    formulationId: DOCS_FIXTURE_PROJECT_ID,
    baselineFormulaVersionId: DOCS_FIXTURE_VERSION_ID,
    status: "design_ready",
    designType: "two_level_factorial",
    revision: 1,
    createdBy: "local",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
    updatedAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const factorSles = doeFactorSchema.parse({
    schemaVersion: "1.0",
    id: "demo-doe-factor-sles",
    studyId: study.id,
    studyRevision: 1,
    factorCode: "SLES",
    name: "DEMO SLES percent",
    factorType: "continuous",
    sourceType: "formula_material",
    sourceEntityId: `${DOCS_FIXTURE_PREFIX}MAT-SLES`,
    lowValue: "8",
    highValue: "14",
    categoricalLevels: [],
    createdAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const factorCapb = doeFactorSchema.parse({
    schemaVersion: "1.0",
    id: "demo-doe-factor-capb",
    studyId: study.id,
    studyRevision: 1,
    factorCode: "CAPB",
    name: "DEMO CAPB percent",
    factorType: "continuous",
    sourceType: "formula_material",
    sourceEntityId: `${DOCS_FIXTURE_PREFIX}MAT-CAPB`,
    lowValue: "4",
    highValue: "8",
    categoricalLevels: [],
    createdAt: DOCS_FIXTURE_FIXED_ISO,
  });
  const response = doeResponseSchema.parse({
    schemaVersion: "1.0",
    id: "demo-doe-response-1",
    studyId: study.id,
    studyRevision: 1,
    responseCode: "FOAM_HEIGHT",
    name: "DEMO Foam height",
    responseType: "continuous",
    unit: "mm",
    objective: "maximize",
    weight: "1",
    desirabilityShape: "linear",
    createdAt: DOCS_FIXTURE_FIXED_ISO,
  });
  return { study, factors: [factorSles, factorCapb], responses: [response] };
}

function buildDataExchangeImportJob() {
  return dataExchangeImportJobSchema.parse({
    schemaVersion: "1.0",
    id: "demo-import-job-1",
    templateCode: "raw_materials",
    templateSchemaVersion: "1.0",
    fileName: "DEMO-raw-materials.csv",
    fileType: "csv",
    fileSize: 512,
    sha256: "0".repeat(64),
    status: "completed",
    mode: "atomic",
    totalRows: 3,
    validRows: 3,
    invalidRows: 0,
    createdRows: 3,
    updatedRows: 0,
    unchangedRows: 0,
    duplicateRows: 0,
    warningRows: 0,
    startedBy: "local",
    startedAt: DOCS_FIXTURE_FIXED_ISO,
    committedBy: "local",
    committedAt: DOCS_FIXTURE_FIXED_ISO,
    completedAt: DOCS_FIXTURE_FIXED_ISO,
  });
}

/** Build the entire fixture plan. Pure and deterministic — calling this
 *  twice always produces byte-identical `JSON.stringify` output for every
 *  entry, which `build.test.ts` asserts directly. */
export function buildDocsFixturePlan(): DocsFixturePlan {
  const formulation = buildFormulation();
  const version = buildFormulationVersion();
  const approval = buildApprovalRecord();
  const { standard, method } = buildLaboratoryStandardAndMethod();
  const { study: stabilityStudy, sample: stabilitySample } = buildStabilityStudyAndSample();
  const dossierBundle = buildDossierBundle();
  const { claim, label } = buildClaimsAndLabels();
  const doeBundle = buildDoeBundle();

  const files: Record<string, unknown> = {
    "formulas/index.json": [],
    [`data/formulations/${DOCS_FIXTURE_PROJECT_ID}/formulation.json`]: formulation,
    [`data/formulations/${DOCS_FIXTURE_PROJECT_ID}/versions/${DOCS_FIXTURE_VERSION_ID}.json`]: version,
    [`data/formulations/${DOCS_FIXTURE_PROJECT_ID}/approvals/${DOCS_FIXTURE_APPROVAL_ID}.json`]: approval,
    [`data/formulations/${DOCS_FIXTURE_PROJECT_ID}/audit.jsonl`]: buildAuditLine(),
    ...buildSessionFiles(),
    "data/master/materials.json": buildMaterials(),
    "data/master/material_prices.json": buildMaterialPrices(),
    "data/master/test_definitions.json": buildTestDefinitions(),
    "data/master/laboratory_standards.json": [standard],
    "data/master/laboratory_test_methods.json": [method],
    "data/master/laboratory_trials.json": [buildLaboratoryTrial()],
    "data/master/stability_studies.json": [stabilityStudy],
    "data/master/stability_samples.json": [stabilitySample],
    "data/master/regulatory_dossiers.json": [dossierBundle.dossier],
    "data/master/regulatory_dossier_requirements.json": dossierBundle.requirements,
    "data/master/regulatory_evidence_items.json": dossierBundle.evidence,
    "data/master/regulatory_requirement_evidence_links.json": dossierBundle.links,
    "data/master/product_claims.json": [claim],
    "data/master/product_labels.json": [label],
    "data/master/doe_studies.json": [doeBundle.study],
    "data/master/doe_factors.json": doeBundle.factors,
    "data/master/doe_responses.json": doeBundle.responses,
    "data/master/data_exchange_import_jobs.json": [buildDataExchangeImportJob()],
  };

  return { files };
}
