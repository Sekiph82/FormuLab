import { commercialProductSchema, type CommercialProduct } from "../schemas/commercialProduct";
import { referenceFormulationSourceSchema, type ReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import { referenceFormulationIngredientLineSchema, type ReferenceFormulationIngredientLine } from "./referenceFormulationIngredientExtraction";

export const REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION = "formulab-reference-formulation-product-matcher-v1";

export type ReferenceFormulationProductMatchTier = "exact" | "controlled_alias" | "fuzzy_proposal";
export type ReferenceFormulationProductMatchOn = "product_code" | "trade_name" | "alias";

export interface ReferenceFormulationProductCandidate {
  commercialProductId: string;
  tier: ReferenceFormulationProductMatchTier;
  matchedOn: ReferenceFormulationProductMatchOn[];
  matchedValues: string[];
  sourceDocumentCodes: string[];
  similarity?: number;
}

export interface ReferenceFormulationProductLineMatch {
  ingredientLineId: string;
  sourceSupplierId: string;
  resolution: "exact_match_candidate" | "alias_match_candidate" | "fuzzy_proposal" | "ambiguous" | "unmatched";
  candidates: ReferenceFormulationProductCandidate[];
  autoLinked: false;
  reviewRequired: true;
}

export interface ReferenceFormulationProductMatchingResult {
  sourceId: string;
  sourceDocumentHash: string;
  matcherVersion: typeof REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION;
  lines: ReferenceFormulationProductLineMatch[];
  warnings: Array<"ambiguous_product_candidates" | "fuzzy_matches_are_proposals_only" | "unmatched_ingredient_lines" | "supplier_products_excluded">;
  reviewRequired: true;
}

function identityKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]!;
      previous[column] = Math.min(previous[column]! + 1, previous[column - 1]! + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

function similarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - editDistance(left, right) / maxLength;
}

function uniqueCandidates(candidates: ReferenceFormulationProductCandidate[]): ReferenceFormulationProductCandidate[] {
  const byProduct = new Map<string, ReferenceFormulationProductCandidate>();
  for (const candidate of candidates) {
    const current = byProduct.get(candidate.commercialProductId);
    if (!current) {
      byProduct.set(candidate.commercialProductId, { ...candidate, matchedOn: [...new Set(candidate.matchedOn)], matchedValues: [...new Set(candidate.matchedValues)], sourceDocumentCodes: [...new Set(candidate.sourceDocumentCodes)] });
      continue;
    }
    const tierRank = { exact: 0, controlled_alias: 1, fuzzy_proposal: 2 } as const;
    if (tierRank[candidate.tier] < tierRank[current.tier]) current.tier = candidate.tier;
    current.matchedOn = [...new Set([...current.matchedOn, ...candidate.matchedOn])];
    current.matchedValues = [...new Set([...current.matchedValues, ...candidate.matchedValues])];
    current.sourceDocumentCodes = [...new Set([...current.sourceDocumentCodes, ...candidate.sourceDocumentCodes])];
    if (candidate.similarity !== undefined) current.similarity = Math.max(current.similarity ?? 0, candidate.similarity);
  }
  return [...byProduct.values()];
}

