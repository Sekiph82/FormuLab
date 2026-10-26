import { z } from "zod";
import {
  referenceFormulationQueryRecordSchema,
  type ReferenceFormulationQueryRecord,
} from "../schemas/referenceFormulationQuery";

export const REFERENCE_FORMULATION_LOCAL_INDEX_VERSION = "formulab-reference-formulation-local-index-v1";

const idListMapSchema = z.record(z.string().min(1), z.array(z.string().trim().min(1)));

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function arrayIndexValue(key: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/u.test(key)) return undefined;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value < 0xffff_ffff ? value : undefined;
}

function compareObjectKeys(left: string, right: string): number {
  const leftIndex = arrayIndexValue(left);
  const rightIndex = arrayIndexValue(right);
  if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
  if (leftIndex !== undefined) return -1;
  if (rightIndex !== undefined) return 1;
  return compareStable(left, right);
}

function isSortedObjectKeys(keys: string[]): boolean {
  return keys.every((key, index) => index === 0 || compareObjectKeys(keys[index - 1]!, key) < 0);
}

const numericRangeEntrySchema = z.object({
  queryRecordId: z.string().trim().min(1),
  sourceLineId: z.string().trim().min(1),
  kind: z.enum(["formula_amount_percent", "component_contribution_percent"]),
  lowerBound: z.number().finite().min(0).max(100),
  upperBound: z.number().finite().min(0).max(100),
  contributionId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.lowerBound > value.upperBound) {
    context.addIssue({ code: "custom", path: ["upperBound"], message: "Indexed numeric ranges must be ascending." });
  }
  if ((value.kind === "component_contribution_percent") !== (value.contributionId !== undefined)) {
    context.addIssue({ code: "custom", path: ["contributionId"], message: "Only component-contribution ranges identify a contribution." });
  }
});

export const referenceFormulationLocalIndexSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_LOCAL_INDEX_VERSION),
  queryRecordIds: z.array(z.string().trim().min(1)),
  aliases: idListMapSchema,
  suppliers: idListMapSchema,
  productFamilies: idListMapSchema,
  commercialProducts: idListMapSchema,
  canonicalChemicals: idListMapSchema,
  functions: idListMapSchema,
  numericRanges: z.array(numericRangeEntrySchema),
}).strict().superRefine((index, context) => {
  if (!isSortedUnique(index.queryRecordIds)) {
    context.addIssue({ code: "custom", path: ["queryRecordIds"], message: "Index query record IDs must be sorted and unique." });
  }
  for (const [field, entries] of Object.entries(index).filter(([key]) => key !== "schemaVersion" && key !== "queryRecordIds" && key !== "numericRanges")) {
    const map = entries as Record<string, string[]>;
    if (!isSortedObjectKeys(Object.keys(map))) {
      context.addIssue({ code: "custom", path: [field], message: "Index keys must use deterministic object-key order." });
    }
    for (const [key, ids] of Object.entries(map)) {
      if (!key.trim() || key.trim() !== key) {
        context.addIssue({ code: "custom", path: [field, key], message: "Index keys must be nonempty and trimmed." });
      }
      if ((field === "aliases" || field === "productFamilies") && normalizeReferenceFormulationAlias(key) !== key) {
        context.addIssue({ code: "custom", path: [field, key], message: "Text index keys must be normalized alias keys." });
      }
      if (!key || !isSortedUnique(ids) || ids.some((id) => !index.queryRecordIds.includes(id))) {
        context.addIssue({ code: "custom", path: [field, key], message: "Index postings must be sorted, unique and point to an indexed query record." });
      }
    }
  }
  const rangeKeys = index.numericRanges.map((entry) => `${entry.queryRecordId}\u0000${entry.sourceLineId}\u0000${entry.kind}\u0000${entry.contributionId ?? ""}`);
  if (!isSortedUnique(rangeKeys)) {
    context.addIssue({ code: "custom", path: ["numericRanges"], message: "Numeric range entries must be deterministically sorted and unique." });
  }
  if (index.numericRanges.some((entry) => !index.queryRecordIds.includes(entry.queryRecordId))) {
    context.addIssue({ code: "custom", path: ["numericRanges"], message: "Numeric ranges must point to an indexed query record." });
  }
});

export type ReferenceFormulationLocalIndex = z.infer<typeof referenceFormulationLocalIndexSchema>;

