import { z } from "zod";
import { supplierDocumentCapabilitiesSchema } from "./connector";

const registryIdSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

/** Supplier is the commercial organization. A provider adapter and its
 *  access surfaces are separate records because one supplier can expose
 *  multiple surfaces with different authentication and coverage. */
export const supplierProfileSchema = z.object({
  supplierId: registryIdSchema,
  displayName: z.string().trim().min(1),
}).strict();
export type SupplierProfile = z.infer<typeof supplierProfileSchema>;

export const supplierProviderProfileSchema = z.object({
  providerId: registryIdSchema,
  supplierId: registryIdSchema,
  adapterId: registryIdSchema,
  adapterVersion: z.string().trim().min(1),
}).strict();
export type SupplierProviderProfile = z.infer<typeof supplierProviderProfileSchema>;

export const SUPPLIER_SURFACE_KINDS = [
  "public_search",
  "public_document_center",
  "rest_api",
  "technical_library",
  "authenticated_portal",
  "manual_assisted",
] as const;
export type SupplierSurfaceKind = (typeof SUPPLIER_SURFACE_KINDS)[number];

export const supplierSurfaceProfileSchema = z.object({
  surfaceId: registryIdSchema,
  providerId: registryIdSchema,
  displayName: z.string().trim().min(1),
  kind: z.enum(SUPPLIER_SURFACE_KINDS),
  /** Carries explicit access mode, coverage scope, supported document
   *  operations, pagination and limitations from the connector contract. */
  capabilities: supplierDocumentCapabilitiesSchema,
}).strict();
export type SupplierSurfaceProfile = z.infer<typeof supplierSurfaceProfileSchema>;

export const supplierProviderRegistrySchema = z.object({
  schemaVersion: z.literal("1.0"),
  suppliers: z.array(supplierProfileSchema),
  providers: z.array(supplierProviderProfileSchema),
  surfaces: z.array(supplierSurfaceProfileSchema),
}).strict().superRefine((registry, context) => {
  const unique = (items: { id: string }[], label: string) => {
    const seen = new Set<string>();
    items.forEach(({ id }, index) => {
      if (seen.has(id)) context.addIssue({ code: "custom", path: [label, index, "id"], message: `Duplicate ${label} ID: ${id}.` });
      seen.add(id);
    });
  };
  unique(registry.suppliers.map(({ supplierId }) => ({ id: supplierId })), "suppliers");
  unique(registry.providers.map(({ providerId }) => ({ id: providerId })), "providers");
  unique(registry.surfaces.map(({ surfaceId }) => ({ id: surfaceId })), "surfaces");

  const supplierIds = new Set(registry.suppliers.map(({ supplierId }) => supplierId));
  const providerIds = new Set(registry.providers.map(({ providerId }) => providerId));
  registry.providers.forEach((provider, index) => {
    if (!supplierIds.has(provider.supplierId)) {
      context.addIssue({ code: "custom", path: ["providers", index, "supplierId"], message: `Unknown supplier ${provider.supplierId}.` });
    }
  });
  registry.surfaces.forEach((surface, index) => {
    if (!providerIds.has(surface.providerId)) {
      context.addIssue({ code: "custom", path: ["surfaces", index, "providerId"], message: `Unknown provider ${surface.providerId}.` });
    }
  });
});
export type SupplierProviderRegistryDefinition = z.infer<typeof supplierProviderRegistrySchema>;
