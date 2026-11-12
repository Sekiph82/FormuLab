import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import {
  createManualAssistedSupplierAdapter,
  type SupplierManualAdapterDeps,
  type SupplierManualAdapterProfile,
} from "./supplierManualAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export const MY_NOURYON_SURFACE = {
  surfaceId: "nouryon-my-nouryon-manual",
  displayName: "My Nouryon (authenticated, user attended)",
  entryPointUrl: "https://my.nouryon.com/login/aboutmynouryon",
} as const;

export interface MyNouryonPortalAuthorization {
  connection: ConnectorConnection;
  confirmation: { userConfirmedAuthentication: true; authenticatedAt: string };
  /** Scope the user confirms is actually enabled in the supplier portal. */
  authorizedScope: { markets: string[]; languages: string[]; productLines: string[] };
  authorizationConfirmedBy: string;
  authorizationConfirmedAt: string;
}

function createSurface(): SupplierSurfaceProfile {
  return supplierSurfaceProfileSchema.parse({
    surfaceId: MY_NOURYON_SURFACE.surfaceId,
    providerId: "nouryon",
    displayName: MY_NOURYON_SURFACE.displayName,
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
        documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"],
      },
      limitations: [
        "Nouryon states My Nouryon is password-protected and access is for existing customers after Nouryon validates and approves the request.",
        "The customer must authenticate through Nouryon and confirm the product/market scope enabled in their own account.",
        "FormuLab does not automate portal login or requests; only user-selected files enter the local document store.",
      ],
    },
  });
}

function requireAuthorizedPortalScope(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: MyNouryonPortalAuthorization | undefined,
): void {
  if (!authorization) throw new Error("My Nouryon requires an existing, supplier-authorized user account.");
  const connection = connectorConnectionSchema.parse(authorization.connection);
  const { confirmation } = authorization;
  if (connection.lifecycleState !== "authenticated"
    || !connection.connectionRef
    || !/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)
    || confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(confirmation.authenticatedAt))) {
    throw new Error("My Nouryon requires user-attended authentication and an OS credential reference.");
  }
  if (!authorization.authorizationConfirmedBy.trim()
    || !Number.isFinite(Date.parse(authorization.authorizationConfirmedAt))) {
    throw new Error("My Nouryon's supplier-approved account scope must be confirmed by a named user.");
  }
  const authorized = {
    markets: new Set(authorization.authorizedScope.markets.map((value) => value.toLocaleLowerCase("en-US"))),
    languages: new Set(authorization.authorizedScope.languages.map((value) => value.toLocaleLowerCase("en-US"))),
    productLines: new Set(authorization.authorizedScope.productLines.map((value) => value.toLocaleLowerCase("en-US"))),
  };
  for (const dimension of ["markets", "languages", "productLines"] as const) {
    const outside = profile.scope[dimension].filter((value) => !authorized[dimension].has(value.toLocaleLowerCase("en-US")));
    if (outside.length > 0) {
      throw new Error(`My Nouryon requested ${dimension} scope exceeds the user-confirmed supplier authorization.`);
    }
  }
}

/** User-attended local import for a user-authorized My Nouryon account.
 * No credentials, browser cookies or portal content are fetched by this
 * adapter. Supplier-granted scope is checked before file intake. */
export function createMyNouryonAdapter(
  profile: Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface">,
  authorization: MyNouryonPortalAuthorization | undefined,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  requireAuthorizedPortalScope(profile, authorization);
  if (profile.documents.some(({ documentType }) => documentType === "FORMULATION")) {
    throw new Error("My Nouryon profile imports only the product-document types declared by the portal profile.");
  }
  return createManualAssistedSupplierAdapter({
    ...profile,
    supplierId: "nouryon",
    providerId: "nouryon",
    surface: createSurface(),
  }, deps);
}
