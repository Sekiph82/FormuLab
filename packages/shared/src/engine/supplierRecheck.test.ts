import { describe, expect, it } from "vitest";
import { planSupplierRecheck } from "./supplierRecheck";

const cursorRef = `formulab-credential:v1:${"a".repeat(32)}`;
const sha = (value: string) => value.repeat(64);

describe("supplier provider delta and recheck planning — V01-02.006", () => {
  it("uses a declared delta cursor only through an opaque credential reference", () => {
    const plan = planSupplierRecheck({
      capabilities: { deltaCursor: true },
      secureDeltaCursorRef: cursorRef,
      currentDocuments: [],
      priorDocuments: [],
    });
    expect(plan).toEqual({ strategy: "provider_delta", usesSecureDeltaCursor: true, decisions: [] });
    expect(JSON.stringify(plan)).not.toContain("a".repeat(32));
  });

  it("honestly declares a full rescan if delta is unsupported or its secure cursor is absent/invalid", () => {
    for (const input of [
      { capabilities: {}, secureDeltaCursorRef: cursorRef },
      { capabilities: { deltaCursor: true }, secureDeltaCursorRef: "raw-provider-cursor" },
      { capabilities: { deltaCursor: true } },
    ]) {
      const plan = planSupplierRecheck({ ...input, currentDocuments: [], priorDocuments: [] });
      expect(plan.strategy).toBe("full_rescan");
      expect(plan.usesSecureDeltaCursor).toBe(false);
      expect(plan.fullRescanReason).toBeTruthy();
    }
  });

  it("uses exact supplier revision and date evidence to separate unchanged and changed documents", () => {
    const plan = planSupplierRecheck({
      capabilities: { revision: true, revisionDate: true, deltaCursor: true },
      secureDeltaCursorRef: cursorRef,
      priorDocuments: [
        { documentKey: "product-1:SDS:EU:en", sourceRevision: "Rev 2", revisionDate: "2026-01-01" },
        { documentKey: "product-2:TDS:EU:en", sourceRevision: "Rev 1", revisionDate: "2025-01-01" },
      ],
      currentDocuments: [
        { documentKey: "product-1:SDS:EU:en", sourceRevision: "Rev 2", revisionDate: "2026-01-01" },
        { documentKey: "product-2:TDS:EU:en", sourceRevision: "Rev 2", revisionDate: "2026-02-01" },
      ],
    });
    expect(plan.decisions.map(({ disposition, reason }) => [disposition, reason])).toEqual([
      ["unchanged", "revision_match"],
      ["changed", "revision_changed"],
    ]);
  });

  it("uses content hashes for exact byte matches and fetches when no comparable metadata exists", () => {
    const plan = planSupplierRecheck({
      capabilities: { contentHash: true },
      currentDocuments: [
        { documentKey: "same", sha256: sha("b") },
        { documentKey: "changed", sha256: sha("c") },
        { documentKey: "new", sha256: sha("d") },
        { documentKey: "unknown" },
      ],
      priorDocuments: [
        { documentKey: "same", sha256: sha("B") },
        { documentKey: "changed", sha256: sha("a") },
      ],
    });
    expect(plan.decisions.map(({ disposition, reason }) => [disposition, reason])).toEqual([
      ["unchanged", "hash_match"],
      ["changed", "hash_changed"],
      ["fetch_to_compare", "no_comparable_metadata"],
      ["fetch_to_compare", "no_comparable_metadata"],
    ]);
  });

  it("does not infer date order from opaque or malformed date labels", () => {
    const plan = planSupplierRecheck({
      capabilities: { revisionDate: true },
      currentDocuments: [{ documentKey: "doc", revisionDate: "unknown" }],
      priorDocuments: [{ documentKey: "doc", revisionDate: "previous" }],
    });
    expect(plan.decisions[0]).toEqual({
      documentKey: "doc",
      disposition: "fetch_to_compare",
      reason: "no_comparable_metadata",
    });
  });

  it("rejects duplicate document identities rather than silently dropping a revision", () => {
    expect(() => planSupplierRecheck({
      capabilities: {},
      currentDocuments: [{ documentKey: "dup" }, { documentKey: "dup" }],
      priorDocuments: [],
    })).toThrow(/current document keys must be unique/);
  });
});
