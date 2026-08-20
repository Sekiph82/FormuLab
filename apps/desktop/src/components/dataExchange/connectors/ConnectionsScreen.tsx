import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { ConnectorConnection } from "@formulab/shared";
import { deleteConnection, duplicateConnection, importRunCountFor, lastImportTimestampFor, loadConnections, mappingProfileCountFor, setConnectionArchived } from "@/lib/connectorConnections";
import { AddConnectionDialog } from "./AddConnectionDialog";
import { Badge, Card, Empty, Table } from "./ui";

/** CFUI1/CFUI2/CFUI3/CFUI25-adjacent — the real Connections screen: lists
 *  saved `ConnectorConnection` records (real persistence,
 *  `connectorConnections.ts`), never a mock. Actions are limited to what
 *  the real persistence authority genuinely supports (Section 3: no
 *  invented destructive lifecycle). */
export function ConnectionsScreen({
  actorUserId,
  onOpenExplorer,
  onOpenMapping,
}: {
  actorUserId: string;
  onOpenExplorer: (connection: ConnectorConnection) => void;
  onOpenMapping: (connection: ConnectorConnection) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [meta, setMeta] = useState<Record<string, { runs: number; lastImport?: string; profiles: number }>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const rows = await loadConnections();
    setConnections(rows);
    const entries = await Promise.all(
      rows.map(async (c) => [c.code, { runs: await importRunCountFor(c), lastImport: await lastImportTimestampFor(c), profiles: await mappingProfileCountFor(c.sourceSystemId) }] as const),
    );
    setMeta(Object.fromEntries(entries));
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const onDuplicate = async (c: ConnectorConnection) => {
    await duplicateConnection(c, actorUserId);
    await refresh();
  };
  const onToggleArchive = async (c: ConnectorConnection) => {
    await setConnectionArchived(c, !c.archived);
    await refresh();
  };
  const onDelete = async (c: ConnectorConnection) => {
    if (meta[c.code]?.runs) return; // never delete a connection with real import history
    if (!window.confirm(t("dataExchange.connectors.connections.deleteConfirm", { name: c.name }))) return;
    await deleteConnection(c.code);
    await refresh();
  };

  const visible = connections.filter((c) => !c.archived);

  return (
    <Card
      title={t("dataExchange.connectors.tabs.connections")}
      actions={
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
          <Plus size={12} /> {t("dataExchange.connectors.connections.addConnection")}
        </button>
      }
    >
      {!loading && visible.length === 0 && <Empty text={t("dataExchange.connectors.connections.empty")} />}
      {visible.length > 0 && (
        <Table
          headers={[
            t("dataExchange.connectors.connections.name"),
            t("dataExchange.connectors.connections.type"),
            t("dataExchange.connectors.connections.sourceSystem"),
            t("dataExchange.connectors.connections.status"),
            t("dataExchange.connectors.connections.lastImport"),
            t("dataExchange.connectors.connections.mappingProfiles"),
            t("dataExchange.connectors.connections.actions"),
          ]}
          rows={visible.map((c) => ({
            key: c.code,
            cells: [
              <button key="name" onClick={() => onOpenExplorer(c)} className="font-medium text-text hover:underline">
                {c.name}
              </button>,
              c.connectorType,
              c.sourceSystemId,
              <StatusBadge key="status" status={c.status} />,
              meta[c.code]?.lastImport ? new Date(meta[c.code].lastImport!).toLocaleString() : t("dataExchange.connectors.connections.never"),
              String(meta[c.code]?.profiles ?? 0),
              <div key="actions" className="flex flex-wrap gap-1">
                <button onClick={() => onOpenExplorer(c)} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                  {t("dataExchange.connectors.connections.open")}
                </button>
                <button onClick={() => onOpenMapping(c)} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                  {t("dataExchange.connectors.tabs.mapping")}
                </button>
                <button onClick={() => void onDuplicate(c)} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                  {t("dataExchange.connectors.connections.duplicate")}
                </button>
                <button onClick={() => void onToggleArchive(c)} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                  {t("dataExchange.connectors.connections.disable")}
                </button>
                <button
                  onClick={() => void onDelete(c)}
                  disabled={!!meta[c.code]?.runs}
                  title={meta[c.code]?.runs ? t("dataExchange.connectors.connections.deleteBlocked") : undefined}
                  className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-error hover:bg-surface-2 disabled:opacity-40"
                >
                  {t("common:actions.remove")}
                </button>
              </div>,
            ],
          }))}
        />
      )}

      {connections.some((c) => c.archived) && (
        <div className="mt-4">
          <h4 className="mb-1 text-[11px] font-medium text-muted">{t("dataExchange.connectors.connections.disabledSection")}</h4>
          <Table
            headers={[t("dataExchange.connectors.connections.name"), t("dataExchange.connectors.connections.type"), t("dataExchange.connectors.connections.actions")]}
            rows={connections
              .filter((c) => c.archived)
              .map((c) => ({
                key: c.code,
                cells: [
                  c.name,
                  c.connectorType,
                  <button key="enable" onClick={() => void onToggleArchive(c)} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                    {t("dataExchange.connectors.connections.enable")}
                  </button>,
                ],
              }))}
          />
        </div>
      )}

      {showAdd && (
        <AddConnectionDialog
          actorUserId={actorUserId}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            void refresh();
          }}
        />
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: ConnectorConnection["status"] }) {
  const { t } = useTranslation("session");
  if (status === "ready") return <Badge tone="ok">{t("dataExchange.connectors.connections.statusReady")}</Badge>;
  if (status === "error") return <Badge tone="error">{t("dataExchange.connectors.connections.statusError")}</Badge>;
  return <Badge>{t("dataExchange.connectors.connections.statusNeverTested")}</Badge>;
}
