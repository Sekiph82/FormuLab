import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { effectiveMappingProfileStatus, type ConnectorConnection, type MappingProfile, type SourceSchema } from "@formulab/shared";
import { loadMappingProfiles } from "@/lib/connectorPersistence";
import { Badge, Card, Empty, Table } from "./ui";
import { MappingProfileEditorDialog } from "./MappingProfileEditorDialog";

/** Section 11 — real Mapping Profiles list, reading the EXISTING
 *  `mapping_profiles` collection through `loadMappingProfiles()`
 *  (`connectorPersistence.ts`) and the EXISTING
 *  `effectiveMappingProfileStatus()` for the derived active/superseded
 *  fact — never recomputed in React. */
export function MappingProfilesScreen({
  connection,
  actorUserId,
  schema,
  sourceFieldOptions,
  prefillEntity,
}: {
  connection: ConnectorConnection | null;
  actorUserId: string;
  /** Section 11 — the real schema from the most recent Source Explorer
   *  inspection of this same connection, if any. Optional: a profile
   *  can still be created/edited without one (matches the existing
   *  disclosed limitation), but when present it powers real validation
   *  and exact-name matching in the editor. */
  schema?: SourceSchema;
  sourceFieldOptions?: string[];
  prefillEntity?: string;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [profiles, setProfiles] = useState<MappingProfile[]>([]);
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

  return (
    <Card
      title={t("dataExchange.connectors.tabs.mapping")}
      actions={
        <button onClick={() => setEditing({})} className="flex items-center gap-1 rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
          <Plus size={12} /> {t("dataExchange.connectors.mapping.createProfile")}
        </button>
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
            return {
              key: p.code,
              cells: [
                <button key="code" onClick={() => setEditing({ profile: p })} className="font-medium text-text hover:underline">
                  {p.code}
                </button>,
                p.sourceEntity,
                targets.join(", ") || "—",
                `v${p.profileVersion}`,
                <Badge key="status" tone={effective === "active" ? "ok" : effective === "superseded" ? "muted" : "warn"}>{effective}</Badge>,
                new Date(p.updatedAt).toLocaleString(),
                <button key="newver" onClick={() => setEditing({ profile: p })} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                  {t("dataExchange.connectors.mapping.newVersion")}
                </button>,
              ],
            };
          })}
        />
      )}

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
