/* eslint-disable i18next/no-literal-string -- this workflow has a compact bilingual fallback so folder import remains usable in every shipped locale. */
import { useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, FolderOpen, LoaderCircle, Upload } from "lucide-react";
import { admitSupplierPdf, SUPPLIER_PDF_DEFAULT_MAX_BYTES } from "@/lib/supplierDocumentAdmission";
import { startReferenceFormulationBulkImport } from "@/lib/referenceFormulationBulkImport";
import { recordSupplierDocumentAcquisitionBatch } from "@/lib/supplierDocumentAcquisitions";
import { nowIso, storeSupplierDocumentPdf } from "@/lib/masterdata";
import type { TrustedActor } from "@/lib/currentActor";
import type { NewSupplierDocumentAcquisition, ReferenceFormulationRights } from "@formulab/shared";

type Kind = "FORMULATION" | "SDS" | "TDS" | "OTHER";
type FolderFile = { file: File; relativePath: string; supplierId: string; market: string; language: string; kind: Kind };

const SUPPLIERS: Record<string, string> = {
  archroma: "archroma", basf: "basf", cht: "cht", clariant: "clariant", croda: "croda",
  dow: "dow", dystar: "dystar", dyestar: "dystar", evonik: "evonik", nouryon: "nouryon", seppic: "seppic",
};
const CATEGORY_ORDER: Kind[] = ["FORMULATION", "SDS", "TDS", "OTHER"];

function normalizedPart(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "").trim();
}

function supplierFromPath(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean).slice(1);
  for (const part of parts) {
    const key = normalizedPart(part);
    if (SUPPLIERS[key]) return SUPPLIERS[key]!;
  }
  const candidate = parts[0] ?? "owner-provided";
  const slug = candidate.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48);
  return slug ? `supplier-${slug}` : "owner-provided";
}

function marketAndLanguage(path: string): { market: string; language: string } {
  const match = /(?:^|[_ .-])(US|USA|EU|UK|GB|TR|CN|DE|FR)(EN|TR|DE|FR|ZH|CN)?(?:SDS|TDS)?(?:[_ .-]|$)/iu.exec(path);
  if (!match) return { market: "unknown", language: "unknown" };
  const market = ({ US: "USA", GB: "UK" } as Record<string, string>)[match[1]!.toUpperCase()] ?? match[1]!.toUpperCase();
  const language = match[2] ? ({ CN: "zh" } as Record<string, string>)[match[2]!.toUpperCase()] ?? match[2]!.toLowerCase() : "unknown";
  return { market, language };
}

function classify(path: string): Kind {
  const value = path.normalize("NFKC").toLocaleLowerCase("en-US");
  if (/(?:^|[^a-z])(?:sds|msds|safety[ _-]*data)(?:[^a-z]|$)/iu.test(value)) return "SDS";
  if (/(?:^|[^a-z])(?:tds|technical[ _-]*data)(?:[^a-z]|$)/iu.test(value)
    || /(?:^|[\\/])data[ _-]*sheets?(?:[\\/]|$)/iu.test(value)) return "TDS";
  if (/(?:formulations?|formula[ _-]*(?:card|booklet|sheet)|recipes?)/iu.test(value)
    || /(?:^|[\\/])croda_\d{1,5}_/iu.test(value)
    || /(?:^|[_ .-])form_gen(?:[_ .-]|$)/iu.test(value)) return "FORMULATION";
  return "OTHER";
}

