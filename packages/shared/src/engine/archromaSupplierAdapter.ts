import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const ARCHROMA_SUPPLIER_PROFILE = {
  supplierId: "archroma",
  displayName: "Archroma",
  providerId: "archroma",
  adapterId: "archroma-product-and-safe-edge-surfaces",
  adapterVersion: "1.0.0",
} as const;

export const ARCHROMA_DOCUMENT_SURFACES = [
  {
    surfaceId: "archroma-home-care-iandi-public-manual",
    displayName: "Archroma Home Care and I&I Public Product Pages (user attended)",
    entryPointUrl: "https://www.archroma.com/textile-effects/markets/home-care-and-i-i",
    access: "public_manual_assisted",
    productLine: "Home Care and I&I",
    documentTypes: ["OTHER"],
    limitations: [
      "Archroma's public Home Care and I&I page describes product families and applications and links a brochure; it is not a comprehensive searchable SDS/TDS database.",
      "FormuLab records only product rows or files selected by the user through the existing local FILE/provenance path; it does not scrape pages or infer complete product coverage.",
      "This surface does not claim access to SDS, TDS, certificates or market-specific regulatory files. Use the relevant Archroma/customer channel for those documents.",
    ],
  },
  {
    surfaceId: "archroma-safe-edge-manual",
    displayName: "Archroma The Safe Edge (authorized, user attended)",
    entryPointUrl: "https://www.archroma.com/textile-effects/safe-edge",
    access: "authenticated_manual_assisted",
    productLine: "Textile Effects",
    documentTypes: ["SDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "Archroma describes The Safe Edge as a platform for Textile Effects products with SDS, chemical inventory and compliance status/certification information; access must be requested.",
      "Market and language determine the applicable SDS and regulatory status. The user must attest the actual products, markets and languages available in their authorized account.",
      "FormuLab does not automate login, MFA, requests, portal search or undocumented APIs. Only explicitly selected files are admitted and source status remains user-attested.",
      "Archroma's separate Color Finder terms restrict reproduction and commercial reuse; this adapter does not use Color Finder content.",
    ],
  },
] as const;

export interface ArchromaPortalAuthorization {
  connection: ConnectorConnection;
  confirmation: { userConfirmedAuthentication: true; authenticatedAt: string };
  authorizedScope: { markets: string[]; languages: string[]; productLines: string[] };
  localDocumentUseConfirmed: boolean;
  authorizationConfirmedBy: string;
  authorizationConfirmedAt: string;
}

function surfaceDefinition(surfaceId: string) {
  const definition = ARCHROMA_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown Archroma document surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = surfaceDefinition(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: ARCHROMA_SUPPLIER_PROFILE.providerId,
    displayName: definition.displayName,
    kind: "manual_assisted",
    capabilities: {
      catalogDiscovery: true,
      documentDiscovery: definition.documentTypes.length > 0,
      documentFetch: definition.documentTypes.length > 0,
      formulationDiscovery: false,
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

function requireSafeEdgeAuthorization(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: ArchromaPortalAuthorization | undefined,
): void {
  if (!authorization) throw new Error("Archroma Safe Edge requires user-authorized customer/partner access.");
  const connection = connectorConnectionSchema.parse(authorization.connection);
  if (connection.lifecycleState !== "authenticated"
    || !connection.connectionRef
    || !/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)
    || authorization.confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(authorization.confirmation.authenticatedAt))) {
    throw new Error("Archroma Safe Edge requires user-attended authentication and an OS credential reference.");
  }
  if (authorization.localDocumentUseConfirmed !== true
    || !authorization.authorizationConfirmedBy.trim()
    || !Number.isFinite(Date.parse(authorization.authorizationConfirmedAt))) {
    throw new Error("A named user must confirm Archroma access and permission for local use of selected files.");
  }
  const authorized = {
    markets: new Set(authorization.authorizedScope.markets.map((value) => value.toLocaleLowerCase("en-US"))),
    languages: new Set(authorization.authorizedScope.languages.map((value) => value.toLocaleLowerCase("en-US"))),
    productLines: new Set(authorization.authorizedScope.productLines.map((value) => value.toLocaleLowerCase("en-US"))),
  };
  for (const dimension of ["markets", "languages", "productLines"] as const) {
    const outside = profile.scope[dimension].filter((value) => !authorized[dimension].has(value.toLocaleLowerCase("en-US")));
    if (outside.length > 0) {
      throw new Error(`Archroma requested ${dimension} scope exceeds the user-confirmed Safe Edge authorization.`);
    }
  }
}

/** Archroma public product pages and Safe Edge are distinct, manual-assisted
 * profiles. Safe Edge never automates customer authentication or extracts
 * portal content; local import remains user-selected and provenance-backed. */
export function createArchromaSupplierAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
  authorization?: ArchromaPortalAuthorization,
): SupplierAdapterConformanceTarget {
  const definition = surfaceDefinition(surfaceId);
  if (profile.scope.productLines.length === 0 || profile.scope.productLines.some((line) => !line.trim())) {
    throw new Error("Archroma import scope must name the product lines the user actually selected.");
  }
  if (definition.access === "authenticated_manual_assisted") requireSafeEdgeAuthorization(profile, authorization);
  if (definition.access === "public_manual_assisted" && authorization) {
    throw new Error("Public Archroma product-page imports cannot carry Safe Edge portal session state.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared Archroma surface capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: ARCHROMA_SUPPLIER_PROFILE.supplierId,
    providerId: ARCHROMA_SUPPLIER_PROFILE.providerId,
    surface: createSurface(surfaceId),
  }, deps);
}
