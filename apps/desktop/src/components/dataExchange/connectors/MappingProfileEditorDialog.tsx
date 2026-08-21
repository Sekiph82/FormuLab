import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import {
  getDataExchangeTemplate,
  listDataExchangeTemplates,
  mappingProfileCode,
  validateMappingProfile,
  KNOWN_UNITS,
  SUPPORTED_DATE_FORMATS,
  SUPPORTED_DECIMAL_SEPARATORS,
  SUPPORTED_GROUP_SEPARATORS,
  TRANSFORMATION_OPS,
  type ConnectorConnection,
  type ConstantMapping,
  type FieldMapping,
  type MappingProfile,
  type MappingProfileValidationIssue,
  type SourceSchema,
  type TransformationOp,
  type TransformationStep,
} from "@formulab/shared";
import { saveMappingProfile } from "@/lib/connectorPersistence";
import { Field, inputCls, Modal } from "./ui";

/** MAP5A-M — every real op the engine supports (`TRANSFORMATION_OPS`), each
 *  with a typed config UI matching `engine/transformation.ts`'s own runtime
 *  contract exactly — no arbitrary/unsupported op, no JSON editor, no
 *  eval/scripting/expression/LLM mapping. A field mapping supports a full
 *  ORDERED pipeline of these steps (add/remove/reorder), matching the
 *  engine's own `transformations: TransformationStep[]` array. */
const DECIMAL_SEPARATORS = [...SUPPORTED_DECIMAL_SEPARATORS];
const GROUP_SEPARATORS = [...SUPPORTED_GROUP_SEPARATORS];
const DATE_FORMATS = [...SUPPORTED_DATE_FORMATS];
const UNITS = [...KNOWN_UNITS];

function defaultConfigFor(op: TransformationOp): Record<string, unknown> | undefined {
  switch (op) {
    case "constant":
      return { value: "" };
    case "parse_decimal":
      return { decimalSeparator: "." };
    case "parse_date":
      return { format: DATE_FORMATS[0] };
    case "map_enum":
      return { enumMap: {}, caseInsensitive: true };
    case "map_boolean":
      return { trueValues: ["true"], falseValues: ["false"] };
    case "convert_unit":
      return { from: UNITS[0], to: UNITS[0] };
    case "resolve_crosswalk":
      return { canonicalEntity: "" };
    case "split":
      return { delimiter: "," };
    case "join":
      return { delimiter: ";" };
    default:
      return undefined;
  }
}

type EnumPair = [string, string];
function enumMapToPairs(config: Record<string, unknown> | undefined): EnumPair[] {
  const raw = config?.enumMap;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : ""] as EnumPair);
}
/** Keeps every pair, including an in-progress one with an empty key — a
 *  JS object supports `""` as a real key, so a freshly-added blank pair
 *  survives the round-trip through `config.enumMap` instead of vanishing
 *  the instant it's added (before the user has typed a key). Structural
 *  validation (`validateMappingProfile`) is still the one real authority
 *  that rejects a genuinely incomplete map_enum config at Validate time. */
function pairsToEnumMap(pairs: EnumPair[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [k, v] of pairs) map[k] = v;
  return map;
}

/** MAP5A-M — one transformation step's typed config editor. Renders
 *  nothing for ops with no config (trim/empty_to_null/lowercase/uppercase/
 *  safe_code_case/copy). */
