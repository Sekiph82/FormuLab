import type {
  SupplierDocumentAcquisition,
  SupplierProductCardVersion,
  SupplierProductDocumentEvidence,
  SupplierProductEvidenceRecord,
} from "@formulab/shared";

type ProductIdentity = {
  supplierId: string;
  tradeName?: string;
  grade?: string;
  supplierItemCode?: string;
  market: string;
};

/** Exact, deterministic identity only; fuzzy matches remain separate for human resolution. */
export async function deriveSupplierProductCardId(acquisition: SupplierDocumentAcquisition): Promise<string> {
  const product = acquisition.sourceProduct;
  const tradeName = normalizeIdentity(product.tradeName ?? "");
  const grade = normalizeIdentity(product.grade ?? "");
  const itemCode = normalizeIdentity(product.supplierItemCode ?? product.sourceProductId ?? "");
  if (!acquisition.supplierId || (!tradeName && !itemCode)) {
    throw new Error("This document lacks a supplier and product identifier. Review its identity before creating a product card.");
  }
  const key = [
    acquisition.supplierId.trim().toLocaleLowerCase("en-US"),
    tradeName ? `name:${tradeName}` : `code:${itemCode}`,
    `grade:${grade}`,
    `market:${normalizeIdentity(acquisition.market)}`,
  ].join("|");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const hex = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  return `supplier-product-${hex}`;
}

export function createSupplierProductCardVersion(input: {
  acquisition: SupplierDocumentAcquisition;
  evidence: SupplierProductDocumentEvidence;
  existingRecords: SupplierProductEvidenceRecord[];
}): SupplierProductCardVersion {
  const { acquisition, evidence } = input;
  const existingDocuments = input.existingRecords.filter((row): row is SupplierProductDocumentEvidence => row.recordType === "document" && row.productCardId === evidence.productCardId);
  const previousVersions = input.existingRecords.filter((row): row is SupplierProductCardVersion => row.recordType === "card_version" && row.productCardId === evidence.productCardId);
  const documents = [...existingDocuments, evidence];
  const claims = documents.flatMap((document) => document.claims);
  const product = acquisition.sourceProduct;
  const identity = {
    ...(acquisition.supplierId ? { supplierId: acquisition.supplierId } : {}),
    ...(product.tradeName ? { tradeName: product.tradeName } : {}),
    ...(product.grade ? { grade: product.grade } : {}),
    ...(product.supplierItemCode ?? product.sourceProductId ? { supplierItemCode: product.supplierItemCode ?? product.sourceProductId } : {}),
  } satisfies Partial<ProductIdentity>;
  const latestVersion = Math.max(0, ...previousVersions.map((version) => version.version));
  return {
    recordType: "card_version",
    schemaVersion: "1.0",
    id: `product-card-version-${crypto.randomUUID()}`,
    productCardId: evidence.productCardId,
    version: latestVersion + 1,
    ...identity,
    market: acquisition.market || "unknown",
    language: acquisition.language || "unknown",
    identityStatus: "provisional",
    evidenceRecordIds: documents.map((document) => document.id),
    claimIds: claims.map((claim) => claim.id),
    conflicts: findConflicts(claims),
    createdAt: new Date().toISOString(),
  };
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function findConflicts(claims: SupplierProductDocumentEvidence["claims"]): SupplierProductCardVersion["conflicts"] {
  const groups = new Map<string, typeof claims>();
  for (const claim of claims) {
    const contextKey = JSON.stringify({ qualifier: claim.qualifier, basis: claim.basis, context: claim.context });
    const key = `${claim.fieldCode}|${contextKey}`;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  return [...groups.values()].flatMap((items) => {
    const values = new Set(items.map((item) => normalizeIdentity(item.normalizedValue ?? item.rawValue)));
    return values.size > 1 ? [{ fieldCode: items[0]!.fieldCode, claimIds: items.map((item) => item.id), status: "review_required" as const }] : [];
  });
}
