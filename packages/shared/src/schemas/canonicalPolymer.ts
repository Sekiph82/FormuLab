import { z } from "zod";
import { canonicalCasIdentifierSchema, canonicalEcIdentifierSchema } from "./canonicalChemical";

export const POLYMER_IDENTITY_TYPES = ["homopolymer", "copolymer", "crosspolymer", "macromolecular_material", "unknown"] as const;
export const POLYMER_PROPERTY_KINDS = ["molecular_weight", "molecular_weight_distribution", "glass_transition_temperature", "viscosity", "charge_density", "solids_content", "particle_size", "other"] as const;

export function normalizePolymerMaterialNumber(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleUpperCase("en-US");
}

export const canonicalPolymerMaterialNumberSchema = z.object({
  originalValue: z.string().min(1).refine((value) => value.trim().length > 0),
  normalizedValue: z.string().min(1),
  provenanceId: z.string().trim().min(1).optional(),
}).strict().superRefine((record, context) => {
  if (normalizePolymerMaterialNumber(record.originalValue) !== record.normalizedValue) {
    context.addIssue({ code: "custom", path: ["normalizedValue"], message: "Normalized material number must match its source value." });
  }
});

export const canonicalPolymerPropertySchema = z.object({
  kind: z.enum(POLYMER_PROPERTY_KINDS),
  originalValue: z.string().min(1).refine((value) => value.trim().length > 0),
  unit: z.string().trim().min(1).optional(),
  conditions: z.string().trim().min(1).optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  provenanceId: z.string().trim().min(1).optional(),
}).strict();

export const canonicalPolymerSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  preferredName: z.string().trim().min(1).max(240),
  polymerType: z.enum(POLYMER_IDENTITY_TYPES).default("unknown"),
  materialNumbers: z.array(canonicalPolymerMaterialNumberSchema).default([]),
  casIdentifiers: z.array(canonicalCasIdentifierSchema).default([]),
  ecIdentifiers: z.array(canonicalEcIdentifierSchema).default([]),
  monomerReferences: z.array(z.object({
    canonicalChemicalId: z.string().trim().min(1),
    role: z.enum(["monomer", "crosslinker", "repeat_unit"]),
    provenanceId: z.string().trim().min(1),
  }).strict()).default([]),
  properties: z.array(canonicalPolymerPropertySchema).default([]),
  provenance: z.array(z.object({
    id: z.string().trim().min(1),
    sourceReference: z.string().trim().min(1).max(500),
    recordedAt: z.string().datetime({ offset: true }),
  }).strict()).min(1),
}).strict().superRefine((record, context) => {
  const ids = record.provenance.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["provenance"], message: "Polymer provenance IDs must be unique." });
  }
  for (const [index, materialNumber] of record.materialNumbers.entries()) {
    if (!materialNumber.provenanceId) {
      context.addIssue({ code: "custom", path: ["materialNumbers", index, "provenanceId"], message: "Polymer material numbers require source provenance." });
    } else if (!ids.includes(materialNumber.provenanceId)) {
      context.addIssue({ code: "custom", path: ["materialNumbers", index, "provenanceId"], message: "Material number provenance must resolve within this polymer record." });
    }
  }
  for (const [index, identifier] of record.casIdentifiers.entries()) {
    if (!identifier.provenanceId) {
      context.addIssue({ code: "custom", path: ["casIdentifiers", index, "provenanceId"], message: "Polymer CAS identifiers require source provenance." });
    } else if (!ids.includes(identifier.provenanceId)) {
      context.addIssue({ code: "custom", path: ["casIdentifiers", index, "provenanceId"], message: "CAS provenance must resolve within this polymer record." });
    }
  }
  for (const [index, identifier] of record.ecIdentifiers.entries()) {
    if (!identifier.provenanceId) {
      context.addIssue({ code: "custom", path: ["ecIdentifiers", index, "provenanceId"], message: "Polymer EC identifiers require source provenance." });
    } else if (!ids.includes(identifier.provenanceId)) {
      context.addIssue({ code: "custom", path: ["ecIdentifiers", index, "provenanceId"], message: "EC provenance must resolve within this polymer record." });
    }
  }
  for (const [index, monomer] of record.monomerReferences.entries()) {
    if (!ids.includes(monomer.provenanceId)) {
      context.addIssue({ code: "custom", path: ["monomerReferences", index, "provenanceId"], message: "Monomer reference provenance must resolve within this polymer record." });
    }
  }
  for (const [index, property] of record.properties.entries()) {
    if (property.provenanceId && !ids.includes(property.provenanceId)) {
      context.addIssue({ code: "custom", path: ["properties", index, "provenanceId"], message: "Polymer property provenance must resolve within this record." });
    }
  }
});

export type CanonicalPolymer = z.infer<typeof canonicalPolymerSchema>;