async function contentHash(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeBasename(name: string): string {
  let value = name.normalize("NFKC").replace(/[^A-Za-z0-9._ ()-]/gu, "_").replace(/\.{2,}/gu, "_")
    .replace(/^\.+/u, "_").replace(/[. ]+$/u, "").slice(0, 150);
  if (!value || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(value)) value = `_${value || "source.pdf"}`;
  return value;
}

function attestedInternalResearchRights(actor: TrustedActor, selectedAt: string): ReferenceFormulationRights {
  const evidenceRef = `owner-attestation:${actor.userId}:internal-reference-research:${selectedAt}`;
  const permission = { status: "allowed" as const, evidenceRefs: [evidenceRef] };
  return {
    status: "owner_provided", redistribution: "unknown", evidenceRefs: [evidenceRef],
    usePermissions: {
      internalResearch: permission,
      sameSupplierPrior: permission,
      crossSupplierPrior: permission,
      sourceExport: { status: "prohibited", evidenceRefs: [evidenceRef] },
      derivedExport: { status: "unknown", evidenceRefs: [] },
    },
    retentionPolicy: { status: "retain_until_revoked", evidenceRefs: [evidenceRef] },
  };
}

function asSelectedPdf(file: File) {
  return { name: file.name, type: file.type, size: file.size, arrayBuffer: () => file.arrayBuffer() };
}

export function LocalFolderImport({ actor, onImported }: { actor: TrustedActor | null; onImported: () => void }) {
  const { i18n } = useTranslation("session");
  const input = useRef<HTMLInputElement>(null);
  const abortController = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [pathFilter, setPathFilter] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [market, setMarket] = useState("unknown");
  const [language, setLanguage] = useState("unknown");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const tr = i18n.resolvedLanguage?.startsWith("tr") ?? false;
  const text = (en: string, turkish: string) => tr ? turkish : en;

  const counts = useMemo(() => Object.fromEntries(CATEGORY_ORDER.map((kind) => [kind, files.filter((entry) => entry.kind === kind).length])) as Record<Kind, number>, [files]);
  const totalBytes = useMemo(() => files.reduce((sum, entry) => sum + entry.file.size, 0), [files]);
  const samples = useMemo(() => CATEGORY_ORDER.map((kind) => ({ kind, names: files.filter((entry) => entry.kind === kind).slice(0, 3).map((entry) => entry.relativePath) })), [files]);
  const filteredFiles = useMemo(() => {
    const needle = pathFilter.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const candidates = files.filter((entry) => needle ? entry.relativePath.toLocaleLowerCase("en-US").includes(needle) : entry.kind === "OTHER");
    return { total: candidates.length, visible: candidates.slice(0, 40) };
  }, [files, pathFilter]);

  const chooseFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    setFiles(selected.filter((file) => file.name.toLocaleLowerCase("en-US").endsWith(".pdf")).map((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const identity = `${relativePath} ${file.name}`;
      const detected = marketAndLanguage(identity);
      return { file, relativePath, supplierId: supplierFromPath(relativePath), ...detected, kind: classify(identity) };
    }));
    setRightsConfirmed(false);
    setPathFilter("");
    setError(""); setResult(""); setProgress("");
  };

  const importFormulations = async () => {
    if (!actor || !rightsConfirmed) return;
    const formulationFiles = files.filter((entry) => entry.kind === "FORMULATION");
    if (!formulationFiles.length) return;
    setRunning(true); setError(""); setResult("");
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const groups = new Map<string, FolderFile[]>();
      for (const entry of formulationFiles) {
        const effectiveMarket = market.trim() === "unknown" ? entry.market : market.trim();
        const effectiveLanguage = language.trim() === "unknown" ? entry.language : language.trim();
        const key = `${entry.supplierId}\n${effectiveMarket}\n${effectiveLanguage}`;
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      }
      let imported = 0; let duplicates = 0; let failed = 0;
      const selectedAt = nowIso();
      for (const [key, group] of groups) {
        if (controller.signal.aborted) break;
        const [supplierId, groupMarket, groupLanguage] = key.split("\n");
        if (!supplierId || !groupMarket || !groupLanguage) continue;
        setProgress(text(`${supplierId}: processing ${group.length} formulation PDFs…`, `${supplierId}: ${group.length} formülasyon PDF'i işleniyor…`));
        const response = await startReferenceFormulationBulkImport(group.map(({ file }) => asSelectedPdf(file)), {
          supplierId, providerId: "owner-local-folder", surfaceId: "user-selected-folder",
          market: groupMarket, language: groupLanguage,
          rights: attestedInternalResearchRights(actor, selectedAt), requestedBy: actor.userId,
        }, controller.signal);
        imported += response.files.filter((entry) => entry.status === "review_required").length;
        duplicates += response.files.filter((entry) => entry.status === "duplicate").length;
        failed += response.files.filter((entry) => entry.status === "failed").length;
      }
      setResult(text(`Formulation import ${controller.signal.aborted ? "paused" : "finished"}: ${imported} added for evidence review, ${duplicates} exact duplicates, ${failed} failed. Re-select the folder to safely retry remaining files.`, `Formülasyon içe aktarımı ${controller.signal.aborted ? "duraklatıldı" : "bitti"}: ${imported} kaynak incelemesine eklendi, ${duplicates} tam kopya, ${failed} başarısız. Kalan dosyaları güvenle yeniden denemek için klasörü tekrar seçin.`));
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { abortController.current = null; setRunning(false); setProgress(""); }
  };

  const importProductDocuments = async () => {
    if (!actor) return;
    const documents = files.filter((entry) => entry.kind === "SDS" || entry.kind === "TDS");
    if (!documents.length) return;
    setRunning(true); setError(""); setResult("");
    const controller = new AbortController();
    abortController.current = controller;
    const selectedAt = nowIso();
    let imported = 0; let duplicates = 0; let failed = 0;
    try {
      for (let offset = 0; offset < documents.length; offset += 100) {
        const receiptInputs: NewSupplierDocumentAcquisition[] = [];
        const batch = documents.slice(offset, offset + 100);
        for (const [batchIndex, entry] of batch.entries()) {
          if (controller.signal.aborted) break;
          const ordinal = offset + batchIndex + 1;
          setProgress(text(`Storing product document ${ordinal} of ${documents.length}…`, `${ordinal}/${documents.length} ürün belgesi saklanıyor…`));
          try {
            if (!Number.isSafeInteger(entry.file.size) || entry.file.size < 1 || entry.file.size > SUPPLIER_PDF_DEFAULT_MAX_BYTES) throw new Error("unsupported-size");
            const bytes = new Uint8Array(await entry.file.arrayBuffer());
            const admission = await admitSupplierPdf({ bytes, filename: entry.file.name, declaredMimeType: entry.file.type || "application/octet-stream" });
            if (admission.status !== "admitted") throw new Error(admission.reason);
            const sha256 = await contentHash(bytes);
            await storeSupplierDocumentPdf(bytes, sha256);
            const filename = safeBasename(entry.file.name);
            receiptInputs.push({
              supplierId: entry.supplierId, providerId: "owner-local-folder", surfaceId: "user-selected-folder",
              documentType: entry.kind,
              acquisitionMethod: "manual_assisted",
              sourceProduct: { tradeName: filename.replace(/\.pdf$/iu, "") },
              sourceFileSelection: {
                selectionId: `folder-file:${sha256}`, originalFilename: filename, sourceFileSha256: sha256,
                selectedAt, selectedBy: actor.userId,
              },
              market: market.trim() === "unknown" ? entry.market : market.trim(), language: language.trim() === "unknown" ? entry.language : language.trim(),
              originalFilename: filename, mimeType: entry.file.type === "application/pdf" ? "application/pdf" : "application/octet-stream",
              sha256, byteSize: bytes.byteLength, parserStatus: "not_started",
            });
          } catch { failed += 1; }
        }
        const persisted = await recordSupplierDocumentAcquisitionBatch(receiptInputs);
        imported += persisted.records.length;
        duplicates += persisted.duplicateCount;
        if (controller.signal.aborted) break;
      }
      setResult(text(`Product document intake ${controller.signal.aborted ? "paused" : "finished"}: ${imported} SDS/TDS source receipts added, ${duplicates} exact duplicates, ${failed} failed. They are not linked to RawMaterial and are not yet extracted as facts. Re-select the folder to safely retry remaining files.`, `Ürün belgesi alımı ${controller.signal.aborted ? "duraklatıldı" : "bitti"}: ${imported} SDS/TDS kaynak kaydı eklendi, ${duplicates} tam kopya, ${failed} başarısız. Belgeler RawMaterial'a bağlanmadı ve henüz veri çıkarımı yapılmadı. Kalan dosyaları güvenle yeniden denemek için klasörü tekrar seçin.`));
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { abortController.current = null; setRunning(false); setProgress(""); }
  };

  const inputAttrs = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string };

  return (
    <section className="mb-5 rounded-lg border border-border bg-surface p-4" aria-label={text("Import local formulation and supplier document folder", "Yerel formülasyon ve tedarikçi belge klasörünü içe aktar")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{text("Import a local folder", "Yerel klasörü içe aktar")}</h2>
          <p className="mt-1 max-w-4xl text-xs text-muted">{text("Select a folder once. Formulation PDFs are parsed into the reference evidence corpus; SDS/TDS PDFs are copied into this workspace as immutable source documents. This importer accepts PDFs only: CSV/XLSX remain available through Data Exchange. The source folder is read-only and is not continuously synchronized.", "Bir klasör seçin. Formülasyon PDF'leri referans kanıt havuzuna çıkarılır; SDS/TDS PDF'leri bu çalışma alanına değişmez kaynak belgeler olarak kopyalanır. Bu alım yalnızca PDF kabul eder; CSV/XLSX için Data Exchange kullanılabilir. Kaynak klasör salt okunur kalır ve sürekli eşitlenmez.")}</p>
        </div>
        <button type="button" onClick={() => input.current?.click()} disabled={running} className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text hover:bg-surface-2 disabled:opacity-50"><FolderOpen size={14} />{text("Choose folder", "Klasör seç")}</button>
        <input ref={input} type="file" multiple accept="application/pdf,.pdf" className="hidden" {...inputAttrs} onChange={chooseFolder} />
      </div>

      {files.length > 0 && <>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {CATEGORY_ORDER.map((kind) => <div key={kind} className="rounded border border-border-faint bg-surface-1 px-3 py-2"><p className="text-[10px] text-muted">{kind === "FORMULATION" ? text("Formulation candidates", "Formülasyon adayları") : kind === "OTHER" ? text("Unclassified PDFs", "Sınıflandırılmamış PDF'ler") : `${kind} ${text("candidates", "adayları")}`}</p><p className="text-lg font-semibold text-text">{counts[kind].toLocaleString()}</p></div>)}
        </div>
        <p className="mt-2 text-[10px] text-muted">{text("PDFs", "PDF")}: {files.length.toLocaleString()} · {text("Selected source size", "Seçili kaynak boyutu")}: {(totalBytes / (1024 ** 3)).toFixed(2)} GB · {text("Filename/path classification only; inspect the samples before importing.", "Yalnızca dosya adı/yol sınıflandırmasıdır; içe aktarmadan önce örnekleri kontrol edin.")}</p>
        <details className="mt-2 text-[10px] text-muted"><summary className="cursor-pointer">{text("Preview detected paths", "Algılanan yolları önizle")}</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{samples.filter((group) => group.names.length).map((group) => <div key={group.kind}><p className="font-semibold text-text">{group.kind} · {counts[group.kind]}</p><ul className="list-disc break-all pl-4">{group.names.map((name) => <li key={name}>{name}</li>)}</ul></div>)}</div>
          <label className="mt-3 block">{text("Search PDF paths to correct classification", "Sınıflandırmayı düzeltmek için PDF yollarında ara")}<input value={pathFilter} onChange={(event) => setPathFilter(event.target.value)} disabled={running} placeholder={text("e.g. Croda_787 or Formulations", "ör. Croda_787 veya Formulations")} className="mt-1 w-full rounded border border-border bg-surface-1 px-2 py-1.5 text-xs text-text" /></label>
          <p className="mt-1">{text("Showing {{visible}} of {{total}} matches. With an empty search, unclassified PDFs are shown first.", "{{total}} eşleşmenin {{visible}} tanesi gösteriliyor. Arama boşsa önce sınıflandırılmamış PDF'ler gösterilir.").replace("{{visible}}", String(filteredFiles.visible.length)).replace("{{total}}", String(filteredFiles.total))}</p>
          <ul className="mt-2 max-h-72 space-y-1 overflow-auto">{filteredFiles.visible.map((entry) => <li key={`${entry.relativePath}:${entry.file.size}`} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2"><span className="break-all">{entry.relativePath}</span><select aria-label={text("Classification for {{file}}", "{{file}} için sınıflandırma").replace("{{file}}", entry.file.name)} value={entry.kind} disabled={running} onChange={(event) => setFiles((current) => current.map((candidate) => candidate.file === entry.file ? { ...candidate, kind: event.target.value as Kind } : candidate))} className="rounded border border-border bg-surface-1 px-2 py-1 text-text"><option value="FORMULATION">FORMULATION</option><option value="SDS">SDS</option><option value="TDS">TDS</option><option value="OTHER">OTHER</option></select></li>)}</ul>
        </details>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-[10px] text-muted">{text("Default market (use unknown if files differ)", "Varsayılan pazar (dosyalar farklıysa unknown kullanın)")}<input value={market} onChange={(event) => setMarket(event.target.value)} disabled={running} className="mt-1 w-full rounded border border-border bg-surface-1 px-2 py-1.5 text-xs text-text" /></label>
          <label className="text-[10px] text-muted">{text("Default language (use unknown if files differ)", "Varsayılan dil (dosyalar farklıysa unknown kullanın)")}<input value={language} onChange={(event) => setLanguage(event.target.value)} disabled={running} className="mt-1 w-full rounded border border-border bg-surface-1 px-2 py-1.5 text-xs text-text" /></label>
        </div>
        <label className="mt-3 flex items-start gap-2 rounded border border-warning/30 bg-warning/5 p-2 text-[10px] text-text">
          <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} disabled={running || !actor} className="mt-0.5" />
          <span>{text("I confirm I am authorized to use the selected supplier formulation files for internal and cross-supplier reference research in this workspace. This does not authorize redistribution or export.", "Seçili tedarikçi formülasyonlarını bu çalışma alanında kurum içi ve tedarikçiler arası referans araştırması için kullanmaya yetkili olduğumu onaylıyorum. Bu onay yeniden dağıtım veya dışa aktarma izni vermez.")}</span>
        </label>
        {!actor && <p role="alert" className="mt-2 text-[10px] text-warning">{text("Sign in with a named user before importing so provenance and human attestation are attributable.", "Kaynak izi ve insan onayı ilişkilendirilebilsin diye içe aktarmadan önce kullanıcı girişi yapın.")}</p>}
        <p className="mt-2 text-[10px] text-muted">{text("Product names are retained as filename candidates, not verified identities. SDS/TDS intake stores the PDFs and receipts only; use the existing SDS review and product resolver screens afterward. No RawMaterial or production formulation is changed.", "Ürün adları doğrulanmış kimlik değil, dosya adı adayı olarak tutulur. SDS/TDS alımı PDF ve kaynak kaydını saklar; ardından mevcut SDS inceleme ve ürün çözümleme ekranlarını kullanın. RawMaterial veya üretim formülasyonu değiştirilmez.")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void importFormulations()} disabled={running || !actor || !rightsConfirmed || counts.FORMULATION === 0} className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Upload size={13} />{text("Import formulation PDFs", "Formülasyon PDF'lerini içe aktar")} · {counts.FORMULATION.toLocaleString()}</button>
          <button type="button" onClick={() => void importProductDocuments()} disabled={running || !actor || counts.SDS + counts.TDS === 0} className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text disabled:opacity-50"><Upload size={13} />{text("Store SDS/TDS PDFs", "SDS/TDS PDF'lerini sakla")} · {(counts.SDS + counts.TDS).toLocaleString()}</button>
          {running && <button type="button" onClick={() => abortController.current?.abort()} className="rounded border border-error/40 px-3 py-2 text-xs text-error">{text("Pause import", "İçe aktarımı duraklat")}</button>}
        </div>
      </>}
      {running && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted"><LoaderCircle size={13} className="animate-spin" />{progress}</p>}
      {error && <p role="alert" className="mt-3 flex items-start gap-2 text-xs text-error"><AlertCircle size={14} />{error}</p>}
      {result && <p role="status" className="mt-3 text-xs text-success">{result}</p>}
    </section>
  );
}
