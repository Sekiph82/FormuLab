import { describe, expect, it } from "vitest";
import { createSupplierProviderRegistry } from "./supplierProviderRegistry";
import type { SupplierProviderRegistryDefinition } from "../schemas/supplierProvider";

const capabilities = (authorizationMode: "public" | "authenticated_portal") => ({
  catalogDiscovery: true,
  documentDiscovery: true,
  documentFetch: authorizationMode === "public",
  formulationDiscovery: false,
  pagination: { mode: "cursor" as const },
  authorizationMode,
  coverage: {
    status: "partial" as const,
    markets: ["EU"],
    languages: ["en"],
    productLines: ["Home Care"],
    documentTypes: ["SDS" as const, "TDS" as const],
  },
  limitations: authorizationMode === "public" ? ["Portal-only documents are not scanned."] : ["Requires user-attended sign-in."],
});

const definition: SupplierProviderRegistryDefinition = {
  schemaVersion: "1.0",
  suppliers: [{ supplierId: "supplier-example", displayName: "Example Supplier" }],
  providers: [{ supplierId: "supplier-example", providerId: "example-adapter", adapterId: "example", adapterVersion: "1.0.0" }],
  surfaces: [
    { surfaceId: "example-public", providerId: "example-adapter", displayName: "Public Documents", kind: "public_document_center", capabilities: capabilities("public") },
    { surfaceId: "example-portal", providerId: "example-adapter", displayName: "Customer Portal", kind: "authenticated_portal", capabilities: capabilities("authenticated_portal") },
  ],
};

describe("supplier provider and surface registry — V01-01.002", () => {
  it("keeps supplier, adapter and access surfaces separate and indexes multiple surface scopes", () => {
    const registry = createSupplierProviderRegistry(definition);

    expect(registry.getSupplier("supplier-example")?.displayName).toBe("Example Supplier");
    expect(registry.getProvider("example-adapter")?.supplierId).toBe("supplier-example");
    expect(registry.listSurfacesForSupplier("supplier-example").map(({ surfaceId }) => surfaceId)).toEqual([
      "example-public", "example-portal",
    ]);
    expect(registry.getSurface("example-public")?.capabilities.authorizationMode).toBe("public");
    expect(registry.getSurface("example-portal")?.capabilities.authorizationMode).toBe("authenticated_portal");
    expect(registry.listSurfacesForProvider("missing-provider")).toEqual([]);
  });

  it("rejects duplicate IDs and provider or surface references without a registered parent", () => {
    expect(() => createSupplierProviderRegistry({
      ...definition,
      suppliers: [...definition.suppliers, definition.suppliers[0]],
    })).toThrow(/Duplicate suppliers ID/);
    expect(() => createSupplierProviderRegistry({
      ...definition,
      providers: [{ ...definition.providers[0], supplierId: "missing-supplier" }],
    })).toThrow(/Unknown supplier/);
    expect(() => createSupplierProviderRegistry({
      ...definition,
      surfaces: [{ ...definition.surfaces[0], providerId: "missing-provider" }],
    })).toThrow(/Unknown provider/);
  });

  it("rejects undeclared registry fields such as credential material", () => {
    expect(() => createSupplierProviderRegistry({
      ...definition,
      providers: [{ ...definition.providers[0], apiKey: "do-not-store" }],
    } as unknown as SupplierProviderRegistryDefinition)).toThrow();
  });
});
