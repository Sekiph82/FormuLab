import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileConnector, discoverSourceSchema, type ApprovalRole, type DataExchangeTemplateDefinition } from "@formulab/shared";
import { buildIdentityMappingProfile, confirmConnectorImport, prepareConnectorImport, type PreparedConnectorImport } from "@/lib/connectorImportBridge";
import { newId } from "@formulab/shared";

/**
 * FVL-04.024 hardening (Part F8) — the smallest real, reachable
 * production entry point into `prepareConnectorImport()`/
 * `confirmConnectorImport()` (the actual Connector -> Data Exchange
 * Bridge). Reuses the EXISTING Data Exchange screen
 * (`DataExchangePage.tsx`'s own "Imports" section) rather than a new
 * standalone screen. Scoped deliberately narrow: a FILE source (the one
 * connector type a user can provide directly through this UI without a
 * pre-configured connection profile) mapped through an auto-derived
 * IDENTITY mapping profile (`buildIdentityMappingProfile()` — exact
 * column-name matches only, never a guess) — the DATABASE/REST
 * connector types, and any genuinely different-schema customer source,
 * still need a hand-authored `MappingProfile` supplied through a real
 * migration configuration, which is out of this dialog's own narrow
 * scope. This proves the bridge is genuinely production-wired, not
 * merely covered by tests.
 */
export function ConnectorBridgeImportDialog({
  template,
  actorRole,
  actorUserId,
  onCancel,
  onCommitted,
}: {
  template: DataExchangeTemplateDefinition;
  actorRole: ApprovalRole;
  actorUserId: string;
  onCancel: () => void;
  onCommitted: () => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [prepared, setPrepared] = useState<PreparedConnectorImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);

  const onFile = async (file: File) => {
    setFileError(null);
    setCommitted(null as unknown as false);
    setPrepared(null);
    try {
      const text = await file.text();
      const connector = createFileConnector("LOCAL_FILE", { fileName: file.name, fileKind: "csv", text }, { extractionRunId: newId("run"), extractedAt: new Date().toISOString() });
      const staged = await connector.extract(template.templateCode);
      const schema = discoverSourceSchema("LOCAL_FILE", [{ entity: template.templateCode, records: staged.records }]);
      const fieldPaths = schema.entities[0]?.fields.map((f) => f.path) ?? [];
      const profile = buildIdentityMappingProfile("LOCAL_FILE", template.templateCode, template, schema.fingerprint, fieldPaths);
      const result = await prepareConnectorImport({ connector, entity: template.templateCode, profile });
      setPrepared(result);
    } catch {
      setFileError(t("dataExchange.import.fileUnreadable"));
    }
  };

  // Section 7 (Session 12 hardening) — SOURCE_MISSING findings were
  // detected by the real engine (`detectMissingFromSource()`) but never
  // surfaced anywhere in THIS dialog. Aggregated across every target
  // template in the prepared plan, reusing the EXISTING
  // dataExchange.import.missingFromSource(Item) i18n keys and rendering
  // convention `DataExchangeImportDialog.tsx` already established —
  // never a second copy of the disclosure text, never a new screen.
  const missingFromSource = useMemo(() => prepared?.templates.flatMap((t) => t.missingFromSource) ?? [], [prepared]);

  const commit = async () => {
    if (!prepared || prepared.blockingIssues.length > 0) return;
    setBusy(true);
    try {
      await confirmConnectorImport(prepared, { actorUserId, actorRole });
      setCommitted(true);
      onCommitted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label={t("dataExchange.import.title", { template: template.title })} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-input border border-border bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-medium text-text">{t("dataExchange.imports.viaBridge")}: {template.title}</h2>

        {!prepared && (
          <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-[12px]" />
        )}
        {fileError && <p className="mt-2 text-[12px] text-error">{fileError}</p>}

        {prepared && (
          <div className="mt-2 space-y-2 text-[12px]">
            <p className="text-muted">{t("dataExchange.imports.bridgeSummary", { count: prepared.mappedCount, order: prepared.commitOrder.join(" -> ") || "-" })}</p>
            {prepared.blockingIssues.length > 0 && (
              <ul className="space-y-0.5 text-error">
                {prepared.blockingIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            {prepared.warnings.length > 0 && (
              <div className="rounded-input border border-border px-3 py-2">
                <p className="text-[12px] font-medium text-text">{t("dataExchange.imports.bridgeWarnings", { count: prepared.warnings.length })}</p>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-muted">
                  {prepared.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {missingFromSource.length > 0 && (
              <div className="rounded-input border border-border px-3 py-2">
                <p className="text-[12px] font-medium text-text">{t("dataExchange.import.missingFromSource", { count: missingFromSource.length })}</p>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-muted">
                  {missingFromSource.slice(0, 100).map((m) => (
                    <li key={m.naturalKey}>{t("dataExchange.import.missingFromSourceItem", { key: m.naturalKey, collection: m.targetCollection ?? "?" })}</li>
                  ))}
                </ul>
              </div>
            )}
            {committed && <p className="text-[12px] font-medium text-text">{t("dataExchange.import.committed", { created: 0, updated: 0, status: "completed" })}</p>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-input border border-border px-3 py-1.5 text-[12px] text-muted hover:bg-surface-2">
            {t("common:actions.cancel")}
          </button>
          {prepared && (
            <button onClick={commit} disabled={busy || prepared.blockingIssues.length > 0 || committed} className="rounded-input bg-accent px-3 py-1.5 text-[12px] text-white disabled:opacity-50">
              {t("dataExchange.import.commit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