function resultForLine(line: ReferenceFormulationIngredientLine, source: ReferenceFormulationSource, products: CommercialProduct[]): ReferenceFormulationProductLineMatch {
  line = referenceFormulationIngredientLineSchema.parse(line);
  if (line.sourceDocumentHash.toLowerCase() !== source.sourcePdfSha256.toLowerCase()) {
    throw new Error("Ingredient line " + line.id + " is linked to a different immutable source PDF.");
  }
  for (const field of [line.ingredientName, line.supplierProductCode]) {
    if (field && field.evidence.sourceDocumentHash.toLowerCase() !== source.sourcePdfSha256.toLowerCase()) {
      throw new Error("Ingredient matching evidence for line " + line.id + " is linked to a different immutable source PDF.");
    }
  }
  const sourceName = line.ingredientName?.rawValue;
  const sourceCode = line.supplierProductCode?.rawValue;
  const nameKey = sourceName ? identityKey(sourceName) : undefined;
  const codeKey = sourceCode ? identityKey(sourceCode) : undefined;
  const sameSupplier = products.filter((product) => product.supplierId === source.supplierId);
  const candidates: ReferenceFormulationProductCandidate[] = [];

  for (const product of sameSupplier) {
    const matchedOn: ReferenceFormulationProductMatchOn[] = [];
    const matchedValues: string[] = [];
    if (codeKey && product.productCode && identityKey(product.productCode) === codeKey) {
      matchedOn.push("product_code");
      matchedValues.push(sourceCode!);
    }
    if (nameKey && identityKey(product.tradeName) === nameKey) {
      matchedOn.push("trade_name");
      matchedValues.push(sourceName!);
    }
    if (matchedOn.length) candidates.push({ commercialProductId: product.id, tier: "exact", matchedOn, matchedValues, sourceDocumentCodes: [...product.sourceDocumentCodes] });
  }
  const exact = uniqueCandidates(candidates);
  if (exact.length) return {
    ingredientLineId: line.id,
    sourceSupplierId: source.supplierId,
    resolution: exact.length === 1 ? "exact_match_candidate" : "ambiguous",
    candidates: exact,
    autoLinked: false,
    reviewRequired: true,
  };

  const aliasMatches: ReferenceFormulationProductCandidate[] = [];
  for (const product of sameSupplier) {
    for (const alias of product.aliases) {
      const aliasKey = identityKey(alias.value);
      const matchesCode = alias.kind === "product_code" && codeKey === aliasKey;
      const matchesName = alias.kind !== "product_code" && nameKey === aliasKey;
      if (!matchesCode && !matchesName) continue;
      aliasMatches.push({
        commercialProductId: product.id,
        tier: "controlled_alias",
        matchedOn: [matchesCode ? "product_code" : "alias"],
        matchedValues: [matchesCode ? sourceCode! : sourceName!],
        sourceDocumentCodes: [...new Set([...product.sourceDocumentCodes, ...(alias.sourceDocumentCode ? [alias.sourceDocumentCode] : [])])],
      });
    }
  }
  const aliases = uniqueCandidates(aliasMatches);
  if (aliases.length) return {
    ingredientLineId: line.id,
    sourceSupplierId: source.supplierId,
    resolution: aliases.length === 1 ? "alias_match_candidate" : "ambiguous",
    candidates: aliases,
    autoLinked: false,
    reviewRequired: true,
  };

  const fuzzy: ReferenceFormulationProductCandidate[] = [];
  if (nameKey && nameKey.length >= 4) {
    for (const product of sameSupplier) {
      const names = [
        { value: product.tradeName, isAlias: false, sourceDocumentCodes: product.sourceDocumentCodes },
        ...product.aliases.filter((alias) => alias.kind !== "product_code").map((alias) => ({
          value: alias.value, isAlias: true, sourceDocumentCodes: alias.sourceDocumentCode ? [alias.sourceDocumentCode] : [],
        })),
      ];
      const scores = names.map((name) => ({ ...name, score: similarity(nameKey, identityKey(name.value)) })).filter((item) => item.score >= 0.82);
      const best = scores.sort((left, right) => right.score - left.score)[0];
      if (best) fuzzy.push({
        commercialProductId: product.id, tier: "fuzzy_proposal", matchedOn: [best.isAlias ? "alias" : "trade_name"],
        matchedValues: [best.value], sourceDocumentCodes: [...new Set([...product.sourceDocumentCodes, ...best.sourceDocumentCodes])],
        similarity: Number(best.score.toFixed(4)),
      });
    }
  }
  const proposals = uniqueCandidates(fuzzy).sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0)).slice(0, 5);
  return {
    ingredientLineId: line.id,
    sourceSupplierId: source.supplierId,
    resolution: proposals.length ? "fuzzy_proposal" : "unmatched",
    candidates: proposals,
    autoLinked: false,
    reviewRequired: true,
  };
}

/** Match supplier formulation lines to the separate commercial-product registry; every result remains review-only. */
export function matchReferenceFormulationProducts(input: {
  source: ReferenceFormulationSource;
  lines: ReferenceFormulationIngredientLine[];
  products: CommercialProduct[];
}): ReferenceFormulationProductMatchingResult {
  const source = referenceFormulationSourceSchema.parse(input.source);
  const products = input.products.map((product) => commercialProductSchema.parse(product));
  if (new Set(products.map((product) => product.id)).size !== products.length) {
    throw new Error("Commercial product IDs must be unique within a matching catalog.");
  }
  const lines = input.lines.map((line) => resultForLine(line, source, products));
  const warnings = new Set<ReferenceFormulationProductMatchingResult["warnings"][number]>();
  if (lines.some((line) => line.resolution === "ambiguous")) warnings.add("ambiguous_product_candidates");
  if (lines.some((line) => line.resolution === "fuzzy_proposal")) warnings.add("fuzzy_matches_are_proposals_only");
  if (lines.some((line) => line.resolution === "unmatched")) warnings.add("unmatched_ingredient_lines");
  if (products.some((product) => product.supplierId !== source.supplierId)) warnings.add("supplier_products_excluded");
  return {
    sourceId: source.id,
    sourceDocumentHash: source.sourcePdfSha256,
    matcherVersion: REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION,
    lines,
    warnings: [...warnings],
    reviewRequired: true,
  };
}