export type ReferenceFormulationIndexFilter = {
  aliases?: string[];
  supplierIds?: string[];
  productFamilies?: string[];
  commercialProductIds?: string[];
  canonicalChemicalIds?: string[];
  functions?: string[];
  numericRange?: {
    kind: ReferenceFormulationLocalIndex["numericRanges"][number]["kind"];
    lowerBound?: number;
    upperBound?: number;
  };
};

export const referenceFormulationIndexFilterSchema = z.object({
  aliases: z.array(z.string().trim().min(1)).optional(),
  supplierIds: z.array(z.string().trim().min(1)).optional(),
  productFamilies: z.array(z.string().trim().min(1)).optional(),
  commercialProductIds: z.array(z.string().trim().min(1)).optional(),
  canonicalChemicalIds: z.array(z.string().trim().min(1)).optional(),
  functions: z.array(z.string().trim().min(1)).optional(),
  numericRange: z.object({
    kind: z.enum(["formula_amount_percent", "component_contribution_percent"]),
    lowerBound: z.number().finite().min(0).max(100).optional(),
    upperBound: z.number().finite().min(0).max(100).optional(),
  }).strict().superRefine((value, context) => {
    if (value.lowerBound === undefined && value.upperBound === undefined) {
      context.addIssue({ code: "custom", path: ["lowerBound"], message: "Numeric range search requires at least one bound." });
    }
    if (value.lowerBound !== undefined && value.upperBound !== undefined && value.lowerBound > value.upperBound) {
      context.addIssue({ code: "custom", path: ["upperBound"], message: "Numeric range search bounds must be ascending." });
    }
  }).optional(),
}).strict();

function isSortedUnique(values: string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

/** NFKC and English-locale folding create stable exact-alias keys; source wording stays in the query record. */
export function normalizeReferenceFormulationAlias(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function addPosting(target: Map<string, Set<string>>, key: string | undefined, recordId: string): void {
  const normalized = key ? normalizeReferenceFormulationAlias(key) : "";
  if (!normalized) return;
  const postings = target.get(normalized) ?? new Set<string>();
  postings.add(recordId);
  target.set(normalized, postings);
}

function addIdentifier(target: Map<string, Set<string>>, key: string | undefined, recordId: string): void {
  if (!key?.trim()) return;
  const postings = target.get(key.trim()) ?? new Set<string>();
  postings.add(recordId);
  target.set(key.trim(), postings);
}

function toSortedMap(input: Map<string, Set<string>>): Record<string, string[]> {
  return Object.fromEntries([...input.entries()]
    .sort(([left], [right]) => compareObjectKeys(left, right))
    .map(([key, ids]) => [key, [...ids].sort(compareStable)]));
}

/** Build rebuildable postings only from query projections; this function never reads or parses source PDFs. */
export function buildReferenceFormulationLocalIndex(
  queryRecordInputs: ReferenceFormulationQueryRecord[],
): ReferenceFormulationLocalIndex {
  const records = queryRecordInputs.map((record) => referenceFormulationQueryRecordSchema.parse(record))
    .sort((left, right) => compareStable(left.id, right.id));
  const ids = records.map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error("Local index input cannot contain duplicate query record IDs.");

  const aliases = new Map<string, Set<string>>();
  const suppliers = new Map<string, Set<string>>();
  const productFamilies = new Map<string, Set<string>>();
  const commercialProducts = new Map<string, Set<string>>();
  const canonicalChemicals = new Map<string, Set<string>>();
  const functions = new Map<string, Set<string>>();
  const numericRanges: ReferenceFormulationLocalIndex["numericRanges"] = [];

  for (const record of records) {
    const recordId = record.id;
    addIdentifier(suppliers, record.supplierId, recordId);
    addPosting(aliases, record.supplierProduct.tradeName, recordId);
    addPosting(aliases, record.supplierProduct.grade, recordId);
    addPosting(aliases, record.supplierProduct.supplierItemCode, recordId);
    addPosting(aliases, record.formulationTitle, recordId);
    addPosting(aliases, record.formulationCode, recordId);
    for (const family of record.productFamily.candidates) {
      addPosting(productFamilies, family.rawValue, recordId);
      addPosting(aliases, family.rawValue, recordId);
    }

    for (const line of record.lines) {
      addPosting(aliases, line.sourceIngredientName, recordId);
      addPosting(aliases, line.supplierProductCode, recordId);
      addPosting(aliases, line.inciOrChemicalName, recordId);
      addPosting(aliases, line.supplierFunction.originalValue, recordId);
      for (const id of line.commercialProducts.candidateIds) addIdentifier(commercialProducts, id, recordId);
      for (const id of line.canonicalChemistry.candidateIds) addIdentifier(canonicalChemicals, id, recordId);
      for (const id of line.canonicalFunctions.candidateIds) addIdentifier(functions, id, recordId);
      for (const contribution of line.componentContributions) {
        if (contribution.commercialProductId) addIdentifier(commercialProducts, contribution.commercialProductId, recordId);
        for (const id of contribution.canonicalChemistry.candidateIds) addIdentifier(canonicalChemicals, id, recordId);
        const amountRange = contribution.formulaAmount.percentRange;
        if (amountRange) {
          numericRanges.push({ queryRecordId: recordId, sourceLineId: line.sourceLineId, kind: "formula_amount_percent", ...amountRange });
        }
        if (contribution.componentContributionPercentRange) {
          numericRanges.push({
            queryRecordId: recordId,
            sourceLineId: line.sourceLineId,
            kind: "component_contribution_percent",
            contributionId: contribution.contributionId,
            ...contribution.componentContributionPercentRange,
          });
        }
      }
    }
  }

  const uniqueNumericRanges = new Map<string, ReferenceFormulationLocalIndex["numericRanges"][number]>();
  for (const entry of numericRanges) {
    const key = `${entry.queryRecordId}\u0000${entry.sourceLineId}\u0000${entry.kind}\u0000${entry.contributionId ?? ""}`;
    const existing = uniqueNumericRanges.get(key);
    if (existing && (existing.lowerBound !== entry.lowerBound || existing.upperBound !== entry.upperBound)) {
      throw new Error("Component contributions for one formula line must agree on the source formula amount range.");
    }
    uniqueNumericRanges.set(key, entry);
  }
  const sortedNumericRanges = [...uniqueNumericRanges.values()].sort((left, right) =>
    compareStable(
      `${left.queryRecordId}\u0000${left.sourceLineId}\u0000${left.kind}\u0000${left.contributionId ?? ""}`,
      `${right.queryRecordId}\u0000${right.sourceLineId}\u0000${right.kind}\u0000${right.contributionId ?? ""}`,
    ));

  return referenceFormulationLocalIndexSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_LOCAL_INDEX_VERSION,
    queryRecordIds: ids,
    aliases: toSortedMap(aliases),
    suppliers: toSortedMap(suppliers),
    productFamilies: toSortedMap(productFamilies),
    commercialProducts: toSortedMap(commercialProducts),
    canonicalChemicals: toSortedMap(canonicalChemicals),
    functions: toSortedMap(functions),
    numericRanges: sortedNumericRanges,
  });
}

