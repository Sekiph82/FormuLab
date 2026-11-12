import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const EVONIK_SUPPLIER_PROFILE = {
  supplierId: "evonik",
  displayName: "Evonik",
  providerId: "evonik",
  adapterId: "evonik-document-surfaces",
  adapterVersion: "1.0.0",
} as const;

export const EVONIK_DOCUMENT_SURFACES = [
  {
    surfaceId: "evonik-crosslinkers-download-center-manual",
    displayName: "Evonik Crosslinkers Download Center (user attended)",
    entryPointUrl: "https://crosslinkers.evonik.com/en/down-loads",
    access: "public_manual_assisted",
    productLine: "Crosslinkers",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "Evonik lists Crosslinkers safety data sheets, technical literature and product information at this surface.",
      "FormuLab does not crawl the site; the user selects each document and its market/language.",
      "This surface does not establish completeness for other Evonik business lines or product groups.",
    ],
  },
  {
    surfaceId: "evonik-businessline-download-center-manual",
    displayName: "Evonik business-line Download Center (user attended)",
    entryPointUrl: "https://www.evonik.com/en/company/businesslines/ac/Downloads.html",
    access: "public_manual_assisted",
    productLine: "User-selected Evonik business line",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "Evonik download centers expose business-line-specific product literature and technical documents; coverage differs by line.",
      "Some SDS/TDS and regulatory documents require a customer portal or a request to Evonik/customer service.",
      "FormuLab does not crawl the site; it imports only user-selected files.",
      "FormuLab imports only user-selected files and reports only the explicitly selected product-line scope.",
    ],
  },
  {
    surfaceId: "evonik-intobeauty-manual",
    displayName: "Evonik intoBeauty (user attended)",
    entryPointUrl: "https://www.evonik.com/en/company/businesslines/cs/personal-care/beyond/intobeauty.html",
    access: "public_manual_assisted",
    productLine: "Care Solutions / Personal Care",
    documentTypes: ["TDS", "FORMULATION", "CERTIFICATE", "OTHER"],
    limitations: [
      "Evonik describes intoBeauty as a personal-care customer portal with product information, documentation and formulation concepts.",
      "The current adapter does not automate portal search or infer account permissions; the user selects exported/downloaded files.",
      "SDS and regulatory materials not present in a selected file remain unknown and may require a customer request.",
    ],
  },
  {
    surfaceId: "evonik-my-evonik-manual",
    displayName: "Evonik My Evonik (authenticated, user attended)",
    entryPointUrl: "https://methyl-methacrylate-monomers.evonik.com/en/visiomer-toolbox",
    access: "authenticated_manual_assisted",
    productLine: "User-selected My Evonik area",
    documentTypes: ["SDS", "TDS", "FORMULATION", "CERTIFICATE", "OTHER"],
    limitations: [
      "Evonik states that My Evonik replaced the VISIOMER Toolbox and provides account-specific content and a product recommender.",
      "A customer must authenticate through Evonik; FormuLab does not automate login, MFA, or portal requests.",
      "Only user-selected files are imported; missing access or product coverage is recorded as a gap, not as a negative product fact.",
    ],
  },
] as const;

export interface EvonikPortalSession {
  connection: ConnectorConnection;
  confirmation: { userConfirmedAuthentication: true; authenticatedAt: string };
}

function surfaceDefinition(surfaceId: string) {
  const definition = EVONIK_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown Evonik document surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = surfaceDefinition(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: EVONIK_SUPPLIER_PROFILE.providerId,
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

function requirePortalSession(session: EvonikPortalSession | undefined): void {
  if (!session) throw new Error("My Evonik import requires an authenticated, user-attended portal session.");
  const connection = connectorConnectionSchema.parse(session.connection);
  if (connection.lifecycleState !== "authenticated"
    || !connection.connectionRef
    || !/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)
    || session.confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(session.confirmation.authenticatedAt))) {
    throw new Error("My Evonik import requires confirmed user authentication and an OS credential reference.");
  }
}

/** Product-line-specific Evonik public surfaces and My Evonik use the existing
 * manual FILE path. Authenticated profile requires the existing connection's
 * authenticated lifecycle; no supplier website is crawled or logged into. */
export function createEvonikSupplierAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
  portalSession?: EvonikPortalSession,
): SupplierAdapterConformanceTarget {
  const definition = surfaceDefinition(surfaceId);
  if (definition.access === "authenticated_manual_assisted") requirePortalSession(portalSession);
  if (definition.access === "public_manual_assisted" && portalSession) {
    throw new Error("Public Evonik download imports cannot carry portal session state.");
  }
  if (profile.scope.productLines.length === 0 || profile.scope.productLines.some((line) => !line.trim())) {
    throw new Error("Evonik recheck scope must name the product lines the user actually selected.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared Evonik surface capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: EVONIK_SUPPLIER_PROFILE.supplierId,
    providerId: EVONIK_SUPPLIER_PROFILE.providerId,
    surface: createSurface(surfaceId),
  }, deps);
}
