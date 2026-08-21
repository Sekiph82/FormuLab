import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { effectiveMappingProfileStatus, isSchemaChanged, type ConnectorConnection, type MappingProfile, type SourceSchema } from "@formulab/shared";
import { loadMappingProfiles } from "@/lib/connectorPersistence";
import { Badge, Card, Empty, Field, Modal, Table } from "./ui";
import { MappingProfileEditorDialog } from "./MappingProfileEditorDialog";

/** Section 11 — real Mapping Profiles list, reading the EXISTING
 *  `mapping_profiles` collection through `loadMappingProfiles()`
 *  (`connectorPersistence.ts`) and the EXISTING
 *  `effectiveMappingProfileStatus()` for the derived active/superseded
 *  fact — never recomputed in React. */
export function MappingProfilesScreen({
  connection,
  actorUserId,
  canWrite = true,
  schema,
  sourceFieldOptions,
  prefillEntity,
  onUseForImport,
}: {
  connection: ConnectorConnection | null;
  actorUserId: string;
  /** Section 16/AUTH1 — the EXISTING dataExchange "create" capability. */
  canWrite?: boolean;
  /** Section 11 — the real schema from the most recent Source Explorer
   *  inspection of this same connection, if any. Optional: a profile
   *  can still be created/edited without one (matches the existing
   *  disclosed limitation), but when present it powers real validation
   *  and exact-name matching in the editor. */
  schema?: SourceSchema;
  sourceFieldOptions?: string[];
  prefillEntity?: string;
  /** Section 15/MAP8 — "Use for Import" carries the validated profile's
   *  own code to Prepare Review, so the operator never retypes it. */
  onUseForImport?: (profileCode: string) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [profiles, setProfiles] = useState<MappingProfile[]>([]);
  // Section 14/MPV1-MPV6 — "View" (read-only) and "Create New Version"
  // (the editor, always producing a NEW version) are two DISTINCT
  // actions now, never the same click opening an ambiguous editor.
  const [viewing, setViewing] = useState<MappingProfile | null>(null);
  const [editing, setEditing] = useState<{ profile?: MappingProfile } | null>(null);

  const refresh = () => void loadMappingProfiles().then(setProfiles);
  useEffect(refresh, []);

  const scoped = useMemo(() => (connection ? profiles.filter((p) => p.sourceSystemId === connection.sourceSystemId) : profiles), [profiles, connection]);
  const byFamily = useMemo(() => {
    const families = new Map<string, MappingProfile[]>();
    for (const p of scoped) {
      if (!families.has(p.profileId)) families.set(p.profileId, []);
      families.get(p.profileId)!.push(p);
    }
    return families;
  }, [scoped]);
  // MPV4 — "Create New Version" is only ever offered on the family's own
  // latest persisted version; deriving it from an older one would create
  // a duplicate/skipped version number the storage layer would reject.
  const latestCodeByFamily = useMemo(() => {
    const out = new Map<string, string>();
    for (const [profileId, versions] of byFamily) {
      out.set(profileId, versions.reduce((a, b) => (b.profileVersion > a.profileVersion ? b : a)).code);
    }
    return out;
  }, [byFamily]);

  return (
    <Card
      title={t("dataExchange.connectors.tabs.mapping")}
      actions={
        canWrite && (
          <button onClick={() => setEditing({})} className="flex items-center gap-1 rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
            <Plus size={12} /> {t("dataExchange.connectors.mapping.createProfile")}
          </button>
        )
      }
    >
      {scoped.length === 0 ? (
        <Empty text={t("dataExchange.connectors.mapping.empty")} />
      ) : (
        <Table
          headers={[
            t("dataExchange.connectors.mapping.code"),
            t("dataExchange.connectors.mapping.sourceEntity"),
            t("dataExchange.connectors.mapping.targetTemplates"),
            t("dataExchange.connectors.mapping.profileVersion"),
            t("dataExchange.connectors.mapping.status"),
            t("dataExchange.connectors.mapping.updated"),
            t("dataExchange.connectors.mapping.actions"),
          ]}
          rows={scoped.map((p) => {
            const family = byFamily.get(p.profileId) ?? [p];
            const effective = effectiveMappingProfileStatus(p, family);
            const targets = [...new Set(p.fieldMappings.map((m) => m.targetTemplate))];
            const isLatest = latestCodeByFamily.get(p.profileId) === p.code;
            return {
              key: p.code,
              cells: [
                <button key="code" onClick={() => setViewing(p)} className="font-medium text-text hover:underline">
                  {p.code}
                </button>,
                p.sourceEntity,
                targets.join(", ") || "—",
                `v${p.profileVersion}`,
                <Badge key="status" tone={effective === "active" ? "ok" : effective === "superseded" ? "muted" : "warn"}>{effective}</Badge>,
                new Date(p.updatedAt).toLocaleString(),
                <div key="actions" className="flex flex-wrap gap-1">
                  <button onClick={() => setViewing(p)} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                    {t("dataExchange.connectors.mapping.viewProfile")}
                  </button>
                  {canWrite && isLatest && (
                    <button onClick={() => setEditing({ profile: p })} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                      {t("dataExchange.connectors.mapping.newVersion")}
                    </button>
                  )}
                  {onUseForImport && (() => {
                    // VAL8-11 — "Use for Import" must only present valid/
                    // effective profiles COMPATIBLE with the currently
                    // inspected source schema, never just `effective ===
                    // "active"` alone. Reuses the EXISTING `isSchemaChanged()`
                    // authority — never a second schema-decision
                    // implementation. Unavailable (not hidden) with a title
                    // explaining why, so the operator always knows what to
                    // do next.
                    const schemaMismatch = !!schema && isSchemaChanged(p.sourceSchemaFingerprint, schema.fingerprint);
                    const reason = effective !== "active"
                      ? t("dataExchange.connectors.mapping.useForImportNeedsActive")
                      : !schema
                        ? t("dataExchange.connectors.mapping.useForImportNeedsSchema")
                        : schemaMismatch
                          ? t("dataExchange.connectors.mapping.schemaMismatchBlocking")
                          : undefined;
                    const available = reason === undefined;
                    return (
                      <button
                        onClick={() => available && onUseForImport(p.code)}
                        disabled={!available}
                        title={reason}
                        className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        {t("dataExchange.connectors.mapping.useForImport")}
                      </button>
                    );
                  })()}
                </div>,
              ],
            };
          })}
        />
      )}

      {viewing && <MappingProfileDetailDialog profile={viewing} onClose={() => setViewing(null)} />}

      {editing && (
        <MappingProfileEditorDialog
          connection={connection}
          basedOn={editing.profile}
          schema={schema}
          sourceFieldOptions={sourceFieldOptions}
          defaultSourceEntity={editing.profile ? undefined : prefillEntity}
          actorUserId={actorUserId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Card>
  );
}

/** Section 14 — a purely READ-ONLY detail view. No field is editable, no
 *  Save action exists anywhere in this component — a historical (or
 *  current) profile version is never presented as though it were being
 *  edited in place. */
function MappingProfileDetailDialog({ profile, onClose }: { profile: MappingProfile; onClose: () => void }) {
  const { t } = useTranslation(["session", "common"]);
  return (
    <Modal title={`${t("dataExchange.connectors.mapping.viewProfile")} — ${profile.code}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
          <Field label={t("dataExchange.connectors.mapping.sourceSystem")}>
            <div className="text-text">{profile.sourceSystemId}</div>
          </Field>
          <Field label={t("dataExchange.connectors.mapping.sourceEntity")}>
            <div className="text-text">{profile.sourceEntity}</div>
          </Field>
          <Field label={t("dataExchange.connectors.mapping.profileVersion")}>
            {/* eslint-disable-next-line i18next/no-literal-string -- version prefix glyph, not natural-language text */}
            <div className="text-text">v{profile.profileVersion}</div>
          </Field>
          <Field label={t("dataExchange.connectors.mapping.schemaFingerprint")}>
            <div className="truncate text-text">{profile.sourceSchemaFingerprint}</div>
          </Field>
          {profile.supersedesProfileCode && (
            <Field label={t("dataExchange.connectors.mapping.supersedes")}>
              <div className="text-text">{profile.supersedesProfileCode}</div>
            </Field>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-[11px] font-medium text-muted">{t("dataExchange.connectors.mapping.sourceField")}</h4>
          <Table
            headers={[t("dataExchange.connectors.mapping.sourceField"), t("dataExchange.connectors.mapping.targetTemplate"), t("dataExchange.connectors.mapping.targetField")]}
            rows={profile.fieldMappings.map((m, i) => ({ key: String(i), cells: [m.sourceField, m.targetTemplate, m.targetField] }))}
          />
        </div>

        {profile.constantMappings.length > 0 && (
          <div>
            <h4 className="mb-1 text-[11px] font-medium text-muted">{t("dataExchange.connectors.mapping.constantMapping")}</h4>
            <Table
              headers={[t("dataExchange.connectors.mapping.targetTemplate"), t("dataExchange.connectors.mapping.targetField"), t("dataExchange.connectors.mapping.constantValue")]}
              rows={profile.constantMappings.map((c, i) => ({ key: String(i), cells: [c.targetTemplate, c.targetField, c.value] }))}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
