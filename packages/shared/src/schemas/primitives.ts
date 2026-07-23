/**
 * Leaf-level primitives shared across schema modules that would otherwise
 * form an import cycle (formulation.ts <-> regulatory.ts <-> ruleConditions/
 * compatibility/testDefinitions.ts). This module imports nothing but zod,
 * so anything can depend on it without risk of a circular initialization
 * order.
 */
import { z } from "zod";

/** A decimal number as an exact string, e.g. "12.5000". */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a plain decimal string");

/** Functional roles a material can play. Constraints are expressed over these. */
export const MATERIAL_FUNCTIONS = [
  "anionic_surfactant",
  "nonionic_surfactant",
  "amphoteric_surfactant",
  "cationic_surfactant",
  "builder",
  "chelating_agent",
  "preservative",
  "fragrance",
  "colorant",
  "enzyme",
  "bleaching_agent",
  "oxygen_donor",
  "abrasive",
  "humectant",
  "emollient",
  "conditioning_agent",
  "rheology_modifier",
  "ph_adjuster",
  "solvent",
  "disinfectant_active",
  "qac_active",
  "chlorhexidine_active",
  "fluoride_active",
  "antioxidant",
  "anti_redeposition_agent",
  "optical_brightener",
  "foam_controller",
  "opacifier",
  "filler",
  "water",
] as const;
export type MaterialFunction = (typeof MATERIAL_FUNCTIONS)[number];
