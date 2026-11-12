import { connectorConnectionSchema, type ConnectorConnection } from "../schemas/connector";
import type { SupplierSurfaceProfile } from "../schemas/supplierProvider";
import type { StageOptions } from "./fileConnector";
import { createSupplierRestAdapter, type SupplierRestAdapterDeps, type SupplierRestAdapterFieldMap } from "./supplierRestAdapter";
import type { SupplierAdapterConformanceTarget } from "./supplierAdapterConformance";

export interface SupplierPortalAdapterProfile {
  supplierId: string;
  providerId: string;
  surface: SupplierSurfaceProfile;
  connection: ConnectorConnection;
  endpoints: { catalogPath: string; documentPath: string };
  fields: SupplierRestAdapterFieldMap;
  scope: { markets: string[]; languages: string[]; productLines: string[] };
}

export interface UserAttendedPortalConfirmation {
  /** Set only after the user completes the supplier's own login flow. */
  userConfirmedAuthentication: true;
  authenticatedAt: string;
}

/** Creates an adapter for an already-authenticated, user-attended portal
 * session. This function does not launch a browser, automate login, inspect
 * cookies, handle MFA/CAPTCHA, or extract session material. */
export function createAuthenticatedSupplierPortalAdapter(
  profile: SupplierPortalAdapterProfile,
  confirmation: UserAttendedPortalConfirmation,
  stageOptions: StageOptions,
  deps: SupplierRestAdapterDeps,
): SupplierAdapterConformanceTarget {
  const connection = connectorConnectionSchema.parse(profile.connection);
  if (profile.surface.kind !== "authenticated_portal"
    || (profile.surface.capabilities.authorizationMode !== "authenticated_portal"
      && profile.surface.capabilities.authorizationMode !== "user_attended")) {
    throw new Error("Supplier portal adapter requires a separately declared authenticated portal surface.");
  }
  if (connection.connectorType !== "REST_API" || connection.lifecycleState !== "authenticated"
    || connection.baseUrl !== profile.connection.baseUrl
    || !connection.connectionRef || connection.connectionRef !== profile.connection.connectionRef) {
    throw new Error("Supplier portal connection must be explicitly authenticated and reference an OS credential.");
  }
  if (!/^formulab-credential:v1:[a-f0-9]{32}$/.test(connection.connectionRef)) {
    throw new Error("Supplier portal session must use an OS credential-manager reference.");
  }
  if (confirmation.userConfirmedAuthentication !== true
    || !Number.isFinite(Date.parse(confirmation.authenticatedAt))) {
    throw new Error("Supplier portal authentication must be confirmed by the user after the supplier login flow.");
  }
  if (profile.surface.providerId !== profile.providerId || !profile.supplierId.trim()) {
    throw new Error("Supplier portal identity does not match its registered surface.");
  }

  return createSupplierRestAdapter({
    supplierId: profile.supplierId,
    providerId: profile.providerId,
    surface: profile.surface,
    connectionRef: connection.connectionRef,
    baseUrl: connection.baseUrl ?? "",
    catalogPath: profile.endpoints.catalogPath,
    documentPath: profile.endpoints.documentPath,
    fields: profile.fields,
    scope: profile.scope,
    userAttendedAuthentication: {
      lifecycleState: "authenticated",
      authenticatedAt: confirmation.authenticatedAt,
    },
  }, stageOptions, deps);
}
