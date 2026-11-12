import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  supplierAcquisitionJobItemSchema,
  supplierAcquisitionJobSchema,
  type SupplierAcquisitionJob,
  type SupplierAcquisitionJobItem,
} from "@formulab/shared";
import { listRecords } from "@/lib/masterdata";
import { resumeSupplierAcquisitionJobItem } from "@/lib/supplierAcquisitionJobs";
import { Badge, Card } from "./ui";

export function SupplierAcquisitionJobsScreen() {
  const { t } = useTranslation("session");
  const [jobs, setJobs] = useState<SupplierAcquisitionJob[]>([]);
  const [items, setItems] = useState<SupplierAcquisitionJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [jobRows, itemRows] = await Promise.all([
        listRecords("supplier_acquisition_jobs"),
        listRecords("supplier_acquisition_job_items"),
      ]);
      const parsedJobs = jobRows.map((row) => supplierAcquisitionJobSchema.parse(row));
      const parsedItems = itemRows.map((row) => supplierAcquisitionJobItemSchema.parse(row));
      setJobs(parsedJobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setItems(parsedItems);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const retryItem = async (item: SupplierAcquisitionJobItem) => {
    setRetrying(item.id);
    setFeedback(null);
    try {
      await resumeSupplierAcquisitionJobItem(item.id);
      setFeedback(t("dataExchange.connectors.acquisitionJobs.retryQueued", { item: item.sourceProductTradeName ?? item.supplierItemCode ?? item.id }));
      await refresh();
    } catch {
      setFeedback(t("dataExchange.connectors.acquisitionJobs.retryFailed"));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Card title={t("dataExchange.connectors.acquisitionJobs.title")} actions={
      <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-input border border-border px-2 py-1 text-[10px] text-muted disabled:opacity-50">
        {t("dataExchange.connectors.acquisitionJobs.refresh")}
      </button>
    }>
      <p className="mb-3 text-[11px] text-muted">{t("dataExchange.connectors.acquisitionJobs.intro")}</p>
      {loading && <p className="text-[11px] text-muted">{t("dataExchange.connectors.acquisitionJobs.loading")}</p>}
      {loadFailed && <p role="alert" className="text-[11px] text-error">{t("dataExchange.connectors.acquisitionJobs.loadError")}</p>}
      {feedback && <p role="status" className="mb-2 text-[11px] text-muted">{feedback}</p>}
      {!loading && !loadFailed && jobs.length === 0 && <p className="text-[11px] text-muted">{t("dataExchange.connectors.acquisitionJobs.empty")}</p>}
      <div className="space-y-2">
        {jobs.map((job) => (
          <AcquisitionJobCard
            key={job.id}
            job={job}
            items={items.filter((item) => item.jobId === job.id)}
            retryingItemId={retrying}
            onRetry={(item) => void retryItem(item)}
          />
        ))}
      </div>
    </Card>
  );
}

function itemWorkStarted(item: SupplierAcquisitionJobItem): boolean {
  return item.status !== "queued" && item.status !== "cancelled" && item.status !== "resumed";
}

function AcquisitionJobCard({
  job,
  items,
  retryingItemId,
  onRetry,
}: {
  job: SupplierAcquisitionJob;
  items: SupplierAcquisitionJobItem[];
  retryingItemId: string | null;
  onRetry: (item: SupplierAcquisitionJobItem) => void;
}) {
  const { t } = useTranslation("session");
  const jobItems = items.filter((item) => item.jobId === job.id);
  const products = jobItems.filter((item) => item.kind === "catalog_product");
  const documents = jobItems.filter((item) => item.kind === "supplier_document");
  const scannedProducts = products.filter(itemWorkStarted).length;
  const acquired = documents.filter((item) => item.status === "acquired").length;
  const skipped = documents.filter((item) => item.status === "skipped").length;
  const failed = documents.filter((item) => item.status === "failed_item").length;
  const checkpoint = !job.checkpoint
    ? t("dataExchange.connectors.acquisitionJobs.noCheckpoint")
    : job.checkpoint.strategy === "page_number"
      ? t("dataExchange.connectors.acquisitionJobs.lastPage", { page: job.checkpoint.pageNumber })
      : job.checkpoint.strategy === "offset"
        ? t("dataExchange.connectors.acquisitionJobs.offsetCheckpoint", { offset: job.checkpoint.offset, sequence: job.checkpoint.sequence })
        : job.checkpoint.strategy === "secure_continuation_ref"
          ? t("dataExchange.connectors.acquisitionJobs.secureCheckpoint", { sequence: job.checkpoint.sequence })
          : t("dataExchange.connectors.acquisitionJobs.manualCheckpoint", { sequence: job.checkpoint.sequence });
  const startedItems = jobItems.filter(itemWorkStarted).length;
  const progress = jobItems.length > 0 ? Math.round((startedItems / jobItems.length) * 100) : null;

  return (
    <article className="rounded-input border border-border-faint bg-surface-1 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text">{job.supplierId} · {job.providerId} · {job.surfaceId}</p>
          <p className="mt-0.5 text-[10px] text-muted">{t("dataExchange.connectors.acquisitionJobs.jobId", { id: job.id })} · {t("dataExchange.connectors.acquisitionJobs.updated", { date: new Date(job.updatedAt).toLocaleString() })}</p>
        </div>
        <Badge>{t(`dataExchange.connectors.acquisitionJobs.status.${job.status}`)}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2 xl:grid-cols-3">
        <Metric label={t("dataExchange.connectors.acquisitionJobs.productsScanned")} value={`${scannedProducts} / ${products.length}`} />
        <Metric label={t("dataExchange.connectors.acquisitionJobs.documentsFound")} value={String(documents.length)} />
        <Metric label={t("dataExchange.connectors.acquisitionJobs.documentsAcquired")} value={String(acquired)} />
        <Metric label={t("dataExchange.connectors.acquisitionJobs.documentsSkipped")} value={String(skipped)} />
        <Metric label={t("dataExchange.connectors.acquisitionJobs.documentsFailed")} value={String(failed)} />
        <Metric label={t("dataExchange.connectors.acquisitionJobs.pagesCheckpoint")} value={checkpoint} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
        <span>{t("dataExchange.connectors.acquisitionJobs.progress", { complete: startedItems, total: jobItems.length })}</span>
        {progress !== null && <progress aria-label={t("dataExchange.connectors.acquisitionJobs.progressBar")} max={100} value={progress} className="h-1.5 w-28 accent-accent" />}
        <span>{job.checkpoint ? t("dataExchange.connectors.acquisitionJobs.checkpointUpdated", { date: new Date(job.checkpoint.checkpointedAt).toLocaleString() }) : t("dataExchange.connectors.acquisitionJobs.checkpointPending")}</span>
      </div>
      {jobItems.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-medium text-muted">{t("dataExchange.connectors.acquisitionJobs.items", { count: jobItems.length })}</summary>
          <ul className="mt-2 space-y-1.5">
            {jobItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-faint px-2 py-1.5 text-[10px]">
                <span className="min-w-0 text-text">{item.kind === "catalog_product" ? t("dataExchange.connectors.acquisitionJobs.product") : item.documentType} · {item.sourceProductTradeName ?? item.supplierItemCode ?? item.sourceProductId} · {t(`dataExchange.connectors.acquisitionJobs.status.${item.status}`)} · {t("dataExchange.connectors.acquisitionJobs.attempts", { count: item.attemptCount })}{item.failureCode ? ` · ${t(`dataExchange.connectors.acquisitionJobs.failure.${item.failureCode}`)}` : ""}</span>
                {item.status === "failed_item" && (
                  <button type="button" onClick={() => onRetry(item)} disabled={retryingItemId === item.id} className="rounded-input border border-border px-2 py-1 text-muted hover:text-text disabled:opacity-50">
                    {retryingItemId === item.id ? t("dataExchange.connectors.acquisitionJobs.retrying") : t("dataExchange.connectors.acquisitionJobs.retry")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-border-faint px-2 py-1"><span className="block text-muted">{label}</span><span className="font-medium text-text">{value}</span></div>;
}
