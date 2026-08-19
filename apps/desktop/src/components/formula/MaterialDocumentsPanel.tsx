import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import type { MaterialDocument, Supplier } from "@formulab/shared";
import { listRecords } from "@/lib/masterdata";

type TypeFilter = "all" | "TDS" | "SDS" | "specification";
const TYPE_FILTERS: TypeFilter[] = ["all", "TDS", "SDS", "specification"];

/**
 * FVL-04.003/.004 hardening — the real per-material document viewer.
 * Canonical source is `material_documents` (metadata only — the schema's
 * own doc comment says importing a row never attaches a file, so this
 * viewer never renders an "open file" action; `fileName` is provenance
 * metadata, not proof a binary exists). `RawMaterial.documents[]` is never
 * read or written here — it stays the confirmed dead/orphaned path.
 *
 * This viewer displays documents. It does not decide safe/unsafe or
 * compliant/non-compliant — SDS presence is evidence, not a Safety
 * verdict; TDS presence is technical documentation, not material
 * approval; a specification document's presence is not a finished-product
 * specification verdict. `verificationStatus` is shown only as the
 * document's own review state.
 */
export function MaterialDocumentsPanel({ materialCode, suppliers }: { materialCode: string; suppliers: Supplier[] }) {
  const { t } = useTranslation(["session", "common"]);
  const [documents, setDocuments] = useState<MaterialDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listRecords("material_documents")
      .then((rows) => {
        if (cancelled) return;
        setDocuments((rows as unknown as MaterialDocument[]).filter((d) => d.materialCode === materialCode));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [materialCode]);

  const supplierName = (code?: string) => (code ? (suppliers.find((s) => s.code === code)?.displayName ?? code) : undefined);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(
    () => (typeFilter === "all" ? documents : documents.filter((d) => d.documentType === typeFilter)),
    [documents, typeFilter],
  );
  const sorted = [...filtered].sort((a, b) => a.documentType.localeCompare(b.documentType) || (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));

  const counts = useMemo(() => {
    const tds = documents.filter((d) => d.documentType === "TDS").length;
    const sds = documents.filter((d) => d.documentType === "SDS").length;
    const spec = documents.filter((d) => d.documentType === "specification").length;
    const expired = documents.filter((d) => d.expiryDate && d.expiryDate < today).length;
    const unverified = documents.filter((d) => d.verificationStatus !== "verified").length;
    return { tds, sds, spec, expired, unverified };
  }, [documents, today]);

  const filterLabels: Record<TypeFilter, string> = {
    all: t("materials.documents.filterAll"),
    TDS: "TDS",
    SDS: "SDS",
    specification: t("materials.documents.filterSpecification"),
  };
  const filterLabel = (f: TypeFilter) => filterLabels[f];

  if (loading) {
    return <p className="px-4 py-3 text-[12px] text-muted">{t("materials.documents.loading")}</p>;
  }
  if (error) {
    return (
      <p role="alert" className="px-4 py-3 text-[12px] text-error">
        {t("materials.documents.error", { message: error })}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span>{t("materials.documents.countsSummary", { tds: counts.tds, sds: counts.sds, spec: counts.spec, expired: counts.expired, unverified: counts.unverified })}</span>
      </div>
      <div className="mb-2 flex gap-1" role="group" aria-label={t("materials.documents.filterLabel")}>
        {/* TDS/SDS are canonical MATERIAL_DOCUMENT_TYPES enum codes, never
            translated anywhere else in the app (the table's own type column
            renders d.documentType the same raw way) — real i18n keys still
            back "all"/"specification" since those ARE real words. */}
        {TYPE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            aria-pressed={typeFilter === f}
            className={`rounded-input px-2 py-1 text-[11px] ${typeFilter === f ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text"}`}
          >
            {filterLabel(f)}
          </button>
        ))}
      </div>
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted">
          <FileText size={18} />
          <p className="text-[12px]">{t("materials.documents.empty")}</p>
        </div>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-2 py-1 font-medium">{t("materials.documents.type")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.title")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.number")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.revision")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.issuer")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.supplier")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.issueDate")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.expiryDate")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.language")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.verification")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.fileName")}</th>
              <th className="px-2 py-1 font-medium">{t("materials.documents.tags")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const expired = !!d.expiryDate && d.expiryDate < today;
              return (
                <tr key={d.code} className="border-b border-border-faint align-top">
                  <td className="px-2 py-1 font-medium text-text">{d.documentType}</td>
                  <td className="px-2 py-1 text-text">{d.documentTitle}</td>
                  <td className="px-2 py-1 text-muted">{d.documentNumber ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">{d.revision ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">{d.issuer ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">{supplierName(d.supplierCode) ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">{d.issueDate?.slice(0, 10) ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">
                    {d.expiryDate?.slice(0, 10) ?? "—"}
                    {expired && <span className="ml-1 text-error">{t("materials.documents.expired")}</span>}
                  </td>
                  <td className="px-2 py-1 text-muted">{d.language ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">
                    {d.verificationStatus === "verified" ? t("materials.documents.verified") : t("materials.documents.unverified")}
                  </td>
                  {/* Provenance metadata only — never a clickable/open action.
                      material_documents stores no binary; a fileName is a hint
                      for a human matching a locally-held file, not a real path. */}
                  <td className="px-2 py-1 text-muted">{d.fileName ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">{d.tags.length > 0 ? d.tags.join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
