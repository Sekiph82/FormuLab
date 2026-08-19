/**
 * Data Exchange Center — existing-record lookups for preview classification
 * and current-data export.
 *
 * Two things every template needs that only live data can answer: "which
 * natural keys already exist?" (so preview can tell create from update) and
 * "what does the current data look like as a flat row?" (for current-data
 * export). Both are per-template because every target collection has its
 * own field names — but, like the commit layer, this stays one small
 * lookup table rather than 24 bespoke exporters.
 *
 * All 24 templates have a loader, and every natural-key column round-trips
 * for real. A few non-key columns still can't: `packaging_bom` dropped
 * several columns from the template entirely (see its loader comment
 * below) rather than present them as decorative, and
 * `artwork_register`'s width/height/dimension_unit are parsed back out of
 * the one combined `dimensions` string the real workspace editor writes —
 * see its loader comment for the exact contract. See
 * docs/DATA_EXCHANGE_EXPORTS.md.
 */
import { SEED_STABILITY_CONDITIONS, SEED_STABILITY_TIME_POINTS } from "@formulab/shared";
import { listRecords, type Collection } from "./masterdata";
import { listFormulations, readFormulation } from "./formulations";

export interface ExistingLookup {
  /** Natural keys already present, for create-vs-update classification. */
  naturalKeys: Set<string>;
  /** Current records flattened to template rows, for current-data export. */
  rows: Record<string, string>[];
}

const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const j = (v: unknown): string => (Array.isArray(v) ? v.join(";") : s(v));

type Loader = () => Promise<ExistingLookup>;

async function flat(collection: Collection, keyField: string, toRow: (r: Record<string, unknown>) => Record<string, string>): Promise<ExistingLookup> {
  const records = (await listRecords(collection)) as unknown as Record<string, unknown>[];
  return {
    naturalKeys: new Set(records.map((r) => s(r[keyField]))),
    rows: records.map(toRow),
  };
}

