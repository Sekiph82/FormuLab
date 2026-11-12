import {
  supplierProviderRegistrySchema,
  type SupplierProfile,
  type SupplierProviderProfile,
  type SupplierProviderRegistryDefinition,
  type SupplierSurfaceProfile,
} from "../schemas/supplierProvider";

/** Parse and index the shipped supplier/provider/surface definitions. This
 *  is a read-only registry; customer connection state and credentials stay
 *  in the existing connector-connection authority. */
export function createSupplierProviderRegistry(input: SupplierProviderRegistryDefinition) {
  const definition = supplierProviderRegistrySchema.parse(input);
  const suppliers = new Map(definition.suppliers.map((supplier) => [supplier.supplierId, supplier]));
  const providers = new Map(definition.providers.map((provider) => [provider.providerId, provider]));
  const surfaces = new Map(definition.surfaces.map((surface) => [surface.surfaceId, surface]));

  const listSurfacesForProvider = (providerId: string): SupplierSurfaceProfile[] =>
    definition.surfaces.filter((surface) => surface.providerId === providerId);
  const listSurfacesForSupplier = (supplierId: string): SupplierSurfaceProfile[] => {
    const providerIds = new Set(definition.providers
      .filter((provider) => provider.supplierId === supplierId)
      .map((provider) => provider.providerId));
    return definition.surfaces.filter((surface) => providerIds.has(surface.providerId));
  };

  return {
    schemaVersion: definition.schemaVersion,
    suppliers: definition.suppliers,
    providers: definition.providers,
    surfaces: definition.surfaces,
    getSupplier: (supplierId: string): SupplierProfile | undefined => suppliers.get(supplierId),
    getProvider: (providerId: string): SupplierProviderProfile | undefined => providers.get(providerId),
    getSurface: (surfaceId: string): SupplierSurfaceProfile | undefined => surfaces.get(surfaceId),
    listSurfacesForProvider,
    listSurfacesForSupplier,
  };
}
