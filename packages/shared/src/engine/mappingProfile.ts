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
import { TRANSFORMATION_OPS } from "../schemas/connector";
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
      }
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
  const fullCtx: TransformationContext = { ...ctx, currentEntity: record.identity.sourceEntity };

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