const LOADERS: Partial<Record<string, Loader>> = {
  raw_materials: () =>
    flat("materials", "code", (r) => ({
      material_code: s(r.code),
      material_name: s(r.displayName),
      inci_name: s(r.inciName),
      cas_number: j(r.casNumbers),
      ec_number: j(r.ecNumbers),
      manufacturer_name: s(r.manufacturer),
      country_of_origin: s(r.countryOfOrigin),
      physical_form: s(r.physicalForm),
      active_matter_percent: s(r.activeMatterPercent),
      density: s(r.density),
      storage_condition: s(r.storageConditions),
      shelf_life_months: s(r.shelfLifeMonths),
      notes: s(r.notes),
    })),
  suppliers: () =>
    flat("suppliers", "code", (r) => ({
      supplier_code: s(r.code),
      supplier_name: s(r.displayName),
      legal_name: s(r.legalName),
      country: s(r.country),
      contact_name: s(r.contactPerson),
      email: s(r.email),
      phone: s(r.phone),
      currency: s(r.currency),
      payment_terms: s(r.paymentTerms),
      lead_time_days: s(r.defaultLeadTimeDays),
      approved_supplier: s(r.approved),
      qualification_status: s(r.qualityStatus),
      notes: s(r.notes),
    })),
  material_prices: () =>
    flat("material_prices", "code", (r) => ({
      material_code: s(r.materialCode),
      supplier_code: s(r.supplierCode),
      currency: s(r.currency),
      unit_price: s(r.price),
      price_unit: s(r.priceUnit),
      minimum_order_quantity: s(r.moq),
      valid_from: s(r.effectiveFrom),
      valid_until: s(r.effectiveTo),
      incoterm: s(r.incoterm),
      notes: s(r.notes),
    })),
  material_documents: () =>
    flat("material_documents", "code", (r) => ({
      material_code: s(r.materialCode),
      supplier_code: s(r.supplierCode),
      document_type: s(r.documentType),
      document_number: s(r.documentNumber),
      document_title: s(r.documentTitle),
      revision: s(r.revision),
      language: s(r.language),
      issuer: s(r.issuer),
      issue_date: s(r.issueDate),
      expiry_date: s(r.expiryDate),
      file_name: s(r.fileName),
      verification_status: s(r.verificationStatus),
      tags: j(r.tags),
      notes: s(r.notes),
    })),
  product_families: () =>
    flat("product_families", "code", (r) => ({
      family_code: s(r.code),
      family_name: s(r.name),
      category: s(r.category),
      subcategory: s(r.subcategory),
      default_unit: s(r.defaultUnit),
      default_batch_size: s(r.defaultBatchSize),
      target_market: s(r.targetMarket),
      default_jurisdictions: j(r.defaultJurisdictions),
      default_packaging_type: s(r.defaultPackagingType),
      active: s(r.active),
      tags: j(r.tags),
      notes: s(r.notes),
    })),
  finished_products: () =>
    flat("finished_products", "code", (r) => ({
      sku_code: s(r.code),
      sku_name: s(r.name),
      product_family_code: s(r.productFamilyCode),
      brand: s(r.brand),
      formula_code: s(r.formulaCode),
      formula_version: s(r.formulaVersion),
      packaging_sku_code: s(r.packagingSkuCode),
      net_quantity: s(r.netQuantity),
      quantity_unit: s(r.quantityUnit),
      barcode: s(r.barcode),
      target_markets: j(r.targetMarkets),
      languages: j(r.languages),
      status: s(r.status),
      manufacture_site: s(r.manufactureSite),
      shelf_life_months: s(r.shelfLifeMonths),
      tags: j(r.tags),
      notes: s(r.notes),
    })),
  packaging_components: () =>
    flat("packaging_components", "code", (r) => ({
      component_code: s(r.code),
      component_name: s(r.description),
      component_type: s(r.componentType),
      supplier_code: s(r.supplierCode),
      unit_price: s(r.unitPrice),
      currency: s(r.currency),
      minimum_order_quantity: s(r.moq),
      weight: s(r.weightG),
      material_type: s(r.materialType),
      notes: s(r.notes),
    })),
  // `PackagingBom` stores one header row (`skuCode`/`description`/
  // `fillQuantity`/`fillUnit`/`productFamilyCode`/`tags`/`notes`) plus a
  // `lines` array. `product_family_code` and `tags` round-trip for real.
  // `quantity_unit`, `unit_cost`/`currency`, `primary`/`secondary`/
  // `tertiary_packaging`, `fill_weight`, `line_code` and
  // `effective_from`/`until` were removed from the template (see
  // `PACKAGING_BOM_COLUMNS` in dataExchangeRegistry.ts) because they were
  // never real, round-trippable data on this schema: unit/cost/currency
  // are the referenced `packaging_components` record's own live values
  // (PackagingBomEditor derives `currency` from the component, never
  // stores its own copy — duplicating it here would silently go stale),
  // and the packaging/fill-weight/line/date fields have no equivalent
  // anywhere in this domain.
  packaging_bom: async () => {
    const boms = (await listRecords("packaging_boms")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const bom of boms) {
      const skuCode = s(bom.skuCode);
      const lines = (bom.lines as { componentCode?: string; quantityPerUnit?: string; notes?: string }[] | undefined) ?? [];
      for (const line of lines) {
        const componentCode = s(line.componentCode);
        naturalKeys.add(`${skuCode}::${componentCode}`);
        rows.push({
          packaging_sku_code: skuCode,
          packaging_sku_name: s(bom.description),
          product_family_code: s(bom.productFamilyCode),
          component_code: componentCode,
          component_quantity: s(line.quantityPerUnit),
          fill_volume: s(bom.fillQuantity),
          tags: j(bom.tags),
          notes: s(line.notes ?? bom.notes),
        });
      }
    }
    return { naturalKeys, rows };
  },
  process_parameters: () =>
    flat("process_parameters", "code", (r) => ({
      formula_code: s(r.formulaCode),
      formula_version: s(r.formulaVersion),
      step_number: s(r.stepNumber),
      step_name: s(r.stepName),
      phase: s(r.phase),
      equipment_type: s(r.equipmentType),
      temperature_min: s(r.temperatureMin),
      temperature_target: s(r.temperatureTarget),
      temperature_max: s(r.temperatureMax),
      critical_parameter: s(r.criticalParameter),
      instruction: s(r.instruction),
      notes: s(r.notes),
    })),
  costing_assumptions: () =>
    flat("factory_profiles", "code", (r) => ({
      costing_profile_code: s(r.code),
      currency: s(r.currency),
      effective_date: s(r.effectiveFrom),
      labor_cost_per_hour: s(r.directLabourPerHour),
      energy_cost_per_kwh: s(r.electricityPerKwh),
      water_cost_per_m3: s(r.waterPerM3),
      steam_cost_per_kg: s(r.steamPerKg),
      overhead_percent: s(r.overheadPercent),
      manufacturing_loss_percent: s(r.processLossPercent),
      freight_percent: s(r.freightPercent),
      duty_percent: s(r.dutyPercent),
      tax_percent: s(r.taxPercent),
      target_margin_percent: s(r.targetMarginPercent),
      notes: s(r.notes),
    })),
  formula_cost_overrides: () =>
    flat("formula_cost_overrides", "code", (r) => ({
      formula_code: s(r.formulaCode),
      formula_version: s(r.formulaVersion),
      material_code: s(r.materialCode),
      supplier_code: s(r.supplierCode),
      override_price: s(r.overridePrice),
      currency: s(r.currency),
      price_unit: s(r.priceUnit),
      effective_from: s(r.effectiveFrom),
      effective_until: s(r.effectiveUntil),
      reason: s(r.reason),
      notes: s(r.notes),
    })),
  test_definitions: () =>
    flat("test_definitions", "code", (r) => ({
      test_code: s(r.code),
      test_name: s(r.name),
      test_category: s(r.category),
      method_reference: s(r.methodReference),
      unit: s(r.unit),
      result_type: s(r.resultType),
      lower_limit: s(r.minimum),
      target_value: s(r.targetValue),
      upper_limit: s(r.maximum),
      replicate_count: s(r.replicatesRequired),
      required_for_release: s(r.requiredByDefault),
      active: s(r.active),
    })),
  // One row per (trial, sample, test, replicate) — matches the template's
  // natural key exactly, same join-across-collections shape as the
  // stability loaders below.
  lab_results: async () => {
    const results = (await listRecords("test_results")) as unknown as Record<string, unknown>[];
    const trials = (await listRecords("laboratory_trials")) as unknown as Record<string, unknown>[];
    const testDefs = (await listRecords("test_definitions")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const result of results) {
      const trial = trials.find((t) => t.id === result.trialId);
      // `test_definitions` records have no separate `id` — `result.testDefinitionId`
      // is already the code (see `commitLabResults`), so match on `code`.
      const testDef = testDefs.find((td) => td.code === result.testDefinitionId);
      if (!trial || !testDef) continue;
      const trialCode = s(trial.code);
      const testCode = s(testDef.code);
      const sampleCode = s(result.sampleId);
      const replicates = (result.replicates as { replicateNumber?: number; numericValue?: string; textValue?: string }[] | undefined) ?? [];
      for (const rep of replicates) {
        const replicateNumber = s(rep.replicateNumber);
        naturalKeys.add(`${trialCode}::${sampleCode}::${testCode}::${replicateNumber}`);
        rows.push({
          trial_code: trialCode,
          sample_code: sampleCode,
          test_code: testCode,
          replicate_number: replicateNumber,
          numeric_value: s(rep.numericValue),
          text_value: s(rep.textValue),
          unit: s(result.unit),
          result_date: s(result.performedAt),
          analyst: s(result.performedBy),
          notes: s(result.notes),
        });
      }
    }
    return { naturalKeys, rows };
  },
  regulatory_rules: () =>
    flat("regulatory_rules", "code", (r) => ({
      rule_code: s(r.code),
      jurisdiction: s(r.jurisdiction),
      authority: s(r.authority),
      rule_type: s(r.ruleType),
      requirement: s(r.requirement),
      severity: s(r.severity),
      mandatory: s(r.requiresRegistration),
      effective_date: s(r.effectiveDate),
      expiry_date: s(r.expiryDate),
      verification_status: s(r.verificationStatus),
      verified_by: s(r.verifiedBy),
      verified_at: s(r.verifiedAt),
    })),
  // Not a 1:1 record mapping — a study's protocol is three flat id arrays
  // (conditionIds/timePointIds/requiredTestDefinitionIds), so "what protocol
  // rows currently exist" is the real cross-product of those three arrays
  // resolved back to codes. A study with 2 conditions x 3 time points x 2
  // tests genuinely has 12 real (condition, time-point, test) combinations
  // attached to it today — this is not fabricated, it is what
  // `commitStabilityProtocols` itself would consider "already present" on
  // re-import.
  stability_protocols: async () => {
    const studies = (await listRecords("stability_studies")) as unknown as Record<string, unknown>[];
    const testDefs = (await listRecords("test_definitions")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const study of studies) {
      const code = s(study.code);
      const conditionIds = (study.conditionIds as string[] | undefined) ?? [];
      const timePointIds = (study.timePointIds as string[] | undefined) ?? [];
      const testIds = (study.requiredTestDefinitionIds as string[] | undefined) ?? [];
      for (const cid of conditionIds) {
        const condition = SEED_STABILITY_CONDITIONS.find((c) => c.id === cid);
        if (!condition) continue;
        for (const tid of timePointIds) {
          const timePoint = SEED_STABILITY_TIME_POINTS.find((tp) => tp.id === tid);
          if (!timePoint) continue;
          for (const testId of testIds) {
            // `study.requiredTestDefinitionIds` holds codes, not a separate
            // `id` (`test_definitions` records have none) — see
            // `commitStabilityProtocols`.
            const testDef = testDefs.find((td) => td.code === testId);
            if (!testDef) continue;
            naturalKeys.add(`${code}::${condition.code}::${timePoint.code}::${s(testDef.code)}`);
            rows.push({
              protocol_code: code,
              condition_code: condition.code,
              time_point: timePoint.code,
              test_code: s(testDef.code),
              packaging_sku_code: s(study.packagingSkuCode),
            });
          }
        }
      }
    }
    return { naturalKeys, rows };
  },
  stability_results: async () => {
    const results = (await listRecords("stability_results")) as unknown as Record<string, unknown>[];
    const studies = (await listRecords("stability_studies")) as unknown as Record<string, unknown>[];
    const samples = (await listRecords("stability_samples")) as unknown as Record<string, unknown>[];
    const testDefs = (await listRecords("test_definitions")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const result of results) {
      const study = studies.find((st) => st.id === result.studyId);
      const sample = samples.find((sm) => sm.id === result.sampleId);
      const condition = SEED_STABILITY_CONDITIONS.find((c) => c.id === result.conditionId);
      const timePoint = SEED_STABILITY_TIME_POINTS.find((tp) => tp.id === result.timePointId);
      // `result.testDefinitionId` is already a code (see `commitStabilityResults`).
      const testDef = testDefs.find((td) => td.code === result.testDefinitionId);
      if (!study || !sample || !condition || !timePoint || !testDef) continue;
      const studyCode = s(study.code);
      const sampleCode = s(sample.sampleCode);
      const testCode = s(testDef.code);
      naturalKeys.add(`${studyCode}::${sampleCode}::${condition.code}::${timePoint.code}::${testCode}`);
      rows.push({
        study_code: studyCode,
        sample_code: sampleCode,
        condition_code: condition.code,
        time_point: timePoint.code,
        test_code: testCode,
        numeric_value: (result.replicates as { numericValue?: string }[] | undefined)?.[0]?.numericValue ?? "",
        text_value: s(result.textValue),
        unit: s(result.unit),
        result_date: s(result.performedAt),
        analyst: s(result.performedBy),
        observation: s(result.notes),
      });
    }
    return { naturalKeys, rows };
  },
  dossier_requirements: async () => {
    const requirements = (await listRecords("regulatory_dossier_requirements")) as unknown as Record<string, unknown>[];
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const req of requirements) {
      const dossier = dossiers.find((d) => d.id === req.dossierId);
      if (!dossier) continue;
      const dossierCode = s(dossier.dossierCode);
      const requirementCode = s(req.requirementCode);
      naturalKeys.add(`${dossierCode}::${requirementCode}`);
      rows.push({
        dossier_code: dossierCode,
        jurisdiction: s(req.jurisdiction),
        requirement_code: requirementCode,
        requirement_type: s(req.requirementType),
        title: s(req.title),
        description: s(req.description),
        mandatory: s(req.mandatory),
        critical: s(req.critical),
        applicability_status: s(req.applicabilityStatus),
        minimum_evidence_count: s(req.minimumEvidenceCount),
        expiry_policy: s(req.expiryPolicy),
      });
    }
    return { naturalKeys, rows };
  },
  // `requirement_code` is reconstructed from the current (non-revoked)
  // proposed/accepted link for this evidence item, not a stored field on
  // the evidence item itself — see `commitDossierEvidence`'s
  // `regulatory_requirement_evidence_links` write. Evidence created
  // outside Data Exchange (uploads, discovery) has no `evidenceCode` and
  // is excluded — there is no natural key to export it against.
  dossier_evidence: async () => {
    const items = (await listRecords("regulatory_evidence_items")) as unknown as Record<string, unknown>[];
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const requirements = (await listRecords("regulatory_dossier_requirements")) as unknown as Record<string, unknown>[];
    const links = (await listRecords("regulatory_requirement_evidence_links")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const item of items) {
      const evidenceCode = s(item.evidenceCode);
      if (!evidenceCode) continue;
      const dossier = dossiers.find((d) => d.id === item.dossierId);
      if (!dossier) continue;
      const link = links.find((l) => l.evidenceItemId === item.id && l.linkStatus !== "revoked");
      const requirement = link ? requirements.find((req) => req.id === link.requirementId) : undefined;
      const dossierCode = s(dossier.dossierCode);
      const requirementCode = s(requirement?.requirementCode);
      naturalKeys.add(`${dossierCode}::${requirementCode}::${evidenceCode}`);
      rows.push({
        dossier_code: dossierCode,
        requirement_code: requirementCode,
        evidence_code: evidenceCode,
        evidence_type: s(item.evidenceType),
        document_type: s(item.documentType),
        title: s(item.title),
        document_number: s(item.documentNumber),
        issuer: s(item.issuer),
        issue_date: s(item.issuedAt),
        expiry_date: s(item.expiresAt),
        language: s(item.language),
        status: s(item.status),
        notes: s(item.description),
      });
    }
    return { naturalKeys, rows };
  },
  // Phase 8 final Data Exchange expansion — current-data export for all 6
  // new dossier-domain templates. `dossier_reviews` and
  // `dossier_manual_requirement_actions` still get a real loader here even
  // though their template is import-disabled (`enabled: false` in
  // dataExchangeRegistry.ts) — export/audit visibility is exactly what
  // they're allowed to do.
  dossier_headers: async () => {
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const formulations = await listFormulations();
    const codeById = new Map(formulations.map((f) => [f.id, f.code]));
    const versionNumberById = new Map<string, string>();
    for (const f of formulations) {
      const { versions } = await readFormulation(f.id);
      for (const v of versions) versionNumberById.set(v.id, String(v.versionNumber));
    }
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const d of dossiers) {
      const dossierCode = s(d.dossierCode);
      naturalKeys.add(dossierCode);
      rows.push({
        dossier_code: dossierCode,
        title: s(d.title),
        formula_code: s(codeById.get(d.formulationId as string)),
        formula_version: s(versionNumberById.get(d.formulaVersionId as string)),
        packaging_sku_code: s(d.packagingSkuCode),
        jurisdictions: j(d.jurisdictions),
        product_family_code: s(d.productFamilyCode),
        status: s(d.status),
        notes: "",
      });
    }
    return { naturalKeys, rows };
  },
  dossier_reviews: async () => {
    const reviews = (await listRecords("regulatory_dossier_reviews")) as unknown as Record<string, unknown>[];
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const rv of reviews) {
      const dossier = dossiers.find((d) => d.id === rv.dossierId);
      if (!dossier) continue;
      const dossierCode = s(dossier.dossierCode);
      const revision = s(rv.dossierRevision);
      const reviewedAt = s(rv.reviewedAt);
      naturalKeys.add(`${dossierCode}::${revision}::${reviewedAt}`);
      rows.push({
        dossier_code: dossierCode,
        dossier_revision: revision,
        reviewed_by: s(rv.reviewedBy),
        reviewer_role: s(rv.reviewerRole),
        reviewed_at: reviewedAt,
        outcome: s(rv.outcome),
        notes: s(rv.notes),
        blocking_issues: j(rv.blockingIssues),
        warnings: j(rv.warnings),
      });
    }
    return { naturalKeys, rows };
  },
  dossier_submissions: async () => {
    const submissions = (await listRecords("regulatory_dossier_submissions")) as unknown as Record<string, unknown>[];
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const sub of submissions) {
      const dossier = dossiers.find((d) => d.id === sub.dossierId);
      if (!dossier) continue;
      const dossierCode = s(dossier.dossierCode);
      const revision = s(sub.dossierRevision);
      const jurisdiction = s(sub.jurisdiction);
      const submittedAt = s(sub.submittedAt);
      naturalKeys.add(`${dossierCode}::${revision}::${jurisdiction}::${submittedAt}`);
      rows.push({
        dossier_code: dossierCode,
        dossier_revision: revision,
        jurisdiction,
        submission_reference: s(sub.submissionReference),
        submitted_by: s(sub.submittedBy),
        submitted_at: submittedAt,
        submission_channel: s(sub.submissionChannel),
        status: s(sub.status),
        notes: s(sub.notes),
      });
    }
    return { naturalKeys, rows };
  },
  dossier_evidence_links: async () => {
    const links = (await listRecords("regulatory_requirement_evidence_links")) as unknown as Record<string, unknown>[];
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const requirements = (await listRecords("regulatory_dossier_requirements")) as unknown as Record<string, unknown>[];
    const evidenceItems = (await listRecords("regulatory_evidence_items")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const link of links) {
      const dossier = dossiers.find((d) => d.id === link.dossierId);
      const requirement = requirements.find((req) => req.id === link.requirementId);
      const evidence = evidenceItems.find((e) => e.id === link.evidenceItemId);
      if (!dossier || !requirement || !evidence) continue;
      // No natural key without one, same convention as the `dossier_evidence` loader above.
      const evidenceCode = s(evidence.evidenceCode);
      if (!evidenceCode) continue;
      const dossierCode = s(dossier.dossierCode);
      const requirementCode = s(requirement.requirementCode);
      const linkedAt = s(link.linkedAt);
      naturalKeys.add(`${dossierCode}::${requirementCode}::${evidenceCode}::${linkedAt}`);
      rows.push({
        dossier_code: dossierCode,
        requirement_code: requirementCode,
        evidence_code: evidenceCode,
        linked_by: s(link.linkedBy),
        linked_at: linkedAt,
        link_status: s(link.linkStatus),
        notes: s(link.notes),
      });
    }
    return { naturalKeys, rows };
  },
  dossier_manual_requirement_actions: async () => {
    const actions = (await listRecords("regulatory_dossier_manual_requirement_actions")) as unknown as Record<string, unknown>[];
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const requirements = (await listRecords("regulatory_dossier_requirements")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const action of actions) {
      const dossier = dossiers.find((d) => d.id === action.dossierId);
      const requirement = requirements.find((req) => req.id === action.requirementId);
      if (!dossier || !requirement) continue;
      const dossierCode = s(dossier.dossierCode);
      const requirementCode = s(requirement.requirementCode);
      const performedAt = s(action.performedAt);
      naturalKeys.add(`${dossierCode}::${requirementCode}::${performedAt}`);
      rows.push({
        dossier_code: dossierCode,
        dossier_revision: s(action.dossierRevision),
        action: s(action.action),
        requirement_code: requirementCode,
        performed_by: s(action.performedBy),
        performed_by_role: s(action.performedByRole),
        performed_at: performedAt,
        justification: s(action.justification),
      });
    }
    return { naturalKeys, rows };
  },
  dossier_review_revocations: async () => {
    const revocations = (await listRecords("regulatory_dossier_review_revocations")) as unknown as Record<string, unknown>[];
    const reviews = (await listRecords("regulatory_dossier_reviews")) as unknown as Record<string, unknown>[];
    const dossiers = (await listRecords("regulatory_dossiers")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const rv of revocations) {
      const review = reviews.find((rev) => rev.id === rv.revokesReviewId);
      if (!review) continue;
      const dossier = dossiers.find((d) => d.id === review.dossierId);
      if (!dossier) continue;
      const dossierCode = s(dossier.dossierCode);
      const revision = s(review.dossierRevision);
      const reviewedAt = s(review.reviewedAt);
      naturalKeys.add(`${dossierCode}::${revision}::${reviewedAt}`);
      rows.push({
        dossier_code: dossierCode,
        dossier_revision: revision,
        reviewed_at: reviewedAt,
        revoked_by: s(rv.revokedBy),
        revoked_by_role: s(rv.revokedByRole),
        reason: s(rv.reason),
      });
    }
    return { naturalKeys, rows };
  },
  product_claims: async () => {
    const claims = (await listRecords("product_claims")) as unknown as Record<string, unknown>[];
    const formulations = await listFormulations();
    const codeById = new Map(formulations.map((f) => [f.id, f.code]));
    const versionNumberById = new Map<string, string>();
    for (const f of formulations) {
      const { versions } = await readFormulation(f.id);
      for (const v of versions) versionNumberById.set(v.id, String(v.versionNumber));
    }
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const c of claims) {
      const claimCode = s(c.claimCode);
      naturalKeys.add(claimCode);
      rows.push({
        claim_code: claimCode,
        project_code: s(codeById.get(c.formulationId as string)),
        formula_version: s(versionNumberById.get(c.formulaVersionId as string)),
        packaging_sku_code: s(c.packagingSkuCode),
        claim_text: s(c.claimText),
        claim_category: s(c.claimCategory),
        jurisdictions: j(c.jurisdictions),
        languages: j(c.languages),
        risk_level: s(c.riskLevel),
        status: s(c.status),
      });
    }
    return { naturalKeys, rows };
  },
  // `panel` is now a real persisted field on `labelContentBlockSchema`
  // (added to close this round-trip gap) — included in the natural key
  // exactly as the template documents.
  label_content: async () => {
    const blocks = (await listRecords("label_content_blocks")) as unknown as Record<string, unknown>[];
    const labels = (await listRecords("product_labels")) as unknown as Record<string, unknown>[];
    const formulations = await listFormulations();
    const versionNumberById = new Map<string, string>();
    for (const f of formulations) {
      const { versions } = await readFormulation(f.id);
      for (const v of versions) versionNumberById.set(v.id, String(v.versionNumber));
    }
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const b of blocks) {
      const label = labels.find((l) => l.id === b.labelId);
      if (!label) continue;
      const labelCode = s(label.labelCode);
      const labelRevision = s(b.labelRevision);
      const panel = s(b.panel);
      const blockType = s(b.blockType);
      const language = s(b.language);
      naturalKeys.add(`${labelCode}::${labelRevision}::${panel}::${blockType}::${language}`);
      rows.push({
        label_code: labelCode,
        formula_version: s(versionNumberById.get(label.formulaVersionId as string)),
        packaging_sku_code: s(label.packagingSkuCode),
        jurisdiction: s(label.jurisdiction),
        language,
        label_revision: labelRevision,
        panel,
        block_type: blockType,
        content_text: s(b.text),
        mandatory: s(b.mandatory),
        source: s(b.source),
        status: s(b.status),
      });
    }
    return { naturalKeys, rows };
  },
  // `dimensions` is still stored as one combined string ("WxH unit" or
  // "WxH", written by `commitArtworkRegister` in that exact shape) rather
  // than separate width/height/dimension_unit fields on the schema — a
  // bigger schema change than this closure needs, since `dimensions` is
  // also read/written by the real Claims & Labels artwork editor
  // (`engine/labels.ts`). Instead of leaving width/height permanently
  // blank, parse the exact format the writer itself produces: anything
  // that doesn't match that format (e.g. free text typed directly into
  // the workspace) honestly exports blank rather than a guessed split.
  artwork_register: async () => {
    const artworks = (await listRecords("label_artworks")) as unknown as Record<string, unknown>[];
    const labels = (await listRecords("product_labels")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    const dimensionPattern = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:\s+(.+))?$/;
    for (const art of artworks) {
      const label = labels.find((l) => l.id === art.labelId);
      if (!label) continue;
      const artworkCode = s(art.artworkCode);
      naturalKeys.add(artworkCode);
      const match = s(art.dimensions).match(dimensionPattern);
      rows.push({
        artwork_code: artworkCode,
        label_code: s(label.labelCode),
        label_revision: s(art.labelRevision),
        format: s(art.format),
        width: match ? match[1] : "",
        height: match ? match[2] : "",
        dimension_unit: match ? (match[3] ?? "") : "",
        color_mode: s(art.colorMode),
        languages: j(art.languageSet),
        status: s(art.status),
        created_by: s(art.createdBy),
        created_at: s(art.createdAt),
      });
    }
    return { naturalKeys, rows };
  },
  doe_factors_responses: async () => {
    const studies = (await listRecords("doe_studies")) as unknown as Record<string, unknown>[];
    const factors = (await listRecords("doe_factors")) as unknown as Record<string, unknown>[];
    const responses = (await listRecords("doe_responses")) as unknown as Record<string, unknown>[];
    const studyCodeOf = (studyId: unknown) => s(studies.find((st) => st.id === studyId)?.studyCode);
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const f of factors) {
      const studyCode = studyCodeOf(f.studyId);
      if (!studyCode) continue;
      const factorCode = s(f.factorCode);
      naturalKeys.add(`${studyCode}::${factorCode}`);
      rows.push({
        study_code: studyCode,
        record_type: "factor",
        factor_or_response_code: factorCode,
        name: s(f.name),
        factor_type: s(f.factorType),
        source_type: s(f.sourceType),
        unit: s(f.unit),
        low_value: s(f.lowValue),
        center_value: s(f.centerValue),
        high_value: s(f.highValue),
        categorical_levels: j(f.categoricalLevels),
      });
    }
    for (const resp of responses) {
      const studyCode = studyCodeOf(resp.studyId);
      if (!studyCode) continue;
      const responseCode = s(resp.responseCode);
      naturalKeys.add(`${studyCode}::${responseCode}`);
      rows.push({
        study_code: studyCode,
        record_type: "response",
        factor_or_response_code: responseCode,
        name: s(resp.name),
        unit: s(resp.unit),
        objective: s(resp.objective),
        target_value: s(resp.targetValue),
        lower_limit: s(resp.lowerLimit),
        upper_limit: s(resp.upperLimit),
        weight: s(resp.weight),
      });
    }
    return { naturalKeys, rows };
  },
  doe_observations: async () => {
    const studies = (await listRecords("doe_studies")) as unknown as Record<string, unknown>[];
    const runs = (await listRecords("doe_runs")) as unknown as Record<string, unknown>[];
    const responses = (await listRecords("doe_responses")) as unknown as Record<string, unknown>[];
    const observations = (await listRecords("doe_observations")) as unknown as Record<string, unknown>[];
    const naturalKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const obs of observations) {
      const study = studies.find((st) => st.id === obs.studyId);
      const run = runs.find((rn) => rn.id === obs.runId);
      const response = responses.find((rp) => rp.id === obs.responseId);
      if (!study || !run || !response) continue;
      const studyCode = s(study.studyCode);
      const runNumber = s(run.runNumber);
      const responseCode = s(response.responseCode);
      naturalKeys.add(`${studyCode}::${runNumber}::${responseCode}`);
      rows.push({
        study_code: studyCode,
        run_number: runNumber,
        response_code: responseCode,
        numeric_value: s(obs.value),
        text_value: s(obs.textValue),
        unit: s(response.unit),
        status: s(obs.status),
        measured_at: s(obs.recordedAt),
        analyst: s(obs.recordedBy),
      });
    }
    return { naturalKeys, rows };
  },
};

