import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const DYSTAR_SUPPLIER_PROFILE = {
  supplierId: "dystar",
  displayName: "DyStar",
  providerId: "dystar",
  adapterId: "dystar-public-eliot-and-supplier-delivery",
  adapterVersion: "1.0.0",
} as const;

export const DYSTAR_DOCUMENT_SURFACES = [
  {
    surfaceId: "dystar-public-product-pages-manual",
    displayName: "DyStar Public Product Pages (user attended)",
    entryPointUrl: "https://www.dystar.com/products/",
    access: "public_manual_assisted",
    productLine: "User-selected DyStar product family",
    documentTypes: ["OTHER"],
    limitations: [
      "DyStar's public product pages identify product families and industrial sectors; the pages reviewed do not expose a global machine-readable product/document API.",
      "Only user-selected public brochures or local product-list files are accepted. FormuLab does not scrape pages, invent catalog exports or claim complete product coverage.",
      "Public product pages do not establish a public SDS/TDS search surface; use registered eliot for supported textile technical sheets or a DyStar-issued document route.",
    ],
  },
  {
    surfaceId: "dystar-eliot-registered-manual",
    displayName: "DyStar eliot (registered account, user attended)",
    entryPointUrl: "https://eliot.dystar.com/eliot/main/main.jsp",
    access: "registered_portal_manual_assisted",
    productLine: "DyStar textile dyes and auxiliaries",
    documentTypes: ["TDS", "OTHER"],
    limitations: [
      "DyStar describes eliot as a registered-user product finder for dyes and auxiliaries with product data sheets, technical information and positive lists.",
      "The user must hold an accepted, active account and may use eliot only within the account terms; credentials must remain secret and may not be shared.",
      "DyStar eliot terms state confidential information obtained through eliot must not be disclosed to third parties or used commercially unless otherwise agreed in writing. A named user must confirm written permission for commercial/local use of the selected file before intake.",
      "FormuLab does not automate login, MFA, searches, downloads or session extraction. Only files explicitly selected by the authenticated user are accepted.",
      "This profile does not claim SDS, non-textile product families or complete DyStar portfolio access.",
    ],
  },
  {
    surfaceId: "dystar-supplier-delivered-documents-manual",
    displayName: "DyStar Supplier-Delivered Product Documents (user selected)",
    entryPointUrl: "https://www.dystar.com/dystar-office-locations/",
    access: "supplier_delivered_manual",
    productLine: "User-selected DyStar product family",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "DyStar directs inquiries through its office/sales contacts; the user first requests the needed product, market and language document from DyStar or its authorized distributor.",
      "Only a file the user is authorized to retain and use is accepted. Product, country, language, document revision and delivery provenance must be recorded explicitly.",
      "FormuLab does not submit supplier requests, crawl websites or claim that an SDS/TDS is publicly downloadable for every product or market.",
    ],
  },
] as const;

export interface DystarEliotAuthorization {
  connection: ConnectorConnection;
  confirmation: { userConfirmedAuthentication: true; authenticatedAt: string };
  authorizedScope: { markets: string[]; languages: string[]; productLines: string[] };
  /** Required because eliot terms restrict commercial use/disclosure of confidential portal content. */
  writtenCommercialLocalUsePermission: boolean;
  authorizationConfirmedBy: string;
  authorizationConfirmedAt: string;
}

function surfaceDefinition(surfaceId: string) {
  const definition = DYSTAR_DOCUMENT_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown DyStar document surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = surfaceDefinition(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: DYSTAR_SUPPLIER_PROFILE.providerId,
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
        productLines: [definition.productLine],
        documentTypes: [...definition.documentTypes],
      },
      limitations: [...definition.limitations],
    },
  });
}

function requireEliotAuthorization(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: DystarEliotAuthorization | undefined,
): void {
  if (!authorization) throw new Error("DyStar eliot requires a registered, accepted user account.");
  const connection = connectorConnectionSchema.parse(authorization.connection);
  if (connection.lifecycleState !== "authenticated"
    || !connection.connectionRef
    || !/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)
    || authorization.confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(authorization.confirmation.authenticatedAt))) {
    throw new Error("DyStar eliot requires user-attended authentication and an OS credential reference.");
  }
  if (authorization.writtenCommercialLocalUsePermission !== true
    || !authorization.authorizationConfirmedBy.trim()
    || !Number.isFinite(Date.parse(authorization.authorizationConfirmedAt))) {
    throw new Error("A named user must confirm written DyStar permission for local commercial use of selected eliot files.");
  }
  const authorized = {
    markets: new Set(authorization.authorizedScope.markets.map((value) => value.toLocaleLowerCase("en-US"))),
    languages: new Set(authorization.authorizedScope.languages.map((value) => value.toLocaleLowerCase("en-US"))),
    productLines: new Set(authorization.authorizedScope.productLines.map((value) => value.toLocaleLowerCase("en-US"))),
  };
  for (const dimension of ["markets", "languages", "productLines"] as const) {
    const outside = profile.scope[dimension].filter((value) => !authorized[dimension].has(value.toLocaleLowerCase("en-US")));
    if (outside.length > 0) {
      throw new Error(`DyStar eliot requested ${dimension} scope exceeds the user's confirmed account authorization.`);
    }
  }
}

/** Separate user-attended profiles for public DyStar pages, registered eliot,
 * and documents delivered by DyStar. No web scraping or portal automation is
 * used, and every selected file uses immutable supplier provenance. */
export function createDystarSupplierAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  deps: SupplierManualAdapterDeps,
  authorization?: DystarEliotAuthorization,
): SupplierAdapterConformanceTarget {
  const definition = surfaceDefinition(surfaceId);
  if (profile.scope.productLines.length === 0 || profile.scope.productLines.some((line) => !line.trim())) {
    throw new Error("DyStar import scope must name the product lines the user actually selected.");
  }
  if (definition.access === "registered_portal_manual_assisted") requireEliotAuthorization(profile, authorization);
  if (definition.access !== "registered_portal_manual_assisted" && authorization) {
    throw new Error("Only the registered DyStar eliot surface can carry portal session state.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared DyStar surface capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: DYSTAR_SUPPLIER_PROFILE.supplierId,
    providerId: DYSTAR_SUPPLIER_PROFILE.providerId,
    surface: createSurface(surfaceId),
  }, deps);
}
