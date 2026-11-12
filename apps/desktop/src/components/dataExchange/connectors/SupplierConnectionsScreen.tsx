import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectorConnection } from "@formulab/shared";
import { loadConnections } from "@/lib/connectorConnections";
import { SUPPLIER_CONNECTION_CATALOG, type SupplierConnectionSurface } from "@/lib/supplierConnectionCatalog";
import { Badge, Card } from "./ui";

/** Read-only inventory of declared supplier access surfaces. Live state is
 *  joined only through an exact sourceSystemId/surfaceId match in the existing
 *  connector collection; no credentials or parallel status store are used. */
export function SupplierConnectionsScreen() {
  const { t } = useTranslation("session");
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadConnections().then((rows) => {
      if (active) {
        setConnections(rows);
        setLoading(false);
      }
    }).catch(() => {
      if (active) {
        setLoadFailed(true);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  return (
    <Card title={t("dataExchange.connectors.supplierConnections.title")}>
      <p className="mb-3 text-[11px] text-muted">{t("dataExchange.connectors.supplierConnections.intro")}</p>
      {loading && <p className="text-[11px] text-muted">{t("dataExchange.connectors.supplierConnections.loading")}</p>}
      {loadFailed && <p role="alert" className="mb-3 text-[11px] text-error">{t("dataExchange.connectors.supplierConnections.loadError")}</p>}
      <div className="grid gap-2 xl:grid-cols-2">
        {SUPPLIER_CONNECTION_CATALOG.map((surface) => (
          <SupplierSurfaceCard
            key={surface.surfaceId}
            surface={surface}
            connection={connections.find((row) => row.sourceSystemId === surface.surfaceId)}
            loadFailed={loadFailed}
          />
        ))}
      </div>
      {!loading && SUPPLIER_CONNECTION_CATALOG.length === 0 && <p className="text-[11px] text-muted">{t("dataExchange.connectors.supplierConnections.empty")}</p>}
    </Card>
  );
}

function SupplierSurfaceCard({ surface, connection, loadFailed }: { surface: SupplierConnectionSurface; connection?: ConnectorConnection; loadFailed: boolean }) {
  const { t } = useTranslation("session");
  const authState = loadFailed
    ? t("dataExchange.connectors.supplierConnections.stateUnknown")
    : !connection
      ? t("dataExchange.connectors.supplierConnections.notLinked")
    : connection.lifecycleState === "authenticated"
      ? t("dataExchange.connectors.supplierConnections.authenticated")
      : connection.lifecycleState === "expired"
        ? t("dataExchange.connectors.supplierConnections.expired")
        : connection.lifecycleState === "revoked"
          ? t("dataExchange.connectors.supplierConnections.revoked")
          : connection.lifecycleState === "unavailable"
            ? t("dataExchange.connectors.supplierConnections.unavailable")
            : connection.lifecycleState === "manual_assisted"
              ? t("dataExchange.connectors.supplierConnections.userAttended")
              : t("dataExchange.connectors.supplierConnections.notVerified");
  const access = surface.accessMode === "authenticated_manual"
    ? t("dataExchange.connectors.supplierConnections.authenticatedManual")
    : surface.accessMode === "supplier_delivered_manual"
      ? t("dataExchange.connectors.supplierConnections.supplierDeliveredManual")
      : t("dataExchange.connectors.supplierConnections.publicManual");
  const declaredScope = [
    ...surface.scope,
    ...(surface.documentTypes.length ? [surface.documentTypes.join(", ")] : []),
    t("dataExchange.connectors.supplierConnections.marketLanguageUnknown"),
  ];

  return (
    <article className="rounded-input border border-border-faint bg-surface-1 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text">{surface.supplierName}</p>
          <p className="mt-0.5 text-[11px] text-muted">{surface.displayName}</p>
          <p className="mt-0.5 text-[10px] text-muted">{t("dataExchange.connectors.supplierConnections.providerSurface", { provider: surface.providerId, surface: surface.surfaceId })}</p>
        </div>
        <Badge>{access}</Badge>
      </div>
      <dl className="mt-3 grid gap-x-3 gap-y-1 text-[10px] sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-muted">{t("dataExchange.connectors.supplierConnections.authentication")}</dt>
        <dd className="text-text">{authState}</dd>
        <dt className="font-medium text-muted">{t("dataExchange.connectors.supplierConnections.lastCheck")}</dt>
        <dd className="text-text">{connection?.lastTestedAt ? new Date(connection.lastTestedAt).toLocaleString() : loadFailed ? t("dataExchange.connectors.supplierConnections.stateUnknown") : t("dataExchange.connectors.supplierConnections.neverChecked")}</dd>
        <dt className="font-medium text-muted">{t("dataExchange.connectors.supplierConnections.scope")}</dt>
        <dd className="text-text">{declaredScope.length ? declaredScope.join(" · ") : t("dataExchange.connectors.supplierConnections.scopeUnknown")}</dd>
      </dl>
      {surface.entryPointUrl && <p className="mt-2 break-all text-[10px] text-muted">{surface.entryPointUrl}</p>}
      {surface.limitations.length > 0 && (
        <details className="mt-2 text-[10px]">
          <summary className="cursor-pointer font-medium text-muted">{t("dataExchange.connectors.supplierConnections.limitations", { count: surface.limitations.length })}</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
            {surface.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </details>
      )}
    </article>
  );
}
