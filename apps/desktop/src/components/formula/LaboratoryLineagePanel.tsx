import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildLaboratoryLineage, type AuditEvent, type LaboratoryLineageRecordSet, type LineageEdge, type LineageNode } from "@formulab/shared";

function nodeKey(node: Pick<LineageNode, "entityType" | "id">): string {
  return `${node.entityType}:${node.id}`;
}

export function LaboratoryLineagePanel({ records, auditEvents = [], onSelectVersion, loading = false, loadError = false }: { records: LaboratoryLineageRecordSet; auditEvents?: AuditEvent[]; onSelectVersion?: (id: string) => void; loading?: boolean; loadError?: boolean }) {
  const { t } = useTranslation("session");
  const lineage = useMemo(() => buildLaboratoryLineage(records), [records]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const focusedNode = lineage.nodes.find((node) => nodeKey(node) === focusedKey) ?? lineage.nodes[0];
  const focusedId = focusedNode ? nodeKey(focusedNode) : undefined;
  const relatedEdges = focusedId ? lineage.edges.filter((edge) => edge.from === focusedId || edge.to === focusedId) : [];
  const relatedAudit = auditEvents.filter((event) => /approval|recommend|trial_created|retraining|human_gate/i.test(`${event.action} ${event.detail ?? ""}`));
  const focusNode = (node: LineageNode) => {
    setFocusedKey(nodeKey(node));
    if (node.entityType === "formulation_version") onSelectVersion?.(node.id);
  };

  return (
    <section aria-label={t("builder.lineageTitle")} className="space-y-3 p-4">
      <header>
        <h2 className="text-sm font-semibold text-text">{t("builder.lineageTitle")}</h2>
        <p className="mt-1 text-xs text-muted">{t("builder.lineageDescription")}</p>
      </header>
      {loading ? <p className="rounded-input border border-border-faint p-3 text-xs text-muted">{t("builder.loadingProject")}</p> : loadError ? <p role="alert" className="rounded-input border border-warning/40 bg-warning/5 p-3 text-xs text-muted">{t("builder.lineageLoadError")}</p> : lineage.nodes.length === 0 ? (
        <p className="rounded-input border border-border-faint p-3 text-xs text-muted">{t("builder.lineageNoRecords")}</p>
      ) : (
        <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(20rem,1.2fr)]">
          <div className="max-h-72 space-y-1 overflow-auto rounded-input border border-border-faint p-2" aria-label={t("builder.lineageRecords")}>
            {lineage.nodes.map((node) => {
              const key = nodeKey(node);
              return (
                <button key={key} type="button" aria-pressed={key === focusedId} onClick={() => focusNode(node)} className={`block w-full rounded-input px-2 py-1.5 text-left text-xs ${key === focusedId ? "bg-accent/10 text-text" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
                  <span className="font-medium">{node.entityType}</span><span className="mx-1">·</span><span className="break-all">{node.code ? `${node.code} / ` : ""}{node.id}</span>
                  {node.version !== undefined && <span className="ml-1">{t("builder.lineageVersion", { version: node.version })}</span>}
                  {node.status && <span className="ml-2 rounded bg-surface-2 px-1">{node.status}</span>}
                  {node.timestamp && <span className="mt-0.5 block text-[10px] text-muted">{node.timestamp}</span>}
                </button>
              );
            })}
          </div>
          <div className="min-w-0 space-y-2">
            {focusedNode && <p className="break-all text-xs font-medium text-text">{focusedNode.entityType}: {focusedNode.id}</p>}
            <h3 className="text-xs font-semibold text-muted">{t("builder.lineageRelationships")}</h3>
            {relatedEdges.length === 0 ? <p className="text-xs text-muted">{t("builder.lineageNoRelations")}</p> : relatedEdges.map((edge) => (
              <RelationRow key={`${edge.from}|${edge.relationship}|${edge.to}`} edge={edge} node={lineage.nodes.find((candidate) => nodeKey(candidate) === (edge.from === focusedId ? edge.to : edge.from))} onFocus={focusNode} />
            ))}
          </div>
        </div>
      )}
      <div className="rounded-input border border-border-faint p-3">
        <h3 className="text-xs font-semibold text-text">{t("builder.lineageAuditContext")}</h3>
        {relatedAudit.length === 0 ? <p className="mt-1 text-xs text-muted">{t("builder.lineageNoAudit")}</p> : (
          <ul className="mt-2 space-y-1.5">
            {relatedAudit.map((event) => <li key={event.id} className="text-xs text-muted"><span className="font-medium text-text">{event.action}</span> · {event.actorKind}: {event.actor} · {event.at}{event.detail ? ` · ${event.detail}` : ""}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

function RelationRow({ edge, node, onFocus }: { edge: LineageEdge; node?: LineageNode; onFocus: (node: LineageNode) => void }) {
  const { t } = useTranslation("session");
  const reference = node ? `${node.entityType}:${node.id}` : edge.to;
  const stateKey = edge.status === "resolved" ? "lineageResolved" : edge.status === "missing" ? "lineageMissing" : "lineageInvalid";
  return (
    <div data-lineage-status={edge.status} className={`flex items-start justify-between gap-2 rounded-input border px-2 py-1.5 text-xs ${edge.status === "resolved" ? "border-border-faint" : "border-warning/40 bg-warning/5"}`}>
      <div className="min-w-0"><span className="font-medium text-text">{edge.relationship}</span><span className="mx-1 text-muted">→</span><span className="break-all text-muted">{reference}</span><span className="ml-2 text-[10px] text-muted">{t(`builder.${stateKey}`)}</span></div>
      {node && <button type="button" className="shrink-0 text-accent underline" onClick={() => onFocus(node)}>{t("builder.lineageOpen")}</button>}
    </div>
  );
}
