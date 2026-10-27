import {
  ARCHROMA_DOCUMENT_SURFACES, ARCHROMA_SUPPLIER_PROFILE,
  BASF_PORTAL_SURFACES, BASF_PUBLIC_DOCUMENT_SURFACES, BASF_SUPPLIER_PROFILE,
  CHT_PUBLIC_DOCUMENT_SURFACES, CHT_SUPPLIER_PROFILE, CRODA_DOCUMENT_SURFACES, CRODA_SUPPLIER_PROFILE,
  CLARIANT_DOCUMENT_SURFACES, CLARIANT_SUPPLIER_PROFILE, DOW_DOCUMENT_SURFACES, DOW_SUPPLIER_PROFILE,
  DYSTAR_DOCUMENT_SURFACES, DYSTAR_SUPPLIER_PROFILE, EVONIK_DOCUMENT_SURFACES, EVONIK_SUPPLIER_PROFILE,
  MY_CHT_SURFACE, MY_NOURYON_SURFACE, NOURYON_PUBLIC_SDS_SURFACE, NOURYON_PUBLIC_SDS_PRODUCT_LINES,
  NOURYON_SUPPLIER_PROFILE,
} from "@formulab/shared";

type SupplierIdentity = { supplierId: string; displayName: string; providerId: string };
type RawSurface = {
  surfaceId: string;
  displayName: string;
  entryPointUrl?: string;
  access?: string;
  productLine?: string;
  businessUnit?: string;
  region?: string;
  documentTypes?: readonly string[];
  limitations?: readonly string[];
};

export type SupplierConnectionSurface = {
  supplierId: string;
  supplierName: string;
  providerId: string;
  surfaceId: string;
  displayName: string;
  entryPointUrl?: string;
  accessMode: "public_manual" | "authenticated_manual" | "supplier_delivered_manual";
  scope: string[];
  documentTypes: string[];
  limitations: string[];
};

function normalizeSurface(supplier: SupplierIdentity, raw: RawSurface, authenticated = false): SupplierConnectionSurface {
  const accessText = `${raw.access ?? ""} ${raw.displayName}`.toLocaleLowerCase("en-US");
  if (/supplier.delivered/.test(accessText)) {
    return {
      supplierId: supplier.supplierId,
      supplierName: supplier.displayName,
      providerId: supplier.providerId,
      surfaceId: raw.surfaceId,
      displayName: raw.displayName,
      entryPointUrl: raw.entryPointUrl,
      accessMode: "supplier_delivered_manual",
      scope: [raw.region, raw.businessUnit, raw.productLine].filter((value): value is string => !!value && !/^user[- ]selected/i.test(value)),
      documentTypes: [...(raw.documentTypes ?? [])],
      limitations: [...(raw.limitations ?? [])],
    };
  }
  const requiresAuthentication = authenticated || /authenticated|registered account|customer portal|portal access/.test(accessText);
  return {
    supplierId: supplier.supplierId,
    supplierName: supplier.displayName,
    providerId: supplier.providerId,
    surfaceId: raw.surfaceId,
    displayName: raw.displayName,
    entryPointUrl: raw.entryPointUrl,
    accessMode: requiresAuthentication ? "authenticated_manual" : "public_manual",
    scope: [raw.region, raw.businessUnit, raw.productLine].filter((value): value is string => !!value && !/^user[- ]selected/i.test(value)),
    documentTypes: [...(raw.documentTypes ?? [])],
    limitations: [...(raw.limitations ?? [])],
  };
}

const manual = (supplier: SupplierIdentity, surfaces: readonly RawSurface[]) => surfaces.map((surface) => normalizeSurface(supplier, surface));
const authenticated = (supplier: SupplierIdentity, surface: RawSurface) => normalizeSurface(supplier, surface, true);

/** UI catalog is derived from the supplier adapter definitions. It describes
 *  declared surfaces only; authentication and last-check state come from the
 *  existing saved connector connection matched by exact surface ID. */
export const SUPPLIER_CONNECTION_CATALOG: SupplierConnectionSurface[] = [
  ...manual(CHT_SUPPLIER_PROFILE, CHT_PUBLIC_DOCUMENT_SURFACES),
  authenticated(CHT_SUPPLIER_PROFILE, { ...MY_CHT_SURFACE, documentTypes: ["SDS", "TDS", "OTHER"], limitations: ["Login and access stay user-attended; FormuLab does not automate the portal.", "Account-specific market and product coverage must be confirmed by the user."] }),
  ...manual(CRODA_SUPPLIER_PROFILE, CRODA_DOCUMENT_SURFACES),
  manual(NOURYON_SUPPLIER_PROFILE, [{ ...NOURYON_PUBLIC_SDS_SURFACE, productLine: NOURYON_PUBLIC_SDS_PRODUCT_LINES.join(", "), documentTypes: ["SDS"], limitations: ["Public search is limited to the declared product families; a zero result is not proof that a document does not exist.", "Search and file selection remain user-attended."] }])[0],
  authenticated(NOURYON_SUPPLIER_PROFILE, { ...MY_NOURYON_SURFACE, documentTypes: ["SDS", "TDS", "CERTIFICATE", "OTHER"], limitations: ["Account permissions, market, language and product coverage must be confirmed by the user.", "FormuLab does not automate portal login or extraction."] }),
  ...manual(CLARIANT_SUPPLIER_PROFILE, CLARIANT_DOCUMENT_SURFACES),
  ...manual(DOW_SUPPLIER_PROFILE, DOW_DOCUMENT_SURFACES),
  ...manual(BASF_SUPPLIER_PROFILE, BASF_PUBLIC_DOCUMENT_SURFACES),
  ...manual(BASF_SUPPLIER_PROFILE, BASF_PORTAL_SURFACES),
  ...manual(DYSTAR_SUPPLIER_PROFILE, DYSTAR_DOCUMENT_SURFACES),
  ...manual(ARCHROMA_SUPPLIER_PROFILE, ARCHROMA_DOCUMENT_SURFACES),
  ...manual(EVONIK_SUPPLIER_PROFILE, EVONIK_DOCUMENT_SURFACES),
];
