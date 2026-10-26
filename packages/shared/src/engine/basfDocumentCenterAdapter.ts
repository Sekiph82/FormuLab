import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const BASF_SUPPLIER_PROFILE = {
  supplierId: "basf",
  displayName: "BASF",
  providerId: "basf",
  adapterId: "basf-public-document-centers",
  adapterVersion: "1.0.0",
} as const;

export const BASF_PUBLIC_DOCUMENT_SURFACES = [
  {
    surfaceId: "basf-performance-polymers-na-download-center-manual",
    displayName: "BASF Performance Polymers North America Download Center (user attended)",
    entryPointUrl: "https://plastics-rubber.basf.com/northamerica/en/performance_polymers/downloads",
    region: "North America",
    productLine: "Performance Polymers",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "BASF's regional Download Center supports product/keyword search and filters for document type and language; BASF states results vary with selected filters.",
      "BASF notes some information is restricted. A user must use only files they are authorized to access and select the actual market, language and product/grade.",
      "This profile imports user-selected documents only; it does not crawl BASF or claim complete portfolio coverage.",
    ],
  },
  {
    surfaceId: "basf-performance-polymers-emea-download-center-manual",
    displayName: "BASF Performance Polymers EMEA Download Center (user attended)",
    entryPointUrl: "https://plastics-rubber.basf.com/emea/en/performance_polymers/downloads",
    region: "EMEA",
    productLine: "Performance Polymers",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "BASF's regional Download Center supports product/keyword search and filters for document type and language; BASF states results vary with selected filters.",
      "BASF notes some information is restricted. A user must use only files they are authorized to access and select the actual market, language and product/grade.",
      "This profile imports user-selected documents only; it does not crawl BASF or claim complete portfolio coverage.",
    ],
  },
  {
    surfaceId: "basf-na-isocyanates-polyols-product-documents-manual",
    displayName: "BASF North America Isocyanates and Polyols Product Documents (user attended)",
    entryPointUrl: "https://chemicals.basf.com/north-america/en/Monomers/isocyanates-and-polyols/products",
    region: "North America",
    productLine: "Isocyanates and Polyols",
    documentTypes: ["SDS", "TDS", "OTHER"],
    limitations: [
      "BASF says technical and safety data sheets are linked from these product pages for Lupranate isocyanates and Pluracol polyols.",
      "BASF notes an absent product may be discontinued, confidential or listed only in another region; use BASF contact for unresolved products.",
      "This profile does not claim coverage for other BASF chemical businesses or regions and imports only user-selected files.",
    ],
  },
] as const;

function surfaceDefinition(surfaceId: string) {
  const definition = BASF_PUBLIC_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown BASF public document surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = surfaceDefinition(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: BASF_SUPPLIER_PROFILE.providerId,
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
        markets: [definition.region],
        languages: [],
        productLines: [definition.productLine],
        documentTypes: [...definition.documentTypes],
      },
      limitations: [...definition.limitations],
    },
  });
}

/** BASF public product/document centers are deliberately user attended:
 * regional filters and access restrictions remain visible, and only files
 * explicitly selected by the user enter the existing provenance pipeline. */
export function createBasfDocumentCenterAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  const definition = surfaceDefinition(surfaceId);
  if (profile.scope.productLines.length === 0 || profile.scope.productLines.some((line) => !line.trim())) {
    throw new Error("BASF import scope must name the product lines the user actually selected.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared BASF document-center capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: BASF_SUPPLIER_PROFILE.supplierId,
    providerId: BASF_SUPPLIER_PROFILE.providerId,
    surface: createSurface(surfaceId),
  }, deps);
}
