import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const MY_CHT_SURFACE = {
  surfaceId: "cht-mycht-manual",
  displayName: "myCHT (authenticated, user attended)",
  entryPointUrl: "https://solutions.cht.com/cht/web.nsf/id/pa_my-cht_dashboard_en.html",
} as const;

export interface MyChtPortalAuthorization {
  connection: ConnectorConnection;
  confirmation: { userConfirmedAuthentication: true; authenticatedAt: string };
  /** Markets, languages and product lines the named user confirms are enabled by CHT. */
  authorizedScope: { markets: string[]; languages: string[]; productLines: string[] };
  /** Confirms CHT's customer/partner and account approval requirements were met. */
  authorizationConfirmedBy: string;
  authorizationConfirmedAt: string;
}

function createSurface(): SupplierSurfaceProfile {
  return supplierSurfaceProfileSchema.parse({
    surfaceId: MY_CHT_SURFACE.surfaceId,
    providerId: "cht",
    displayName: MY_CHT_SURFACE.displayName,
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
        productLines: [],
        documentTypes: ["SDS", "TDS", "OTHER"],
      },
      limitations: [
        "CHT says myCHT registration provides technical leaflets and dyestuff profiles; customer SDS access requires CHT authorization and can vary by account.",
        "CHT states SDS access requires a direct or indirect business relationship and a business email; its team reviews registrations and may revoke authorization.",
        "The user must authenticate directly with CHT and confirm the exact market, language and product-line scope enabled for their account.",
        "FormuLab does not automate login, MFA, requests or portal extraction. Only user-selected files enter the local immutable document/provenance path.",
        "This profile does not claim complete CHT catalog coverage or certificate/formulation access; unsupported document types are rejected.",
      ],
    },
  });
}

function requireAuthorizedPortalScope(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: MyChtPortalAuthorization | undefined,
): void {
  if (!authorization) throw new Error("myCHT requires an existing CHT-authorized user account.");
  const connection = connectorConnectionSchema.parse(authorization.connection);
  if (connection.lifecycleState !== "authenticated"
    || !connection.connectionRef
    || !/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)
    || authorization.confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(authorization.confirmation.authenticatedAt))) {
    throw new Error("myCHT requires user-attended authentication and an OS credential reference.");
  }
  if (!authorization.authorizationConfirmedBy.trim()
    || !Number.isFinite(Date.parse(authorization.authorizationConfirmedAt))) {
    throw new Error("myCHT's CHT-approved customer/partner account scope must be confirmed by a named user.");
  }
  const authorized = {
    markets: new Set(authorization.authorizedScope.markets.map((value) => value.toLocaleLowerCase("en-US"))),
    languages: new Set(authorization.authorizedScope.languages.map((value) => value.toLocaleLowerCase("en-US"))),
    productLines: new Set(authorization.authorizedScope.productLines.map((value) => value.toLocaleLowerCase("en-US"))),
  };
  for (const dimension of ["markets", "languages", "productLines"] as const) {
    const outside = profile.scope[dimension].filter((value) => !authorized[dimension].has(value.toLocaleLowerCase("en-US")));
    if (outside.length > 0) {
      throw new Error(`myCHT requested ${dimension} scope exceeds the user-confirmed CHT authorization.`);
    }
  }
}

/** User-attended intake for a CHT-authorized myCHT account. It does not
 * automate portal access and accepts only the user's selected SDS/TDS or
 * explicitly typed other product-information files. */
export function createMyChtAdapter(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: MyChtPortalAuthorization | undefined,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  requireAuthorizedPortalScope(profile, authorization);
  if (profile.documents.some(({ documentType }) => !["SDS", "TDS", "OTHER"].includes(documentType))) {
    throw new Error("myCHT imports only the declared SDS, TDS and other product-information document types.");
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: "cht",
    providerId: "cht",
    surface: createSurface(),
  }, deps);
}
