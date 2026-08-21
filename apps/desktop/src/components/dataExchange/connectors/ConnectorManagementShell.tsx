import { useState } from "react";
import { useTranslation } from "react-i18next";
import { can, type ApprovalRole, type ConnectorConnection, type ConnectorResult, type SourceSchema } from "@formulab/shared";
import { cn } from "@/lib/cn";
import { ConnectionsScreen } from "./ConnectionsScreen";
import { SourceExplorerScreen } from "./SourceExplorerScreen";
import { MappingProfilesScreen } from "./MappingProfilesScreen";
import { CrosswalksScreen } from "./CrosswalksScreen";
import { ImportRunsScreen } from "./ImportRunsScreen";
import { PrepareReviewScreen } from "./PrepareReviewScreen";
import { Card, Empty } from "./ui";

type ConnectorTab = "connections" | "explorer" | "mapping" | "crosswalks" | "runs" | "review";
const TABS: ConnectorTab[] = ["connections", "explorer", "mapping", "crosswalks", "runs", "review"];

/** Section 2 — the Connector Management shell, mounted as a new section
 *  inside the EXISTING Data Exchange Center (`DataExchangePage.tsx`) —
 *  never a disconnected second workspace. Owns only UI navigation/
 *  selection state; every real capability (schema discovery, mapping,
 *  crosswalk, prepare/confirm) is delegated to the existing engines
 *  through each sub-screen. */
export function ConnectorManagementShell({ actorUserId, actorRole }: { actorUserId: string; actorRole: ApprovalRole }) {
  const { t } = useTranslation("session");
  const [tab, setTab] = useState<ConnectorTab>("connections");
  const [selected, setSelected] = useState<ConnectorConnection | null>(null);
  // Section 11 — the most recent successful Source Explorer inspection
  // for the CURRENTLY selected connection, published upward so Mapping
  // Profiles can consume the real discovered schema/entity/sample
  // instead of the operator retyping an entity blind. Transient UI
  // state only — never a second persistence store.
  const [lastInspection, setLastInspection] = useState<{ sourceSystemId: string; entity: string; schema: SourceSchema; staged: ConnectorResult | null } | null>(null);
  const inspectionForSelected = selected && lastInspection?.sourceSystemId === selected.sourceSystemId ? lastInspection : null;

  // Section 16/AUTH1-AUTH4 — the EXISTING Data Exchange policy area
  // (`packages/shared/src/engine/rolePolicy.ts`), never a new permission
  // system. Frontend gating is UX only — the real, unweakened authority
  // remains the backend's own role check inside `commitDataExchangeRows()`
  // (reached only through `confirmConnectorImport()`). Note: the CURRENT
  // policy matrix has no role holding "view" without "create" for
  // dataExchange (every role that can view can also create, or holds
  // neither) — there is no genuinely partial-access role to gate
  // differently, so `canWrite` mirrors `canView` today; both are checked
  // independently and defensively in case the matrix is ever refined.
  const canViewConnectors = can(actorRole, "dataExchange", "view");
  const canWriteConnectors = can(actorRole, "dataExchange", "create");

  if (!canViewConnectors) {
    return (
      <Card title={t("dataExchange.connectors.tabs.connections")}>
        <Empty text={t("dataExchange.connectors.accessDenied")} />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap gap-1 border-b border-border-faint pb-2">
        {TABS.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={cn("rounded-input px-2.5 py-1 text-[11px]", tab === tb ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text")}
          >
            {t(`dataExchange.connectors.tabs.${tb}`)}
          </button>
        ))}
        {selected && <span className="ml-auto self-center text-[11px] text-muted">{selected.name}</span>}
      </nav>

      {tab === "connections" && (
        <ConnectionsScreen
          actorUserId={actorUserId}
          canWrite={canWriteConnectors}
          onOpenExplorer={(c) => {
            setSelected(c);
            // eslint-disable-next-line i18next/no-literal-string -- ConnectorTab literal value, not display text
            setTab("explorer");
          }}
          onOpenMapping={(c) => {
            setSelected(c);
            // eslint-disable-next-line i18next/no-literal-string -- ConnectorTab literal value, not display text
            setTab("mapping");
          }}
        />
      )}
      {tab === "explorer" && (
        <SourceExplorerScreen
          connection={selected}
          onInspected={(entity, schema, staged) => selected && setLastInspection({ sourceSystemId: selected.sourceSystemId, entity, schema, staged })}
          onCreateMappingProfile={() => {
            // eslint-disable-next-line i18next/no-literal-string -- ConnectorTab literal value, not display text
            setTab("mapping");
          }}
        />
      )}
      {tab === "mapping" && (
        <MappingProfilesScreen
          connection={selected}
          actorUserId={actorUserId}
          canWrite={canWriteConnectors}
          schema={inspectionForSelected?.schema}
          sourceFieldOptions={inspectionForSelected?.schema.entities[0]?.fields.map((f) => f.path)}
          prefillEntity={inspectionForSelected?.entity}
        />
      )}
      {tab === "crosswalks" && <CrosswalksScreen sourceSystemFilter={selected?.sourceSystemId} />}
      {tab === "runs" && <ImportRunsScreen />}
      {tab === "review" && <PrepareReviewScreen connection={selected} actorUserId={actorUserId} actorRole={actorRole} canWrite={canWriteConnectors} />}
    </div>
  );
}
