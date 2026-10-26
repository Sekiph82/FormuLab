import {
  safeSupplierDocumentSourceUrl,
  type NewSupplierDocumentAcquisition,
} from "@formulab/shared";

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function sha256Identity(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable exact-source identity for retry deduplication; source provenance remains part of the key. */
export async function supplierDocumentAcquisitionIdempotencyKey(
  input: Pick<NewSupplierDocumentAcquisition,
    "supplierId" | "providerId" | "surfaceId" | "documentType" | "sourceUrl" | "sourceProduct" | "market" | "language" | "sha256"
  >,
): Promise<string> {
  const sourceUrl = new URL(safeSupplierDocumentSourceUrl(input.sourceUrl));
  sourceUrl.searchParams.sort();
  const sourceProduct = Object.fromEntries(
    Object.entries(input.sourceProduct)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, normalizeIdentity(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const canonicalIdentity = JSON.stringify({
    supplierId: normalizeIdentity(input.supplierId),
    providerId: normalizeIdentity(input.providerId),
    surfaceId: normalizeIdentity(input.surfaceId),
    documentType: input.documentType,
    sourceUrl: sourceUrl.toString(),
    sourceProduct,
    market: normalizeIdentity(input.market),
    language: normalizeIdentity(input.language),
    sha256: input.sha256.toLowerCase(),
  });
  return `sha256:${await sha256Identity(canonicalIdentity)}`;
}