function unionPostings(map: Record<string, string[]>, keys: string[], normalizeKeys = false): Set<string> {
  const result = new Set<string>();
  for (const key of keys) {
    const normalized = normalizeKeys ? normalizeReferenceFormulationAlias(key) : key.trim();
    for (const id of map[normalized] ?? []) result.add(id);
  }
  return result;
}

/** Return matching query IDs in stable order. Values inside one filter are ORed; filter dimensions are ANDed. */
export function searchReferenceFormulationLocalIndex(
  indexInput: ReferenceFormulationLocalIndex,
  filterInput: ReferenceFormulationIndexFilter,
): string[] {
  const index = referenceFormulationLocalIndexSchema.parse(indexInput);
  const filter = referenceFormulationIndexFilterSchema.parse(filterInput);
  const dimensions: Set<string>[] = [];
  const addDimension = (map: Record<string, string[]>, keys: string[] | undefined, normalizeKeys = false) => {
    if (keys?.length) dimensions.push(unionPostings(map, keys, normalizeKeys));
  };
  addDimension(index.aliases, filter.aliases, true);
  addDimension(index.suppliers, filter.supplierIds);
  addDimension(index.productFamilies, filter.productFamilies, true);
  addDimension(index.commercialProducts, filter.commercialProductIds);
  addDimension(index.canonicalChemicals, filter.canonicalChemicalIds);
  addDimension(index.functions, filter.functions);
  if (filter.numericRange) {
    const { kind, lowerBound = 0, upperBound = 100 } = filter.numericRange;
    dimensions.push(new Set(index.numericRanges
      .filter((entry) => entry.kind === kind && entry.upperBound >= lowerBound && entry.lowerBound <= upperBound)
      .map((entry) => entry.queryRecordId)));
  }
  const matches = dimensions.length === 0
    ? index.queryRecordIds
    : index.queryRecordIds.filter((id) => dimensions.every((dimension) => dimension.has(id)));
  return [...matches].sort(compareStable);
}