export function hasExistingLookup(templateCode: string): boolean {
  return templateCode in LOADERS;
}

export async function loadExisting(templateCode: string): Promise<ExistingLookup> {
  const loader = LOADERS[templateCode];
  if (!loader) return { naturalKeys: new Set(), rows: [] };
  return loader();
}

/** `formula_bom` has its own loader (`loadExistingFormulaBom`, below) since
 *  it reads the session-based formulation store rather than a masterdata
 *  collection — every other template goes through `LOADERS`/`loadExisting`.
 *  This is the SAME dispatch `DataExchangeImportDialog.tsx`'s own
 *  `existingFor()` already uses for create-vs-update classification; reused
 *  here rather than duplicated, so both concerns stay backed by one real
 *  authority. */
async function existingLookupFor(templateCode: string): Promise<ExistingLookup> {
  if (templateCode === "formula_bom") return loadExistingFormulaBom();
  return loadExisting(templateCode);
}

/** One `code_reference` column's own resolution requirement — which
 *  template, and the EXACT field on that template's own exported rows the
 *  column's value must match. */
export interface ReferenceRequirement {
  referenceTemplate: string;
  referenceField: string;
}

/**
 * FVL-04 hardening (Session 8, Part 1) — the generic, FIELD-AWARE
 * `(referenceTemplate, referenceField, key) => exists?` resolver every
 * Data Exchange import (both the production `DataExchangeImportDialog`
 * and the connector layer's own end-to-end acceptance) uses for real
 * `code_reference` validation. Built ONLY from the SAME existing-record
 * loaders every template's own create-vs-update classification already
 * uses — never a duplicate registry, never a material/supplier/packaging-
 * specific `if` branch.
 *
 * FVL-04 hardening (Session 8) — the prior two-argument version checked a
 * referenced template's own COMPOSITE NATURAL KEY string
 * (`"SKU-001::BOTTLE-01"`) regardless of which single field a
 * `referenceField` column actually pointed at (`"SKU-001"`) — a real
 * false-negative bug for every reference into a template with a
 * composite natural key (`packaging_bom`, `label_content`,
 * `doe_factors_responses`, ...): a genuinely valid reference would have
 * been reported `reference_missing`. Fixed: each requirement's exported
 * `rows` (the SAME rows `loadExisting`/`loadExistingFormulaBom` already
 * produce for current-data export) are indexed by the EXACT
 * `referenceField` column key, never the natural-key string.
 *
 * Each unique (template, field) pair is loaded/indexed ONCE up front
 * (synchronous `resolveReference` cannot itself be async); a template
 * referenced by two different fields loads its rows only once, shared
 * across both indexes. A `referenceTemplate` with no registered loader (a
 * real, pre-existing, unrelated gap in a handful of non-connector
 * templates — see `dataExchangeExisting.test.ts`) resolves every key as
 * "missing" rather than silently passing every reference.
 */
