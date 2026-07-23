/**
 * The condition shape shared by the compatibility and safety rule engines.
 *
 * Both engines answer the same underlying question — "does some material (or
 * the target packaging) in this formula match a described profile?" — so they
 * share one condition schema and one matcher (`engine/ruleConditions.ts`)
 * rather than each growing a slightly different one.
 */
import { z } from "zod";
import { MATERIAL_FUNCTIONS } from "./primitives";
import { IONIC_CHARACTERS } from "./materials";
import { PRODUCT_DOMAINS } from "./product";

export const ruleConditionSchema = z.object({
  label: z.string().optional(),
  functionsAny: z.array(z.enum(MATERIAL_FUNCTIONS)).optional(),
  ionicCharactersAny: z.array(z.enum(IONIC_CHARACTERS)).optional(),
  materialCodesAny: z.array(z.string()).optional(),
  casNumbersAny: z.array(z.string()).optional(),
  /** Free-text keyword match against the line's display/trade name, for
   *  materials not yet in the library — matched case-insensitively. */
  nameKeywordsAny: z.array(z.string()).optional(),
  packagingComponentTypesAny: z.array(z.string()).optional(),
  productDomainsAny: z.array(z.enum(PRODUCT_DOMAINS)).optional(),
  /** Percentage window the MATCHING material's own line percent must fall in. */
  minConcentrationPercent: z.string().optional(),
  maxConcentrationPercent: z.string().optional(),
  /** pH window this condition is safe within. */
  phMin: z.string().optional(),
  phMax: z.string().optional(),
  /** Process temperature ceiling this condition is safe below, in °C. */
  maxTemperatureC: z.string().optional(),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
