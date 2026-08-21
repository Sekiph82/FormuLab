import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import {
  getDataExchangeTemplate,
  listDataExchangeTemplates,
  mappingProfileCode,
  validateMappingProfile,
  type ConnectorConnection,
  type ConstantMapping,
  type FieldMapping,
  type MappingProfile,
  type MappingProfileValidationIssue,
  type SourceSchema,
  type TransformationOp,
} from "@formulab/shared";
import { saveMappingProfile } from "@/lib/connectorPersistence";
import { Field, inputCls, Modal } from "./ui";

/** Section 12/MAP5 — the real transformation ops this editor exposes a
 *  typed UI for. Every one is genuinely supported by
 *  `packages/shared/src/engine/transformation.ts`'s own runtime; this is
 *  a real, disclosed SUBSET of `TRANSFORMATION_OPS` (never map_enum/
 *  convert_unit/resolve_crosswalk/parse_date/split/join/constant, which
 *  would each need their own typed config UI not yet built) — never an
 *  arbitrary/unsupported op offered here. */
const UI_TRANSFORMATION_OPS = ["trim", "empty_to_null", "lowercase", "uppercase", "safe_code_case", "copy", "parse_decimal", "map_boolean"] as const satisfies readonly TransformationOp[];
const DECIMAL_SEPARATORS = [".", ","] as const;

function defaultConfigFor(op: TransformationOp): Record<string, unknown> | undefined {
  if (op === "parse_decimal") return { decimalSeparator: "." };
  if (op === "map_boolean") return { trueValues: ["true"], falseValues: ["false"] };
  return undefined;
}

/** Section 12/13 — a real Mapping Profile editor: every mapping row is
 *  `{sourceField, targetTemplate, targetField}` — the EXACT
 *  `FieldMapping` shape `applyMappingProfile()` already consumes.
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

  // Section 13 — when a real schema is available, an active version must
  // be validated clean before it can be saved (rule 4/6): Save is gated
  // on a successful Validate run with zero issues. When no schema is
  // available at all (the disclosed, still-common case — Source Explorer
  // was never run for this connection this session), this gate cannot
  // apply — Save falls back to the pre-existing "at least one complete
  // row" rule rather than becoming permanently unusable.
  const validationRequired = !!schema;
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

  // MAP5 — at most one transformation step per row in this UI (a real,
  // disclosed scope boundary — the engine itself supports a full
  // pipeline array; this editor does not yet build a multi-step UI).
  const setRowTransformOp = (i: number, op: TransformationOp | "") => {
    setIssues(null);
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, transformations: op ? [{ op, config: defaultConfigFor(op) }] : undefined } : row)));
  };
  const setRowTransformConfig = (i: number, config: Record<string, unknown>) => {
    setIssues(null);
    setRows((r) => r.map((row, idx) => (idx === i && row.transformations?.[0] ? { ...row, transformations: [{ ...row.transformations[0], config }] } : row)));
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
      sourceSchemaFingerprint: schema?.fingerprint ?? basedOn?.sourceSchemaFingerprint ?? "",
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
            <input value={sourceEntity} onChange={(e) => setSourceEntity(e.target.value)} className={inputCls} disabled={!!basedOn} />
          </Field>
        </div>

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
            const step = row.transformations?.[0];
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

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-muted">{t("dataExchange.connectors.mapping.transformation")}</span>
                  <select value={step?.op ?? ""} onChange={(e) => setRowTransformOp(i, e.target.value as TransformationOp | "")} className={inputCls}>
                    <option value="">{t("dataExchange.connectors.mapping.noTransformation")}</option>
                    {UI_TRANSFORMATION_OPS.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                  {step?.op === "parse_decimal" && (
                    <Field label={t("dataExchange.connectors.mapping.decimalSeparator")}>
                      <select
                        value={typeof step.config?.decimalSeparator === "string" ? step.config.decimalSeparator : "."}
                        onChange={(e) => setRowTransformConfig(i, { ...step.config, decimalSeparator: e.target.value })}
                        className={inputCls}
                      >
                        {DECIMAL_SEPARATORS.map((sep) => (
                          <option key={sep} value={sep}>
                            {sep}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {step?.op === "map_boolean" && (
                    <>
                      <Field label={t("dataExchange.connectors.mapping.trueValues")}>
                        <input
                          value={Array.isArray(step.config?.trueValues) ? (step.config.trueValues as string[]).join(",") : ""}
                          onChange={(e) => setRowTransformConfig(i, { ...step.config, trueValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label={t("dataExchange.connectors.mapping.falseValues")}>
                        <input
                          value={Array.isArray(step.config?.falseValues) ? (step.config.falseValues as string[]).join(",") : ""}
                          onChange={(e) => setRowTransformConfig(i, { ...step.config, falseValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                          className={inputCls}
                        />
                      </Field>
                    </>
                  )}
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
              disabled={saving || rows.length === 0 || (validationRequired && !validatedClean)}
              title={validationRequired && !validatedClean ? t("dataExchange.connectors.mapping.saveNeedsCleanValidation") : undefined}
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
