/**
 * FVL-04.016 — Mapping Profile Model: reusable, versioned configuration
 * from a customer source schema to EXISTING Data Exchange template shapes.
 * Target templates/fields are resolved through the real
 * `dataExchangeRegistry` — never a duplicated canonical-schema catalog —
 * so a mapping to a non-existent template/field fails validation the same
 * way a typo in a CSV header would. One source record may fan out into
 * several candidate rows (one per target template) when the profile
 * explicitly says so; there is no implicit fan-out from guessed semantics.
 */
import { TRANSFORMATION_OPS, type TransformationStep } from "../schemas/connector";
import type {
  ConnectorError,
  MappingCandidateRow,
  MappingProfile,
  MappingProfileValidationIssue,
  MappingResult,
  MappingTraceEntry,
  SourceSchema,
  StagedSourceRecord,
} from "../schemas/connector";
import { getDataExchangeTemplate } from "./dataExchangeRegistry";
import { applyTransformationPipeline, type TransformationContext } from "./transformation";
import { isKnownUnit, unitDimension } from "./unitConversion";

/** The immutable storage identity for one profile version — see
 *  `mappingProfileSchema`'s own doc comment in `schemas/connector.ts`. */
export function mappingProfileCode(profileId: string, profileVersion: number): string {
  return `${profileId}::v${profileVersion}`;
}

const SUPPORTED_DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];

/**
 * FVL-04.016 hardening (D3) — per-op config shape validation, BEFORE any
 * row is ever mapped. Deliberately narrow: this validates the
 * TRANSFORMATION's own configuration (e.g. "does parse_decimal declare a
 * decimalSeparator at all"), never a target Data Exchange cell's actual
 * content — that remains the existing Data Exchange validator's job.
 */
function validateTransformationConfig(step: TransformationStep, targetTemplate: string, targetField: string, sourceField: string): MappingProfileValidationIssue[] {
  const issues: MappingProfileValidationIssue[] = [];
  const bad = (message: string) => issues.push({ code: "invalid_transformation_config", targetTemplate, targetField, sourceField, message: `"${step.op}" on "${targetTemplate}.${targetField}": ${message}` });
  const config = step.config ?? {};
  switch (step.op) {
    case "parse_decimal": {
      const dec = config.decimalSeparator;
      if (typeof dec !== "string" || dec.length === 0) bad("decimalSeparator is required and must be a non-empty string.");
      const grp = config.groupSeparator;
      if (grp !== undefined && (typeof grp !== "string" || grp.length === 0)) bad("groupSeparator, if present, must be a non-empty string.");
      if (typeof dec === "string" && typeof grp === "string" && dec === grp) bad("groupSeparator cannot equal decimalSeparator.");
      break;
    }
    case "parse_date": {
      const format = config.format;
      if (typeof format !== "string" || !SUPPORTED_DATE_FORMATS.includes(format)) bad(`format must be one of ${SUPPORTED_DATE_FORMATS.join(", ")}.`);
      break;
    }
    case "map_enum": {
      const map = config.enumMap;
      if (typeof map !== "object" || map === null || Object.keys(map).length === 0) bad("enumMap is required and must be a non-empty object.");
      break;
    }
    case "map_boolean": {
      const trueValues = config.trueValues;
      const falseValues = config.falseValues;
      if (!Array.isArray(trueValues) || trueValues.length === 0) bad("trueValues is required and must be a non-empty array.");
      if (!Array.isArray(falseValues) || falseValues.length === 0) bad("falseValues is required and must be a non-empty array.");
      if (Array.isArray(trueValues) && Array.isArray(falseValues)) {
        const t = new Set(trueValues.map((v) => String(v).toLowerCase()));
        const overlap = falseValues.some((v) => t.has(String(v).toLowerCase()));
        if (overlap) bad("trueValues and falseValues must not overlap.");
      }
      break;
    }
    case "convert_unit": {
      const from = config.from;
      const to = config.to;
      if (typeof from !== "string" || !isKnownUnit(from)) bad(`from must be a recognized unit (got "${String(from)}").`);
      if (typeof to !== "string" || !isKnownUnit(to)) bad(`to must be a recognized unit (got "${String(to)}").`);
      if (typeof from === "string" && typeof to === "string" && isKnownUnit(from) && isKnownUnit(to) && unitDimension(from) !== unitDimension(to)) {
        bad(`"${from}" and "${to}" are not dimensionally compatible — this connector layer never performs a density-based conversion.`);
      }
      break;
    }
    case "resolve_crosswalk": {
      if (typeof config.canonicalEntity !== "string" || config.canonicalEntity.length === 0) bad("canonicalEntity is required.");
      break;
    }
    case "split":
    case "join": {
      if (config.delimiter !== undefined && (typeof config.delimiter !== "string" || config.delimiter.length === 0)) bad("delimiter, if present, must be a non-empty string.");
      break;
    }
    default:
      break;
  }
  return issues;
}

