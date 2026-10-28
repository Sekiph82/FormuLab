import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const NOURYON_SUPPLIER_PROFILE = {
  supplierId: "nouryon",
  displayName: "Nouryon",
  providerId: "nouryon",
  adapterId: "nouryon-public-sds-search",
  adapterVersion: "1.0.0",
} as const;

/** Nouryon lists these product lines as covered by its public SDS search. */
export const NOURYON_PUBLIC_SDS_PRODUCT_LINES = [
  "Organic peroxides",
  "Metal alkyls",
  "Polymer additives",
  "PVC reactor additives",
  "Bermocoll",
] as const;

export const NOURYON_PUBLIC_SDS_SURFACE = {
  surfaceId: "nouryon-public-sds-search-manual",
  displayName: "Nouryon Public SDS Search (user attended)",
  entryPointUrl: "https://www.nouryon.com/sds-search",
} as const;

const supportedLines = new Set(NOURYON_PUBLIC_SDS_PRODUCT_LINES.map((line) => line.toLocaleLowerCase("en-US")));

function createSurface(): SupplierSurfaceProfile {
  return supplierSurfaceProfileSchema.parse({
    surfaceId: NOURYON_PUBLIC_SDS_SURFACE.surfaceId,
    providerId: NOURYON_SUPPLIER_PROFILE.providerId,
    displayName: NOURYON_PUBLIC_SDS_SURFACE.displayName,
    kind: "manual_assisted",
    capabilities: {
      catalogDiscovery: false,
      documentDiscovery: true,
      documentFetch: true,
      formulationDiscovery: false,
      pagination: { mode: "none" },
      authorizationMode: "manual_assisted",
      coverage: {
        status: "partial",
        markets: [],
        languages: [],
        productLines: [...NOURYON_PUBLIC_SDS_PRODUCT_LINES],
        documentTypes: ["SDS"],
      },
      limitations: [
        "Nouryon says this public SDS search covers organic peroxides, metal alkyls, polymer additives, PVC reactor additives and Bermocoll.",
        "For other product lines, Nouryon directs customers to product search/contact or My Nouryon; this adapter does not claim the public search covers them.",
        "FormuLab does not automate the public search or crawl results; a user records the result status and selects any available SDS file.",
      ],
    },
  });
}

/** User-attended bridge for Nouryon's limited public SDS search. Surface
 * outcomes explicitly distinguish a completed zero-result check, inaccessible
 * account-gated scope, unsupported product family and unscanned scope. */
export function createNouryonPublicSdsAdapter(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  if (profile.documents.some(({ documentType }) => documentType !== "SDS")) {
    throw new Error("Nouryon public SDS search imports SDS documents only.");
  }
  const checkedLines = new Set((profile.surfaceChecks ?? []).map(({ productLine }) => productLine.toLocaleLowerCase("en-US")));
  for (const line of profile.scope.productLines) {
    if (!supportedLines.has(line.toLocaleLowerCase("en-US")) && !checkedLines.has(line.toLocaleLowerCase("en-US"))) {
      throw new Error("Unsupported Nouryon product families require an explicit unsupported-scope check.");
    }
  }
  for (const check of profile.surfaceChecks ?? []) {
    const isSupported = supportedLines.has(check.productLine.toLocaleLowerCase("en-US"));
    if (isSupported && check.outcome === "unsupported_scope") {
      throw new Error("A supported Nouryon public SDS product family cannot be marked unsupported.");
    }
    if (!isSupported && check.outcome !== "unsupported_scope") {
      throw new Error("Nouryon public SDS search cannot report a result for an unsupported product family.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: NOURYON_SUPPLIER_PROFILE.supplierId,
    providerId: NOURYON_SUPPLIER_PROFILE.providerId,
    surface: createSurface(),
  }, deps);
}
