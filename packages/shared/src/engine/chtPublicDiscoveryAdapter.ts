import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const CHT_SUPPLIER_PROFILE = {
  supplierId: "cht",
  displayName: "CHT Group",
  providerId: "cht",
  adapterId: "cht-public-discovery",
  adapterVersion: "1.0.0",
} as const;

export const CHT_PUBLIC_DOCUMENT_SURFACES = [
  {
    surfaceId: "cht-public-sds-search-manual",
    displayName: "CHT Public SDS Search (user attended)",
    entryPointUrl: "https://solutions.cht.com/cht/web.nsf/formular?formular=ENsearch-sds&openform=",
    documentTypes: ["SDS"],
    limitations: [
      "CHT's official SDS search accepts a product name; its help page documents country, language, CAS number and preparation-date filters.",
      "The search is a public discovery surface, but result availability varies with the product, country and language; a user selects each returned file.",
      "FormuLab does not submit automated searches, crawl the result pages or treat a zero-result search as proof that a product or SDS does not exist.",
    ],
  },
  {
    surfaceId: "cht-public-product-document-search-manual",
    displayName: "CHT Public Product Document Search (user attended)",
    entryPointUrl: "https://solutions.cht.com/cht/web.nsf/formular?formular=ENsearch-documents&openform=",
    documentTypes: ["SDS", "TDS", "OTHER"],
    limitations: [
      "CHT labels this search for SDS, TDS, PInS, Annex 38 and emission-factor documents; non-SDS/TDS entries are recorded as OTHER.",
      "The public search page is discoverable without assuming that every listed document can be downloaded anonymously.",
      "CHT product pages state that technical leaflets and dyestuff profiles require myCHT login and product-related SDS access requires authorization; gated downloads belong to the separate myCHT profile.",
      "FormuLab does not crawl CHT pages or claim complete product-catalog coverage. A user records the actual market/language/product scope and selects each file.",
      "This public profile does not claim certificate or formulation-document discovery.",
    ],
  },
] as const;

function surfaceDefinition(surfaceId: string) {
  const definition = CHT_PUBLIC_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown CHT public document surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = surfaceDefinition(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: CHT_SUPPLIER_PROFILE.providerId,
    displayName: definition.displayName,
    kind: "manual_assisted",
    capabilities: {
      catalogDiscovery: true,
      documentDiscovery: true,
      documentFetch: true,
      formulationDiscovery: false,
      pagination: { mode: "none" },
      authorizationMode: "manual_assisted",
      coverage: {
        status: "partial",
        markets: [],
        languages: [],
        productLines: ["User selected CHT product line"],
        documentTypes: [...definition.documentTypes],
      },
      limitations: [...definition.limitations],
    },
  });
}

/** Public CHT search pages are represented as user-attended discovery
 * surfaces. Only explicitly selected documents enter the existing immutable
 * acquisition/provenance path; authenticated myCHT content has a separate
 * provider profile. */
export function createChtPublicDiscoveryAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  const definition = surfaceDefinition(surfaceId);
  if (profile.scope.productLines.length === 0 || profile.scope.productLines.some((line) => !line.trim())) {
    throw new Error("CHT import scope must name the product lines the user actually selected.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared CHT public surface capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: CHT_SUPPLIER_PROFILE.supplierId,
    providerId: CHT_SUPPLIER_PROFILE.providerId,
    surface: createSurface(surfaceId),
  }, deps);
}
