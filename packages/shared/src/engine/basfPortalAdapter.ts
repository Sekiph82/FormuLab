import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const BASF_PORTAL_SURFACES = [
  {
    surfaceId: "basf-mybasfworld-manual",
    displayName: "myBASFWorld (authenticated, user attended)",
    entryPointUrl: "https://my.basf.com/en-US",
    productLine: "User-selected BASF business/product line",
    documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
    limitations: [
      "BASF terms describe myBASFWorld as password-protected for commercial customers; product-document availability depends on individual customer permissions.",
      "The user must personally authenticate and confirm that BASF permits local use of each selected document outside the portal under the applicable terms and account permissions.",
      "BASF prohibits disclosing portal access authorization. FormuLab does not automate login, MFA, browser session extraction or third-party portal access; only user-selected files are accepted.",
      "Product, market, language and document availability is account-specific; this profile is not evidence of complete BASF catalog access.",
    ],
  },
  {
    surfaceId: "basf-myindustryworld-dispersions-emea-manual",
    displayName: "MyIndustryWorld Dispersions and Resins (authenticated, user attended)",
    entryPointUrl: "https://myindustryworld.basf.com/emea/en",
    productLine: "Dispersions and Resins (EMEA)",
    documentTypes: ["SDS", "TDS", "OTHER"],
    limitations: [
      "BASF identifies MyIndustryWorld as a customer/partner service portal for EMEA dispersions/resins that provides product documents including TDS and SDS; account registration is subject to business-relation verification.",
      "The user must confirm that account permissions and applicable terms allow local use of each selected file. FormuLab does not automate login or extract portal data.",
      "Only files manually selected by the user enter FormuLab; access and product coverage remain limited to the user's verified account and chosen market/language scope.",
    ],
  },
  {
    surfaceId: "basf-myindustryworld-construction-additives-global-manual",
    displayName: "MyIndustryWorld Construction Additives (authenticated, user attended)",
    entryPointUrl: "https://myindustryworld.basf.com/emea/en/industries/construction-additives",
    productLine: "Construction Additives (global portal scope; account permissions apply)",
    documentTypes: ["SDS", "TDS", "OTHER"],
    limitations: [
      "BASF states MyIndustryWorld covers construction additives worldwide, with product search and product information downloads; some pages and documents may still require login.",
      "The user must confirm account permissions and applicable terms allow local use of each selected file. FormuLab does not automate login or extract portal data.",
      "Only user-selected files are accepted. The declared scope records the actual country, language and product line checked by the user, not the portal's full stated region.",
    ],
  },
  {
    surfaceId: "basf-electronic-materials-catamold-manual",
    displayName: "BASF Electronic Materials Catamold Download Center (authenticated, user attended)",
    entryPointUrl: "https://electronics-electric.basf.com/global/en/electronics/restricted_area",
    productLine: "Electronic Materials / Catamold",
    documentTypes: ["SDS", "TDS"],
    limitations: [
      "BASF identifies this as a restricted technical-information and SDS download center; login is necessary and the page currently identifies Catamold documents as available.",
      "The user must confirm the account is authorized for the product and that local use of selected files is permitted. No automated login, MFA or hidden endpoints are used.",
      "The public page shows other sector areas (Semiconductors and Display Materials) as login-required; this profile does not assume their documents are available or infer coverage from the Catamold section.",
    ],
  },
] as const;

export interface BasfPortalAuthorization {
  connection: ConnectorConnection;
  confirmation: { userConfirmedAuthentication: true; authenticatedAt: string };
  authorizedScope: { markets: string[]; languages: string[]; productLines: string[] };
  /** Confirms the user has authority to use the portal and locally use selected files under BASF terms. */
  localDocumentUseConfirmed: boolean;
  authorizationConfirmedBy: string;
  authorizationConfirmedAt: string;
}

function surfaceDefinition(surfaceId: string) {
  const definition = BASF_PORTAL_SURFACES.find((candidate) => candidate.surfaceId === surfaceId);
  if (!definition) throw new Error("Unknown BASF portal surface.");
  return definition;
}

function createSurface(surfaceId: string): SupplierSurfaceProfile {
  const definition = surfaceDefinition(surfaceId);
  return supplierSurfaceProfileSchema.parse({
    surfaceId: definition.surfaceId,
    providerId: "basf",
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

function requireAuthorizedScope(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: BasfPortalAuthorization | undefined,
): void {
  if (!authorization) throw new Error("BASF portal intake requires an authorized customer/partner account.");
  const connection = connectorConnectionSchema.parse(authorization.connection);
  if (connection.lifecycleState !== "authenticated"
    || !connection.connectionRef
    || !/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)
    || authorization.confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(authorization.confirmation.authenticatedAt))) {
    throw new Error("BASF portal intake requires user-attended authentication and an OS credential reference.");
  }
  if (authorization.localDocumentUseConfirmed !== true
    || !authorization.authorizationConfirmedBy.trim()
    || !Number.isFinite(Date.parse(authorization.authorizationConfirmedAt))) {
    throw new Error("A named user must confirm BASF authorization and permission for local use of selected documents.");
  }
  const authorized = {
    markets: new Set(authorization.authorizedScope.markets.map((value) => value.toLocaleLowerCase("en-US"))),
    languages: new Set(authorization.authorizedScope.languages.map((value) => value.toLocaleLowerCase("en-US"))),
    productLines: new Set(authorization.authorizedScope.productLines.map((value) => value.toLocaleLowerCase("en-US"))),
  };
  for (const dimension of ["markets", "languages", "productLines"] as const) {
    const outside = profile.scope[dimension].filter((value) => !authorized[dimension].has(value.toLocaleLowerCase("en-US")));
    if (outside.length > 0) {
      throw new Error(`BASF requested ${dimension} scope exceeds the user-confirmed account authorization.`);
    }
  }
}

/** Separately scoped BASF customer portals use a user-attended local-file
 * workflow. This never logs in, extracts cookies, or calls undocumented APIs. */
export function createBasfPortalAdapter(
  surfaceId: string,
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: BasfPortalAuthorization | undefined,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  const definition = surfaceDefinition(surfaceId);
  requireAuthorizedScope(profile, authorization);
  if (profile.scope.productLines.length === 0 || profile.scope.productLines.some((line) => !line.trim())) {
    throw new Error("BASF portal scope must name the product lines the user actually selected.");
  }
  for (const document of profile.documents) {
    if (!definition.documentTypes.some((type) => type === document.documentType)) {
      throw new Error("Selected document type is outside the declared BASF portal capability.");
    }
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: "basf",
    providerId: "basf",
    surface: createSurface(surfaceId),
  }, deps);
}