function TransformStepConfig({ step, onChange }: { step: TransformationStep; onChange: (config: Record<string, unknown>) => void }) {
  const { t } = useTranslation(["session", "common"]);
  const config = step.config;

  if (step.op === "constant") {
    return (
      <Field label={t("dataExchange.connectors.mapping.constantValueLabel")}>
        <input value={typeof config?.value === "string" ? config.value : ""} onChange={(e) => onChange({ ...config, value: e.target.value })} className={inputCls} />
      </Field>
    );
  }

  if (step.op === "parse_decimal") {
    const groupSeparator = typeof config?.groupSeparator === "string" ? config.groupSeparator : "";
    return (
      <>
        <Field label={t("dataExchange.connectors.mapping.decimalSeparator")}>
          <select value={typeof config?.decimalSeparator === "string" ? config.decimalSeparator : "."} onChange={(e) => onChange({ ...config, decimalSeparator: e.target.value })} className={inputCls}>
            {DECIMAL_SEPARATORS.map((sep) => (
              <option key={sep} value={sep}>
                {sep}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("dataExchange.connectors.mapping.groupSeparator")}>
          <select
            value={groupSeparator}
            onChange={(e) => {
              const next = { ...config };
              if (e.target.value) next.groupSeparator = e.target.value;
              else delete next.groupSeparator;
              onChange(next);
            }}
            className={inputCls}
          >
            <option value="">{t("dataExchange.connectors.mapping.noGroupSeparator")}</option>
            {GROUP_SEPARATORS.map((sep) => (
              <option key={sep} value={sep}>
                {sep}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (step.op === "parse_date") {
    return (
      <Field label={t("dataExchange.connectors.mapping.dateFormat")}>
        <select value={typeof config?.format === "string" ? config.format : DATE_FORMATS[0]} onChange={(e) => onChange({ ...config, format: e.target.value })} className={inputCls}>
          {DATE_FORMATS.map((fmt) => (
            <option key={fmt} value={fmt}>
              {fmt}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (step.op === "map_boolean") {
    return (
      <>
        <Field label={t("dataExchange.connectors.mapping.trueValues")}>
          <input
            value={Array.isArray(config?.trueValues) ? (config.trueValues as string[]).join(",") : ""}
            onChange={(e) => onChange({ ...config, trueValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            className={inputCls}
          />
        </Field>
        <Field label={t("dataExchange.connectors.mapping.falseValues")}>
          <input
            value={Array.isArray(config?.falseValues) ? (config.falseValues as string[]).join(",") : ""}
            onChange={(e) => onChange({ ...config, falseValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            className={inputCls}
          />
        </Field>
      </>
    );
  }

  if (step.op === "map_enum") {
    const pairs = enumMapToPairs(config);
    const caseInsensitive = config?.caseInsensitive !== false;
    const setPairs = (next: EnumPair[]) => onChange({ ...config, enumMap: pairsToEnumMap(next) });
    return (
      <div className="flex w-full flex-col gap-1.5">
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={caseInsensitive} onChange={(e) => onChange({ ...config, caseInsensitive: e.target.checked })} />
          {t("dataExchange.connectors.mapping.caseInsensitiveMatch")}
        </label>
        {pairs.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
            <input
              value={k}
              placeholder={t("dataExchange.connectors.mapping.enumSourceValue")}
              onChange={(e) => setPairs(pairs.map((p, idx) => (idx === i ? [e.target.value, p[1]] : p)))}
              className={inputCls}
            />
            <input
              value={v}
              placeholder={t("dataExchange.connectors.mapping.enumTargetValue")}
              onChange={(e) => setPairs(pairs.map((p, idx) => (idx === i ? [p[0], e.target.value] : p)))}
              className={inputCls}
            />
            <button onClick={() => setPairs(pairs.filter((_, idx) => idx !== i))} aria-label={t("common:actions.remove")} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-error">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button onClick={() => setPairs([...pairs, ["", ""]])} className="flex w-fit items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-muted hover:bg-surface-2">
          <Plus size={10} /> {t("dataExchange.connectors.mapping.addEnumPair")}
        </button>
      </div>
    );
  }

  if (step.op === "convert_unit") {
    return (
      <>
        <Field label={t("dataExchange.connectors.mapping.fromUnit")}>
          <select value={typeof config?.from === "string" ? config.from : UNITS[0]} onChange={(e) => onChange({ ...config, from: e.target.value })} className={inputCls}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("dataExchange.connectors.mapping.toUnit")}>
          <select value={typeof config?.to === "string" ? config.to : UNITS[0]} onChange={(e) => onChange({ ...config, to: e.target.value })} className={inputCls}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (step.op === "resolve_crosswalk") {
    const sameEntity = config?.sameEntity === true;
    return (
      <>
        <Field label={t("dataExchange.connectors.crosswalks.canonicalEntity")}>
          <input value={typeof config?.canonicalEntity === "string" ? config.canonicalEntity : ""} onChange={(e) => onChange({ ...config, canonicalEntity: e.target.value })} className={inputCls} />
        </Field>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={sameEntity}
            onChange={(e) => {
              const next: Record<string, unknown> = { ...config, sameEntity: e.target.checked };
              if (e.target.checked) delete next.sourceEntity;
              onChange(next);
            }}
          />
          {t("dataExchange.connectors.mapping.sameEntity")}
        </label>
        {!sameEntity && (
          <Field label={t("dataExchange.connectors.mapping.sourceEntity")}>
            <input value={typeof config?.sourceEntity === "string" ? config.sourceEntity : ""} onChange={(e) => onChange({ ...config, sourceEntity: e.target.value })} className={inputCls} />
          </Field>
        )}
        <Field label={t("dataExchange.connectors.mapping.fallbackCanonicalField")}>
          <input
            value={typeof config?.fallbackCanonicalField === "string" ? config.fallbackCanonicalField : ""}
            onChange={(e) => {
              const next = { ...config };
              if (e.target.value) next.fallbackCanonicalField = e.target.value;
              else delete next.fallbackCanonicalField;
              onChange(next);
            }}
            className={inputCls}
          />
        </Field>
      </>
    );
  }

  if (step.op === "split" || step.op === "join") {
    return (
      <Field label={t("dataExchange.connectors.mapping.delimiter")}>
        <input value={typeof config?.delimiter === "string" ? config.delimiter : ""} onChange={(e) => onChange({ ...config, delimiter: e.target.value })} className={inputCls} />
      </Field>
    );
  }

  // trim/empty_to_null/lowercase/uppercase/safe_code_case/copy — no config.
  return null;
}

/** Section 12/13 — a real Mapping Profile editor: every mapping row is
 *  `{sourceField, targetTemplate, targetField, transformations}` — the
 *  EXACT `FieldMapping` shape `applyMappingProfile()` already consumes,
 *  including a full ordered transformation pipeline (MAP5A-M).
 *  "Match exact names" reuses simple case-insensitive exact matching
 *  only (never fuzzy/semantic). Validate calls the REAL
 *  `validateMappingProfile()` against the schema this editor was opened
 *  with — never a second, React-local validation pass. */
export function MappingProfileEditorDialog({
  connection,
  basedOn,
  schema,
  sourceFieldOptions,
  defaultSourceEntity,
  actorUserId,
  onClose,
  onSaved,
}: {
  connection: ConnectorConnection | null;
  basedOn?: MappingProfile;
  schema?: SourceSchema | null;
  sourceFieldOptions?: string[];
  /** Section 11 — a new profile's `sourceEntity` prefilled from the most
   *  recent Source Explorer inspection; never applied when editing an
   *  existing profile (its own `sourceEntity` is authoritative). */
  defaultSourceEntity?: string;
  actorUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const templates = listDataExchangeTemplates();
  const [profileName, setProfileName] = useState(basedOn?.profileName ?? "");
  const [profileId] = useState(basedOn?.profileId ?? `${connection?.sourceSystemId ?? "source"}-${Date.now().toString(36)}`);
  const [sourceEntity, setSourceEntity] = useState(basedOn?.sourceEntity ?? defaultSourceEntity ?? "");
  const [rows, setRows] = useState<FieldMapping[]>(basedOn?.fieldMappings ?? []);
  const [constants, setConstants] = useState<ConstantMapping[]>(basedOn?.constantMappings ?? []);
  const [issues, setIssues] = useState<MappingProfileValidationIssue[] | null>(null);
  const [saving, setSaving] = useState(false);

  // VAL1-11 — a new active version can NEVER be persisted without a real,
  // currently-inspected SourceSchema: Save requires (1) a real `schema`
  // prop at all, and (2) a successful Validate run with zero issues
  // against THAT schema. There is no "no schema available" fallback rule
  // any more — an unvalidated active profile is never allowed to persist.
  const validatedClean = issues !== null && issues.length === 0;

  const addRow = () => {
    setIssues(null);
    setRows((r) => [...r, { sourceField: "", targetTemplate: templates[0]?.templateCode ?? "", targetField: "" }]);
  };
  const removeRow = (i: number) => {
    setIssues(null);
    setRows((r) => r.filter((_, idx) => idx !== i));
  };
  const updateRow = (i: number, patch: Partial<FieldMapping>) => {
    setIssues(null);
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };

  // MAP5A-M — a full ordered pipeline of steps per row (add/remove/reorder).
  const addTransformStep = (rowIndex: number) => {
    setIssues(null);
    setRows((r) =>
      r.map((row, idx) => {
        if (idx !== rowIndex) return row;
        const op: TransformationOp = "trim";
        return { ...row, transformations: [...(row.transformations ?? []), { op, config: defaultConfigFor(op) }] };
      }),
    );
  };
  const removeTransformStep = (rowIndex: number, stepIndex: number) => {
    setIssues(null);
    setRows((r) => r.map((row, idx) => (idx === rowIndex ? { ...row, transformations: (row.transformations ?? []).filter((_, si) => si !== stepIndex) } : row)));
  };
  const moveTransformStep = (rowIndex: number, stepIndex: number, direction: -1 | 1) => {
    setIssues(null);
    setRows((r) =>
      r.map((row, idx) => {
        if (idx !== rowIndex) return row;
        const steps = [...(row.transformations ?? [])];
        const target = stepIndex + direction;
        if (target < 0 || target >= steps.length) return row;
        [steps[stepIndex], steps[target]] = [steps[target], steps[stepIndex]];
        return { ...row, transformations: steps };
      }),
    );
  };
  const setTransformStepOp = (rowIndex: number, stepIndex: number, op: TransformationOp) => {
    setIssues(null);
    setRows((r) =>
      r.map((row, idx) => {
        if (idx !== rowIndex) return row;
        const steps = (row.transformations ?? []).map((step, si) => (si === stepIndex ? { op, config: defaultConfigFor(op) } : step));
        return { ...row, transformations: steps };
      }),
    );
  };
  const setTransformStepConfig = (rowIndex: number, stepIndex: number, config: Record<string, unknown>) => {
    setIssues(null);
    setRows((r) =>
      r.map((row, idx) => {
        if (idx !== rowIndex) return row;
        const steps = (row.transformations ?? []).map((step, si) => (si === stepIndex ? { ...step, config } : step));
        return { ...row, transformations: steps };
      }),
    );
  };

  const addConstant = () => {
    setIssues(null);
    setConstants((c) => [...c, { targetTemplate: templates[0]?.templateCode ?? "", targetField: "", value: "" }]);
  };
  const removeConstant = (i: number) => {
    setIssues(null);
    setConstants((c) => c.filter((_, idx) => idx !== i));
  };
  const updateConstant = (i: number, patch: Partial<ConstantMapping>) => {
    setIssues(null);
    setConstants((c) => c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };

  const onMatchExactNames = () => {
    if (!sourceFieldOptions || rows.length === 0) return;
    const byLower = new Map(sourceFieldOptions.map((f) => [f.toLowerCase(), f]));
    setIssues(null);
    setRows((r) =>
      r.map((row) => {
        const template = getDataExchangeTemplate(row.targetTemplate);
        const column = template?.columns.find((c) => c.key === row.targetField);
        const match = column ? byLower.get(column.key.toLowerCase()) : undefined;
        return match ? { ...row, sourceField: match } : row;
      }),
    );
  };

  const buildProfile = (): MappingProfile => {
    const version = basedOn ? basedOn.profileVersion + 1 : 1;
    const now = new Date().toISOString();
    return {
      schemaVersion: "1.0",
      code: mappingProfileCode(profileId, version),
      profileId,
      profileName: profileName || profileId,
      sourceSystemId: connection?.sourceSystemId ?? basedOn?.sourceSystemId ?? "",
      sourceEntity: sourceEntity || basedOn?.sourceEntity || "",
      // VAL1-11 — the fingerprint of a REAL, currently-inspected schema
      // only. Never falls back to a prior/stale `basedOn` fingerprint —
      // a new version must be validated against the CURRENT source.
      sourceSchemaFingerprint: schema?.fingerprint ?? "",
      profileVersion: version,
      status: "active",
      fieldMappings: rows.filter((r) => r.sourceField && r.targetField),
      constantMappings: constants.filter((c) => c.targetField),
      ...(basedOn ? { supersedesProfileCode: basedOn.code } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
    };
  };

  const onValidate = () => {
    if (!schema) return;
    setIssues(validateMappingProfile(buildProfile(), schema));
  };

  const onSave = async () => {
    if (!schema || !validatedClean) return;
    setSaving(true);
    try {
      await saveMappingProfile(buildProfile());
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("dataExchange.connectors.mapping.editorTitle")} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("dataExchange.connectors.mapping.profileName")}>
            <input value={profileName} onChange={(e) => setProfileName(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("dataExchange.connectors.mapping.sourceEntity")}>
            <input value={sourceEntity} onChange={(e) => { setIssues(null); setSourceEntity(e.target.value); }} className={inputCls} disabled={!!basedOn} />
          </Field>
        </div>

        {!schema && (
          <p className="rounded-input border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">{t("dataExchange.connectors.mapping.saveNeedsSchema")}</p>
        )}

        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-medium text-muted">{t("dataExchange.connectors.mapping.sourceField")}</h4>
          <div className="flex gap-2">
            {sourceFieldOptions && sourceFieldOptions.length > 0 && (
              <button onClick={onMatchExactNames} className="rounded-input border border-border px-2 py-1 text-[10px] text-muted hover:bg-surface-2">
                {t("dataExchange.connectors.mapping.matchExactNames")}
              </button>
            )}
            <button onClick={addRow} className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-muted hover:bg-surface-2">
              <Plus size={11} /> {t("dataExchange.connectors.mapping.addMapping")}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {rows.map((row, i) => {
            const template = getDataExchangeTemplate(row.targetTemplate);
            const steps = row.transformations ?? [];
            return (
              <div key={i} className="rounded-input border border-border-faint p-1.5">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1.5">
                  <input list="source-field-options" value={row.sourceField} onChange={(e) => updateRow(i, { sourceField: e.target.value })} className={inputCls} placeholder={t("dataExchange.connectors.mapping.sourceField")} />
                  <select value={row.targetTemplate} onChange={(e) => updateRow(i, { targetTemplate: e.target.value, targetField: "" })} className={inputCls}>
                    {templates.map((tpl) => (
                      <option key={tpl.templateCode} value={tpl.templateCode}>
                        {tpl.title}
                      </option>
                    ))}
                  </select>
                  <select value={row.targetField} onChange={(e) => updateRow(i, { targetField: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {template?.columns.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.key}
                        {c.required ? " *" : ""}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => removeRow(i)} aria-label={t("common:actions.remove")} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-error">
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="mt-1.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted">{t("dataExchange.connectors.mapping.steps")}</span>
                    <button onClick={() => addTransformStep(i)} className="flex items-center gap-1 rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                      <Plus size={10} /> {t("dataExchange.connectors.mapping.addStep")}
                    </button>
                  </div>
                  {steps.length === 0 && <p className="text-[10px] text-muted">{t("dataExchange.connectors.mapping.noTransformation")}</p>}
                  {steps.map((step, si) => (
                    <div key={si} className="flex flex-wrap items-center gap-1.5 rounded-input border border-border-faint bg-surface-2/40 p-1.5">
                      <span className="text-[10px] text-muted">{si + 1}.</span>
                      <select value={step.op} onChange={(e) => setTransformStepOp(i, si, e.target.value as TransformationOp)} className={inputCls}>
                        {TRANSFORMATION_OPS.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                      <TransformStepConfig step={step} onChange={(config) => setTransformStepConfig(i, si, config)} />
                      <div className="ml-auto flex items-center gap-0.5">
                        <button onClick={() => moveTransformStep(i, si, -1)} disabled={si === 0} aria-label={t("dataExchange.connectors.mapping.moveStepUp")} className="rounded-input p-1 text-muted hover:bg-surface-2 disabled:opacity-30">
                          <ChevronUp size={12} />
                        </button>
                        <button onClick={() => moveTransformStep(i, si, 1)} disabled={si === steps.length - 1} aria-label={t("dataExchange.connectors.mapping.moveStepDown")} className="rounded-input p-1 text-muted hover:bg-surface-2 disabled:opacity-30">
                          <ChevronDown size={12} />
                        </button>
                        <button onClick={() => removeTransformStep(i, si)} aria-label={t("dataExchange.connectors.mapping.removeStep")} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-error">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {sourceFieldOptions && (
            <datalist id="source-field-options">
              {sourceFieldOptions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <h4 className="text-[11px] font-medium text-muted">{t("dataExchange.connectors.mapping.constantMapping")}</h4>
          <button onClick={addConstant} className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-muted hover:bg-surface-2">
            <Plus size={11} /> {t("dataExchange.connectors.mapping.addConstant")}
          </button>
        </div>
        <div className="space-y-1">
          {constants.map((row, i) => {
            const template = getDataExchangeTemplate(row.targetTemplate);
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1.5">
                <select value={row.targetTemplate} onChange={(e) => updateConstant(i, { targetTemplate: e.target.value, targetField: "" })} className={inputCls}>
                  {templates.map((tpl) => (
                    <option key={tpl.templateCode} value={tpl.templateCode}>
                      {tpl.title}
                    </option>
                  ))}
                </select>
                <select value={row.targetField} onChange={(e) => updateConstant(i, { targetField: e.target.value })} className={inputCls}>
                  <option value="">—</option>
                  {template?.columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.key}
                      {c.required ? " *" : ""}
                    </option>
                  ))}
                </select>
                <input value={row.value} onChange={(e) => updateConstant(i, { value: e.target.value })} className={inputCls} placeholder={t("dataExchange.connectors.mapping.constantValue")} />
                <button onClick={() => removeConstant(i)} aria-label={t("common:actions.remove")} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-error">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>

        {issues && (
          <div className="rounded-input border border-border px-2 py-1.5 text-[11px]">
            {issues.length === 0 ? (
              <p className="text-success">{t("dataExchange.connectors.mapping.validationClean")}</p>
            ) : (
              <ul className="space-y-0.5 text-error">
                {issues.map((issue, i) => (
                  <li key={i}>
                    [{issue.code}] {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button onClick={onClose} className="rounded-input border border-border px-2.5 py-1.5 text-[11px] text-muted hover:bg-surface-2">
            {t("common:actions.cancel")}
          </button>
          <div className="flex gap-2">
            <button onClick={onValidate} disabled={!schema} title={!schema ? t("dataExchange.connectors.mapping.validateNeedsSchema") : undefined} className="rounded-input border border-border px-2.5 py-1.5 text-[11px] text-text hover:bg-surface-2 disabled:opacity-50">
              {t("dataExchange.connectors.mapping.validateAction")}
            </button>
            <button
              onClick={() => void onSave()}
              disabled={saving || rows.length === 0 || !schema || !validatedClean}
              title={!schema ? t("dataExchange.connectors.mapping.saveNeedsSchema") : !validatedClean ? t("dataExchange.connectors.mapping.saveNeedsCleanValidation") : undefined}
              className="rounded-input bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {t("dataExchange.connectors.mapping.save")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
