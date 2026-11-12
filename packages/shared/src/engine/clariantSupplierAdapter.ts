import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const CLARIANT_SUPPLIER_PROFILE = {
  supplierId: "clariant",
  displayName: "Clariant",
  providerId: "clariant",
  adapterId: "clariant-document-surfaces",
  adapterVersion: "1.0.0",
} as const;

export const CLARIANT_DOCUMENT_SURFACES = [
  {
    surfaceId: "clariant-document-finder-manual",
    displayName: "Clariant Document Finder (user attended)",
    entryPointUrl: "https://www.clariant.com/en/Solutions/Document-Finder",
    access: "public_manual_assisted",
    businessUnit: "User selected; preserve exact requested scope",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "Clariant publicly describes the Document Finder as a search surface for safety data sheets and product documentation.",
      "FormuLab does not automate or crawl the finder; the user selects and imports each file.",
      "Clariant advises contacting it when a requested file is not available online.",
    ],
  },
  {
    surfaceId: "clariant-clarihub-care-chemicals-manual",
    displayName: "ClariHub Care Chemicals (authenticated, user attended)",
    entryPointUrl: "https://www.clariant.com/de/Business-Units/Care-Chemicals/Customer-Portal",
    access: "authenticated_manual_assisted",
    businessUnit: "Care Chemicals",
    documentTypes: ["SDS", "TDS", "FORMULATION", "CERTIFICATE", "OTHER"],
    limitations: [
      "Clariant describes ClariHub as a customer portal with ingredient data, documents and formulations.",
      "A customer must sign in or register through Clariant; FormuLab does not automate login or portal requests.",
      "Only files selected by the authenticated user are imported; portal completeness is not inferred.",
    ],
  },
  {
    surfaceId: "clariant-clarihub-oil-services-manual",
    displayName: "ClariHub Oil Services (authenticated, user attended)",
    entryPointUrl: "https://www.clariant.com/en/Corporate/News/2025/09/Clariant-Oil-Services-launches-customer-portal-for-seamless-digital-access",
    access: "authenticated_manual_assisted",
    businessUnit: "Oil Services",
    documentTypes: ["SDS", "TDS", "FORMULATION", "CERTIFICATE", "OTHER"],
    limitations: [
      "Clariant describes a customer portal for Oil Services with product information, technical and safety sheets, and formulation search.",
      "A customer must use Clariant's authorized account flow; FormuLab does not automate login or portal requests.",
      "Only files selected by the authenticated user are imported; portal completeness is not inferred.",
    ],
  },
] as const;

export interface ClariantPortalUserConfirmation {
  userConfirmedAuthentication: true;
  authenticatedAt: string;
}

export interface ClariantPortalSession {
  connection: ConnectorConnection;
  confirmation: ClariantPortalUserConfirmation;
}

function definitionFor(surfaceId: string) {
  const definition = CLARIANT_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown Clariant document surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = definitionFor(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: CLARIANT_SUPPLIER_PROFILE.providerId,
    displayName: definition.displayName,
    // ClariHub sign-in is user-attended. The imported file still enters via
    // manual assistance; this avoids pretending a private portal is a public API.
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

function requirePortalConfirmation(session: ClariantPortalSession | undefined): void {
  if (!session) throw new Error("ClariHub import requires an authenticated, user-attended portal session.");
  const connection = connectorConnectionSchema.parse(session.connection);
  if (connection.lifecycleState !== "authenticated"
    || !connection.connectionRef
    || !/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)
    || session.confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(session.confirmation.authenticatedAt))) {
    throw new Error("ClariHub import requires confirmed user authentication and an OS credential reference.");
  }
}

/** Clariant's public Document Finder and authenticated ClariHub are separate
 * profiles. Both use explicit user-selected files; ClariHub requires a
 * confirmed existing authenticated connection, and neither profile crawls a
 * website or bypasses an account boundary. */
export function createClariantSupplierAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
  portalSession?: ClariantPortalSession,
): SupplierAdapterConformanceTarget {
  const definition = definitionFor(surfaceId);
  if (definition.access === "authenticated_manual_assisted") requirePortalConfirmation(portalSession);
  if (definition.access === "public_manual_assisted" && portalSession) {
    throw new Error("Public Clariant Document Finder imports cannot carry portal session state.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared Clariant surface capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: CLARIANT_SUPPLIER_PROFILE.supplierId,
    providerId: CLARIANT_SUPPLIER_PROFILE.providerId,
    surface: createSurface(surfaceId),
  }, deps);
}
