import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalRole, ConnectorConnection } from "@formulab/shared";
import { cn } from "@/lib/cn";
import { ConnectionsScreen } from "./ConnectionsScreen";
import { SourceExplorerScreen } from "./SourceExplorerScreen";
import { MappingProfilesScreen } from "./MappingProfilesScreen";
import { CrosswalksScreen } from "./CrosswalksScreen";
import { ImportRunsScreen } from "./ImportRunsScreen";
import { PrepareReviewScreen } from "./PrepareReviewScreen";

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
      {tab === "explorer" && <SourceExplorerScreen connection={selected} />}
      {tab === "mapping" && <MappingProfilesScreen connection={selected} actorUserId={actorUserId} />}
      {tab === "crosswalks" && <CrosswalksScreen sourceSystemFilter={selected?.sourceSystemId} />}
      {tab === "runs" && <ImportRunsScreen />}
      {tab === "review" && <PrepareReviewScreen connection={selected} actorUserId={actorUserId} actorRole={actorRole} />}
    </div>
  );
}
