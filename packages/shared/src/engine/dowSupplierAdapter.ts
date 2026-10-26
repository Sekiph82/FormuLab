import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const DOW_SUPPLIER_PROFILE = {
  supplierId: "dow",
  displayName: "Dow",
  providerId: "dow",
  adapterId: "dow-manual-document-centers",
  adapterVersion: "1.0.0",
} as const;

export const DOW_DOCUMENT_SURFACES = [
  {
    surfaceId: "dow-sds-finder-manual",
    displayName: "Dow SDS Finder (user attended)",
    entryPointUrl: "https://www.dow.com/en-us/support/sds-finder.html",
    documentTypes: ["SDS"],
    limitations: [
      "The official Dow SDS Finder supports product name, grade, or trade product code search.",
      "FormuLab does not automate the Dow website; the user selects and imports each file.",
      "Dow notes the website may lag its corporate distribution system by several days.",
    ],
  },
  {
    surfaceId: "dow-technical-library-manual",
    displayName: "Dow Technical Library (user attended)",
    entryPointUrl: "https://www.dow.com/en-us/technical-content.html",
    documentTypes: ["SDS", "TDS", "FORMULATION", "CERTIFICATE", "OTHER"],
    limitations: [
      "The official library lists multiple technical-content types and scopes by market and product technology.",
      "FormuLab does not assume a public machine API or crawl the library; the user selects and imports each file.",
      "Product and document coverage must be reported only for the user-selected market, language, and product line.",
    ],
  },
] as const;

function surfaceFor(surfaceId: string): SupplierSurfaceProfile {
  const definition = DOW_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown Dow document surface.");
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: DOW_SUPPLIER_PROFILE.providerId,
    displayName: definition.displayName,
    kind: "manual_assisted",
    capabilities: {
      catalogDiscovery: true,
      documentDiscovery: true,
      documentFetch: true,
      formulationDiscovery: definition.documentTypes.some((type) => type === "FORMULATION"),
      pagination: { mode: "none" },
      authorizationMode: "manual_assisted",
      coverage: {
        status: "partial",
        markets: [],
        languages: [],
        productLines: [],
        documentTypes: [...definition.documentTypes],
      },
      limitations: [...definition.limitations],
    },
  });
}

/** Dow public-facing search/library pages are official discovery entry points,
 * not a declared machine API. This adapter therefore uses the existing
 * user-selected FILE/Data Exchange path and preserves the source metadata. */
export function createDowSupplierAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  const definition = DOW_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown Dow document surface.");
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared Dow surface capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: DOW_SUPPLIER_PROFILE.supplierId,
    providerId: DOW_SUPPLIER_PROFILE.providerId,
    surface: surfaceFor(surfaceId),
  }, deps);
}
