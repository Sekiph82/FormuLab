import { z } from "zod";

export const CANONICAL_CHEMICAL_PROVENANCE_TYPES = [
  "supplier_sds",
  "supplier_tds",
  "public_registry",
  "literature",
  "curated_reference",
  "owner_entry",
] as const;

export const canonicalChemicalSynonymSchema = z.object({
  value: z.string().trim().min(1).max(240),
  kind: z.enum(["abbreviation", "synonym"]),
  /** Provenance is linked by ID; unresolved/unreviewed names remain proposals. */
  provenanceId: z.string().trim().min(1).optional(),
}).strict();

export const canonicalChemicalIdentifierSchema = z.object({
  /** Original identifier text is retained; syntax/check-digit normalization is handled by V01-04.003. */
  value: z.string().trim().min(1).max(100),
  provenanceId: z.string().trim().min(1).optional(),
}).strict();

export const canonicalChemicalProvenanceSchema = z.object({
  id: z.string().trim().min(1),
  sourceType: z.enum(CANONICAL_CHEMICAL_PROVENANCE_TYPES),
  sourceReference: z.string().trim().min(1).max(500),
  sourceDocumentCode: z.string().trim().min(1).optional(),
  pageOrSection: z.string().trim().min(1).max(160).optional(),
  recordedAt: z.string().datetime({ offset: true }),
}).strict();

/** A curated chemical identity candidate, separate from RawMaterial and commercial products. */
export const canonicalChemicalSchema = z.object({
  schemaVersion: z.literal("1.0"),
  /** Stable opaque library key. It is not derived from a name, CAS or EC value. */
  id: z.string().trim().min(1),
  preferredName: z.string().trim().min(1).max(240),
  casIdentifiers: z.array(canonicalChemicalIdentifierSchema).default([]),
  ecIdentifiers: z.array(canonicalChemicalIdentifierSchema).default([]),
  /** INCI applies only where an ingredient declaration name is relevant. */
  inciName: z.string().trim().min(1).max(240).optional(),
  synonyms: z.array(canonicalChemicalSynonymSchema).default([]),
  chemicalFamily: z.string().trim().min(1).max(160).optional(),
  /** Application/role classification; intentionally distinct from chemicalFamily. */
  functionalFamilies: z.array(z.string().trim().min(1).max(160)).default([]),
  provenance: z.array(canonicalChemicalProvenanceSchema).min(1),
}).strict().superRefine((record, context) => {
  const provenanceIds = new Set(record.provenance.map((item) => item.id));
  for (const [collectionName, items] of [["casIdentifiers", record.casIdentifiers], ["ecIdentifiers", record.ecIdentifiers], ["synonyms", record.synonyms]] as const) {
    items.forEach((item, index) => {
      if (item.provenanceId && !provenanceIds.has(item.provenanceId)) {
        context.addIssue({
          code: "custom",
          path: [collectionName, index, "provenanceId"],
          message: "Identifier and synonym provenance references must resolve within this record.",
        });
      }
    });
  }
  if (new Set(record.provenance.map((item) => item.id)).size !== record.provenance.length) {
    context.addIssue({ code: "custom", path: ["provenance"], message: "Provenance IDs must be unique." });
  }
});

export type CanonicalChemicalIdentifier = z.infer<typeof canonicalChemicalIdentifierSchema>;
export type CanonicalChemicalSynonym = z.infer<typeof canonicalChemicalSynonymSchema>;
export type CanonicalChemicalProvenance = z.infer<typeof canonicalChemicalProvenanceSchema>;
export type CanonicalChemical = z.infer<typeof canonicalChemicalSchema>;
