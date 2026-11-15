import taxonomy from "./productFamilies.json";

export const PRODUCT_FAMILY_TAXONOMY_VERSION = taxonomy.version;

export interface ProductFamilyMatch {
  /** Family key ("shampoo"), or a group key ("hair_care") when only the group is known. */
  key: string;
  label: string;
  group: string;
  level: "family" | "group";
  method: "title_keyword" | "source_category";
  /** The text the match was made on, kept as evidence. */
  matchedText: string;
  alias: string;
}

function aliasPattern(alias: string): RegExp {
  const stem = alias.endsWith("*");
  const body = (stem ? alias.slice(0, -1) : alias).replace(/-/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${body}${stem ? "" : "(?![a-z0-9])"}`, "i");
}

const FAMILIES = taxonomy.families.map((family) => ({ ...family, patterns: family.aliases.map((alias) => [alias, aliasPattern(alias)] as const) }));
const GROUPS = taxonomy.groups.map((group) => ({ ...group, patterns: group.aliases.map((alias) => [alias, aliasPattern(alias)] as const) }));
const GROUP_LABEL = new Map(taxonomy.groups.map((group) => [group.key, group.label]));

/** "Anti_dandruff_Shampoo_EN_FORM_GEN_504249" -> "anti dandruff shampoo en form gen 504249" */
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function familyIn(text: string, method: ProductFamilyMatch["method"]): ProductFamilyMatch | undefined {
  const normalized = normalize(text);
  for (const family of FAMILIES) {
    const hit = family.patterns.find(([, pattern]) => pattern.test(normalized));
    if (hit) return { key: family.key, label: family.label, group: family.group, level: "family", method, matchedText: text, alias: hit[0] };
  }
  return undefined;
}

function groupIn(text: string): ProductFamilyMatch | undefined {
  const normalized = normalize(text);
  for (const group of GROUPS) {
    const hit = group.patterns.find(([, pattern]) => pattern.test(normalized));
    if (hit) return { key: group.key, label: group.label, group: group.key, level: "group", method: "source_category", matchedText: text, alias: hit[0] };
  }
  return undefined;
}

/**
 * Product family of a supplier formulation: the title decides when it names a
 * product; otherwise a specific source category (e.g. "Automatic Dishwash"),
 * otherwise the broad category group. Undefined when nothing matches; a family
 * is never guessed.
 */
export function classifyProductFamily(input: { title?: string; headings?: string[]; sourceCategories?: string[] }): ProductFamilyMatch | undefined {
  const fromTitle = input.title ? familyIn(input.title, "title_keyword") : undefined;
  if (fromTitle) return fromTitle;
  for (const heading of input.headings ?? []) {
    const fromHeading = familyIn(heading, "title_keyword");
    if (fromHeading) return fromHeading;
  }
  for (const category of input.sourceCategories ?? []) {
    const fromCategory = familyIn(category, "source_category");
    if (fromCategory) return fromCategory;
  }
  for (const category of input.sourceCategories ?? []) {
    const group = groupIn(category);
    if (group) return group;
  }
  return undefined;
}

/** Family of what a user typed in the New Request product-type field. */
export function productFamilyForRequest(text: string): ProductFamilyMatch | undefined {
  return familyIn(text, "title_keyword") ?? (groupIn(text) && { ...groupIn(text)!, method: "title_keyword" });
}

export function productFamilyGroupLabel(groupKey: string): string | undefined {
  return GROUP_LABEL.get(groupKey);
}
