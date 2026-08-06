/**
 * Ingredient declarations.
 *
 * What this does: order the ingredients a formula actually contains, using the
 * INCI names a human entered, and render them as a DRAFT list.
 *
 * What this deliberately does not do: claim label compliance. FormuLab has no
 * verified Kenyan or EAC labelling ruleset, so the output is marked draft, and
 * a missing INCI name is surfaced as a warning rather than filled in from model
 * memory. Inventing an INCI name would produce a label that looks authoritative
 * and is wrong — the worst possible failure mode for this feature.
 */
import Decimal from "decimal.js";
import { resolvedPercent, toDecimalString } from "./formula";
import type { FormulationLine } from "../schemas/formulation";

export interface DeclarationEntry {
  lineId: string;
  /** The name that will print. */
  name: string;
  /** Resolved percentage, for ordering and for the internal view only. */
  percent: string;
  /** True when no INCI name exists and the trade/display name was used. */
  usesFallbackName: boolean;
  /** True when the entry falls in the unordered ≤1% tail. */
  belowThreshold: boolean;
}

export interface Declaration {
  /** Always "draft": nothing here has been checked against a legal ruleset. */
  status: "draft";
  entries: DeclarationEntry[];
  /** The printable string, e.g. "Aqua, Sodium Laureth Sulfate, …". */
  text: string;
  /** Lines with no INCI name — each is a validation warning too. */
  missingInciLineIds: string[];
  /** Set when a human edited the generated list. */
  override?: DeclarationOverride;
  notes: string[];
}

export interface DeclarationOverride {
  text: string;
  editedBy: string;
  editedAt: string;
  reason: string;
}

export interface DeclarationOptions {
  /**
   * Below this percentage, ingredients may be listed in any order in most
   * regimes. Configurable because the threshold is a regulatory input, not a
   * chemical fact — the default is the widely used 1%.
   */
  unorderedBelowPercent?: string;
  /** Keep the ≤threshold tail in descending order instead of alphabetical. */
  tailOrder?: "descending" | "alphabetical";
  /** Personal care uses INCI; household products get the generic view. */
  style?: "inci" | "generic";
  override?: DeclarationOverride;
}

/**
 * Build the declaration.
 *
 * Ordering is descending by percentage, and ties break alphabetically by name
 * so that regenerating the declaration from the same formula always produces
 * byte-identical output. A list that reshuffles between runs cannot be diffed,
 * and artwork approval depends on diffing it.
 */
export function buildDeclaration(
  lines: FormulationLine[],
  opts: DeclarationOptions = {},
): Declaration {
  const style = opts.style ?? "inci";
  const threshold = new Decimal(opts.unorderedBelowPercent ?? "1");

  const entries: DeclarationEntry[] = lines
    .filter((l) => resolvedPercent(l, lines).greaterThan(0))
    .map((l) => {
      const pct = resolvedPercent(l, lines);
      const inci = l.inciName?.trim();
      return {
        lineId: l.id,
        name: style === "inci" && inci ? inci : l.displayName.trim(),
        percent: toDecimalString(pct),
        usesFallbackName: style === "inci" && !inci,
        belowThreshold: pct.lessThanOrEqualTo(threshold),
      };
    });

  const byPercentThenName = (a: DeclarationEntry, b: DeclarationEntry) => {
    const c = new Decimal(b.percent).comparedTo(new Decimal(a.percent));
    return c !== 0 ? c : a.name.localeCompare(b.name);
  };

  const above = entries.filter((e) => !e.belowThreshold).sort(byPercentThenName);
  const tail = entries.filter((e) => e.belowThreshold);
  tail.sort(
    opts.tailOrder === "alphabetical"
      ? (a, b) => a.name.localeCompare(b.name)
      : byPercentThenName,
  );

  const ordered = [...above, ...tail];
  const notes: string[] = [
    "Draft declaration. Not checked against any Kenyan or EAC labelling requirement.",
  ];
  if (style === "generic") {
    notes.push(
      "Generic component list for a household or industrial product. Not an INCI declaration.",
    );
  }

  const missing = ordered.filter((e) => e.usesFallbackName);
  if (missing.length > 0) {
    notes.push(
      `${missing.length} ingredient(s) have no INCI name; the internal material name was used instead.`,
    );
  }

  return {
    status: "draft",
    entries: ordered,
    text: opts.override?.text ?? ordered.map((e) => e.name).join(", "),
    missingInciLineIds: missing.map((e) => e.lineId),
    override: opts.override,
    notes: opts.override
      ? [...notes, `Manually overridden by ${opts.override.editedBy}: ${opts.override.reason}`]
      : notes,
  };
}
