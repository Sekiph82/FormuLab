import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const CRODA_SUPPLIER_PROFILE = {
  supplierId: "croda",
  displayName: "Croda",
  providerId: "croda",
  adapterId: "croda-public-document-surfaces",
  adapterVersion: "1.0.0",
} as const;

export const CRODA_DOCUMENT_SURFACES = [
  {
    surfaceId: "croda-home-care-product-search-manual",
    displayName: "Croda Home Care Product Search and SDS Search (user attended)",
    entryPointUrl: "https://www.croda.com/en-gb/search-results?category=products",
    businessUnit: "Consumer Care",
    productLine: "Home Care",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "Croda's official product search identifies Home Care products and exposes an SDS Search entry point.",
      "FormuLab does not crawl Croda pages or submit automated searches; users locate and select the product documents.",
      "Product availability and documents can vary by market, language and user access; imported selections are not complete-catalog evidence.",
    ],
  },
  {
    surfaceId: "croda-public-product-search-manual",
    displayName: "Croda Public Product Search (user attended)",
    entryPointUrl: "https://www.croda.com/en-gb/search-results?category=products",
    businessUnit: "User selected Croda business unit",
    productLine: "User selected Croda product line",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "Croda publishes product search pages across multiple markets and business areas.",
      "FormuLab does not crawl Croda pages or claim a public machine API; the user chooses the exact product and file.",
      "Unsupported, unavailable or region-specific content remains an explicit coverage gap.",
    ],
  },
  {
    surfaceId: "croda-public-formulations-manual",
    displayName: "Croda Public Formulation Search (user attended)",
    entryPointUrl: "https://www.croda.com/en-gb/search-results?category=formulations",
    businessUnit: "User selected Croda business unit",
    productLine: "User selected Croda product line",
    documentTypes: ["FORMULATION", "OTHER"],
    limitations: [
      "Croda publicly indexes formulation concepts, including Home Care formulations; a displayed formulation is source evidence, not measured validation.",
      "FormuLab does not crawl Croda formulation pages; the user selects and imports each formulation file or export.",
      "FormuLab imports only user-selected formulation files or exports and does not represent them as verified manufacturing recipes.",
      "A selected file's market, language, product line and source link must be supplied with the import.",
    ],
  },
] as const;

function surfaceDefinition(surfaceId: string) {
  const definition = CRODA_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown Croda document surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = surfaceDefinition(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: CRODA_SUPPLIER_PROFILE.providerId,
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
        productLines: [definition.productLine],
        documentTypes: [...definition.documentTypes],
      },
      limitations: [...definition.limitations],
    },
  });
}

/** Croda product/SDS and formulation surfaces use manual-assisted file
 * selection over the existing FILE/provenance path. No site crawling or
 * undocumented search/download API is assumed. */
export function createCrodaSupplierAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  const definition = surfaceDefinition(surfaceId);
  if (profile.scope.productLines.length === 0 || profile.scope.productLines.some((line) => !line.trim())) {
    throw new Error("Croda import scope must name the product lines the user actually selected.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared Croda surface capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: CRODA_SUPPLIER_PROFILE.supplierId,
    providerId: CRODA_SUPPLIER_PROFILE.providerId,
    surface: createSurface(surfaceId),
  }, deps);
}
