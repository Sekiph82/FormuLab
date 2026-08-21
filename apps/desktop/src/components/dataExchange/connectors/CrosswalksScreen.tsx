import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExternalIdCrosswalk } from "@formulab/shared";
import { loadCrosswalks } from "@/lib/connectorPersistence";
import { Card, Empty, inputCls, Table } from "./ui";

/** Section 14 — a read-oriented Crosswalk explorer over the EXISTING
 *  `external_id_crosswalks` collection. No edit/mutation action exists
 *  anywhere in this screen — the real persistence authority
 *  (`connectorPersistence.ts`) only ever writes a crosswalk entry AFTER
 *  a successful Data Exchange commit, never from a UI-initiated edit. */
export function CrosswalksScreen({ sourceSystemFilter }: { sourceSystemFilter?: string }) {
  const { t } = useTranslation(["session", "common"]);
  const [crosswalks, setCrosswalks] = useState<ExternalIdCrosswalk[]>([]);
  const [sourceSystem, setSourceSystem] = useState(sourceSystemFilter ?? "");
  const [sourceEntity, setSourceEntity] = useState("");
  const [canonicalEntity, setCanonicalEntity] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [canonicalId, setCanonicalId] = useState("");
  const [detail, setDetail] = useState<ExternalIdCrosswalk | null>(null);

  useEffect(() => {
    void loadCrosswalks().then(setCrosswalks);
  }, []);

  // Section 16 — resync the source-system filter when the SELECTED
  // CONNECTION actually changes (never on every render, and never
  // clobbering a manually-typed filter when the connection context did
  // not change — e.g. this screen staying mounted while `selected`
  // changes elsewhere, rather than relying on the initial `useState`
  // value alone, which only ever reflects the connection at first mount).
  const priorFilter = useRef(sourceSystemFilter);
  useEffect(() => {
    if (priorFilter.current !== sourceSystemFilter) {
      priorFilter.current = sourceSystemFilter;
      setSourceSystem(sourceSystemFilter ?? "");
    }
  }, [sourceSystemFilter]);

  const filtered = useMemo(
    () =>
      crosswalks.filter(
        (c) =>
          (!sourceSystem || c.sourceSystemId.toLowerCase().includes(sourceSystem.toLowerCase())) &&
          (!sourceEntity || c.sourceEntity.toLowerCase().includes(sourceEntity.toLowerCase())) &&
          (!canonicalEntity || c.canonicalEntity.toLowerCase().includes(canonicalEntity.toLowerCase())) &&
          (!sourceId || c.sourceRecordId.toLowerCase().includes(sourceId.toLowerCase())) &&
          (!canonicalId || c.canonicalRecordId.toLowerCase().includes(canonicalId.toLowerCase())),
      ),
    [crosswalks, sourceSystem, sourceEntity, canonicalEntity, sourceId, canonicalId],
  );

  return (
    <Card title={t("dataExchange.connectors.tabs.crosswalks")}>
      <p className="mb-3 text-[11px] text-muted">{t("dataExchange.connectors.crosswalks.readOnlyNotice")}</p>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} placeholder={t("dataExchange.connectors.crosswalks.filterSourceSystem")} className={inputCls} />
        <input value={sourceEntity} onChange={(e) => setSourceEntity(e.target.value)} placeholder={t("dataExchange.connectors.crosswalks.filterSourceEntity")} className={inputCls} />
        <input value={canonicalEntity} onChange={(e) => setCanonicalEntity(e.target.value)} placeholder={t("dataExchange.connectors.crosswalks.filterCanonicalEntity")} className={inputCls} />
        <input value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder={t("dataExchange.connectors.crosswalks.filterSourceId")} className={inputCls} />
        <input value={canonicalId} onChange={(e) => setCanonicalId(e.target.value)} placeholder={t("dataExchange.connectors.crosswalks.filterCanonicalId")} className={inputCls} />
      </div>

      {filtered.length === 0 ? (
        <Empty text={t("dataExchange.connectors.crosswalks.empty")} />
      ) : (
        <Table
          headers={[
            t("dataExchange.connectors.crosswalks.sourceSystem"),
            t("dataExchange.connectors.crosswalks.sourceEntity"),
            t("dataExchange.connectors.crosswalks.sourceRecordId"),
            t("dataExchange.connectors.crosswalks.canonicalEntity"),
            t("dataExchange.connectors.crosswalks.canonicalRecordId"),
            t("dataExchange.connectors.crosswalks.lastSeen"),
          ]}
          rows={filtered.map((c) => ({
            key: c.code,
            cells: [
              c.sourceSystemId,
              c.sourceEntity,
              <button key="src" onClick={() => setDetail(c)} className="font-medium text-text hover:underline">
                {c.sourceRecordId}
              </button>,
              c.canonicalEntity,
              c.canonicalRecordId,
              new Date(c.lastSeenAt).toLocaleString(),
            ],
          }))}
        />
      )}

      {detail && (
        <div className="mt-3 rounded-input border border-border-faint bg-surface-2 p-3 text-[11px]">
          <h4 className="mb-2 text-[12px] font-medium text-text">{t("dataExchange.connectors.crosswalks.detail")}</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.sourceSystem")}</dt>
            <dd className="text-text">{detail.sourceSystemId}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.sourceEntity")}</dt>
            <dd className="text-text">{detail.sourceEntity}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.sourceRecordId")}</dt>
            <dd className="text-text">{detail.sourceRecordId}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.canonicalEntity")}</dt>
            <dd className="text-text">{detail.canonicalEntity}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.canonicalRecordId")}</dt>
            <dd className="text-text">{detail.canonicalRecordId}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.firstSeen")}</dt>
            <dd className="text-text">{new Date(detail.firstSeenAt).toLocaleString()}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.lastSeen")}</dt>
            <dd className="text-text">{new Date(detail.lastSeenAt).toLocaleString()}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.crosswalks.status")}</dt>
            <dd className="text-text">{detail.status}</dd>
          </dl>
        </div>
      )}
    </Card>
  );
}