/**
 * Structural validation only — does not touch any source record's actual
 * values (that happens per-row in `applyMappingProfile`, where the
 * EXISTING Data Exchange validator gets the final say on cell content).
 */
export function validateMappingProfile(profile: MappingProfile, sourceSchema: SourceSchema): MappingProfileValidationIssue[] {
  const issues: MappingProfileValidationIssue[] = [];

  if (profile.sourceSchemaFingerprint !== sourceSchema.fingerprint) {
    issues.push({
      code: "schema_fingerprint_mismatch",
      message: `Profile was authored against schema fingerprint "${profile.sourceSchemaFingerprint}", but the current source schema fingerprint is "${sourceSchema.fingerprint}" — a materially different source structure. This profile must not be applied silently.`,
    });
    return issues;
  }

  const entitySchema = sourceSchema.entities.find((e) => e.entity === profile.sourceEntity);
  if (!entitySchema) {
    issues.push({ code: "source_entity_not_found", message: `Source entity "${profile.sourceEntity}" is not present in the discovered schema.` });
    return issues;
  }
  const sourceFieldPaths = new Set(entitySchema.fields.map((f) => f.path));

  const seenTargets = new Set<string>();
  for (const fm of profile.fieldMappings) {
    if (!sourceFieldPaths.has(fm.sourceField)) {
      issues.push({ code: "source_field_not_found", sourceField: fm.sourceField, message: `Source field "${fm.sourceField}" does not exist in the discovered schema for "${profile.sourceEntity}".` });
    }
    const template = getDataExchangeTemplate(fm.targetTemplate);
    if (!template) {
      issues.push({ code: "target_template_not_found", targetTemplate: fm.targetTemplate, message: `"${fm.targetTemplate}" is not a registered Data Exchange template.` });
    } else if (!template.columns.some((c) => c.key === fm.targetField)) {
      issues.push({ code: "target_field_not_found", targetTemplate: fm.targetTemplate, targetField: fm.targetField, message: `"${fm.targetField}" is not a real column on template "${fm.targetTemplate}".` });
    }
    for (const step of fm.transformations ?? []) {
      if (!(TRANSFORMATION_OPS as readonly string[]).includes(step.op)) {
        issues.push({ code: "unknown_transformation_op", targetTemplate: fm.targetTemplate, targetField: fm.targetField, message: `"${step.op}" is not a recognized transformation.` });
        continue;
      }
      issues.push(...validateTransformationConfig(step, fm.targetTemplate, fm.targetField, fm.sourceField));
    }
    const key = `${fm.targetTemplate}::${fm.targetField}`;
    if (seenTargets.has(key)) issues.push({ code: "duplicate_target_assignment", targetTemplate: fm.targetTemplate, targetField: fm.targetField, message: `More than one mapping targets "${fm.targetTemplate}.${fm.targetField}".` });
    seenTargets.add(key);
  }

  for (const cm of profile.constantMappings) {
    const template = getDataExchangeTemplate(cm.targetTemplate);
    if (!template) {
      issues.push({ code: "target_template_not_found", targetTemplate: cm.targetTemplate, message: `"${cm.targetTemplate}" is not a registered Data Exchange template.` });
    } else if (!template.columns.some((c) => c.key === cm.targetField)) {
      issues.push({ code: "target_field_not_found", targetTemplate: cm.targetTemplate, targetField: cm.targetField, message: `"${cm.targetField}" is not a real column on template "${cm.targetTemplate}".` });
    }
  }

  const templatesReferenced = new Set([...profile.fieldMappings.map((f) => f.targetTemplate), ...profile.constantMappings.map((c) => c.targetTemplate)]);
  for (const t of templatesReferenced) {
    const template = getDataExchangeTemplate(t);
    if (!template) continue;
    const covered = new Set([
      ...profile.fieldMappings.filter((f) => f.targetTemplate === t).map((f) => f.targetField),
      ...profile.constantMappings.filter((c) => c.targetTemplate === t).map((c) => c.targetField),
    ]);
    for (const col of template.columns.filter((c) => c.required)) {
      if (!covered.has(col.key)) {
        issues.push({ code: "missing_required_target_field", targetTemplate: t, targetField: col.key, message: `Required field "${col.key}" on "${t}" has no mapping at all.` });
      }
    }
    // FVL-04.016 hardening (D5) — an explicitly configured fan-out target
    // must be able to produce its own natural-key identity fields; waiting
    // until commit time to discover a fanned-out target has no identity
    // mapping at all is too late. Reuses the target registry's own
    // `naturalKey`, never a second identity concept invented here.
    for (const key of template.naturalKey) {
      const column = template.columns.find((c) => c.key === key);
      if (!covered.has(key) && !column?.required) {
        // Already reported above when the column is also `required` — this
        // covers the case where a naturalKey field is not itself flagged
        // required by the template but is still needed for identity.
        issues.push({ code: "missing_target_natural_key_field", targetTemplate: t, targetField: key, message: `Natural-key field "${key}" on "${t}" has no mapping — this fan-out target's identity would be unresolvable.` });
      }
    }
  }

  return issues;
}