export async function buildReferenceResolver(requirements: Iterable<ReferenceRequirement>): Promise<(referenceTemplate: string, referenceField: string, key: string) => boolean> {
  const lookupCache = new Map<string, ExistingLookup>();
  const valuesByRequirement = new Map<string, Set<string>>();
  const seen = new Set<string>();

  for (const { referenceTemplate, referenceField } of requirements) {
    const requirementKey = `${referenceTemplate}::${referenceField}`;
    if (seen.has(requirementKey)) continue;
    seen.add(requirementKey);

    let lookup = lookupCache.get(referenceTemplate);
    if (!lookup) {
      lookup = await existingLookupFor(referenceTemplate);
      lookupCache.set(referenceTemplate, lookup);
    }

    const values = new Set<string>();
    for (const row of lookup.rows) {
      const v = row[referenceField];
      if (v !== undefined && v !== "") values.add(v);
    }
    valuesByRequirement.set(requirementKey, values);
  }

  return (referenceTemplate, referenceField, key) => valuesByRequirement.get(`${referenceTemplate}::${referenceField}`)?.has(key) ?? false;
}

/** Formula/BOM's current-data export is flattened from the session-based
 *  formulation store, not a masterdata collection — kept separate since it
 *  needs `listFormulations`/`readFormulation`, not `listRecords`. */
export async function loadExistingFormulaBom(): Promise<ExistingLookup> {
  const formulations = await listFormulations();
  const naturalKeys = new Set<string>();
  const rows: Record<string, string>[] = [];
  for (const f of formulations) {
    const { versions } = await readFormulation(f.id);
    for (const v of versions) {
      naturalKeys.add(`${f.code}::${v.versionNumber}`);
      for (const line of v.lines) {
        rows.push({
          formula_code: f.code,
          formula_name: f.name,
          formula_version: String(v.versionNumber),
          product_family_code: f.productFamilyCode,
          line_number: String(line.lineNumber),
          material_code: line.materialCode ?? "",
          percentage: line.percent,
          phase: line.phase,
          is_qs_material: String(line.isQsToHundred),
          notes: line.notes ?? "",
        });
      }
    }
  }
  return { naturalKeys, rows };
}