/**
 * Applies one profile to one staged record, producing candidate rows
 * shaped exactly like an existing Data Exchange template's own columns.
 * Never writes anything — the EXISTING commit layer remains the sole
 * write authority; this only prepares candidates for the EXISTING preview/
 * validator.
 */
export function applyMappingProfile(profile: MappingProfile, record: StagedSourceRecord, ctx: TransformationContext = {}): MappingResult {
  const candidatesByTemplate = new Map<string, Record<string, string>>();
  const trace: MappingTraceEntry[] = [];
  const unresolved: string[] = [];
  const errors: ConnectorError[] = [];
  const warnings: ConnectorError[] = [];
  const fullCtx: TransformationContext = { ...ctx, currentEntity: record.identity.sourceEntity, sourceRecordFields: record.fields };

  for (const fm of profile.fieldMappings) {
    const raw = fm.sourceField in record.fields ? record.fields[fm.sourceField] : null;
    const steps = fm.transformations && fm.transformations.length > 0 ? fm.transformations : [{ op: "copy" as const }];
    const result = applyTransformationPipeline(steps, raw, fullCtx);
    trace.push({ targetTemplate: fm.targetTemplate, targetField: fm.targetField, sourceField: fm.sourceField, rawValue: raw, operations: result.opsRun, result: result.value ?? undefined });

    if (result.error) {
      unresolved.push(`${fm.targetTemplate}.${fm.targetField}`);
      errors.push({
        code: result.error,
        stage: "transformation",
        sourceEntity: record.identity.sourceEntity,
        sourceRecordId: record.identity.sourceRecordId,
        message: `Failed to map "${fm.sourceField}" -> "${fm.targetTemplate}.${fm.targetField}": ${result.error}.`,
        retryable: false,
      });
      continue;
    }
    if (result.value === null || result.value === undefined) continue;
    if (!candidatesByTemplate.has(fm.targetTemplate)) candidatesByTemplate.set(fm.targetTemplate, {});
    candidatesByTemplate.get(fm.targetTemplate)![fm.targetField] = result.value;
  }

  for (const cm of profile.constantMappings) {
    if (!candidatesByTemplate.has(cm.targetTemplate)) candidatesByTemplate.set(cm.targetTemplate, {});
    candidatesByTemplate.get(cm.targetTemplate)![cm.targetField] = cm.value;
    trace.push({ targetTemplate: cm.targetTemplate, targetField: cm.targetField, operations: ["constant"], result: cm.value });
  }

  const candidates: MappingCandidateRow[] = [...candidatesByTemplate.entries()].map(([targetTemplate, row]) => ({ targetTemplate, row }));

  return {
    sourceLineage: record.lineage,
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    candidates,
    trace,
    unresolved,
    warnings,
    errors,
  };
}
