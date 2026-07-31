/**
 * A small, factual internal-method fixture set — two `LaboratoryStandard`
 * rows (`status: "internal"`) and their linked `LaboratoryTestMethod` rows,
 * covering `TEST-PH`/`TEST-VISCOSITY` from `catalog/testDefinitions.ts`.
 *
 * These are FormuLab-authored placeholder SOPs, never a claim of a real
 * ISO/ASTM/EN/DIN/AOAC/USP standard — no official standard's procedure,
 * limits, or text is reproduced or invented here. They exist only so the
 * Laboratory UI and its tests have deterministic per-test method fixtures
 * on first run; a chemist replaces or supplements them with the lab's real
 * standards. Seeded the same "only when the collection is still empty"
 * way `SEED_TEST_DEFINITIONS`/`SEED_COMPATIBILITY_RULES` already are — see
 * `lib/masterdata.ts`'s `listRecordsSeeded`.
 */
import type { LaboratoryStandard, LaboratoryTestMethod } from "../schemas/laboratoryStandards";

const NOW = "2026-01-01T00:00:00.000Z";

export const SEED_LABORATORY_STANDARDS: LaboratoryStandard[] = [
  {
    schemaVersion: "1.0",
    id: "labstd-seed-ph",
    standardCode: "FORMULAB-SOP-PH-01",
    title: "In-house pH determination procedure",
    issuingOrganization: "FormuLab (internal)",
    status: "internal",
    jurisdiction: [],
    applicableProductCategories: [],
    summary: "Placeholder in-house SOP for benchtop pH measurement. Replace or supplement with your lab's real, validated method.",
    knownLimitations: "Not a substitute for a validated, accredited method.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    schemaVersion: "1.0",
    id: "labstd-seed-viscosity",
    standardCode: "FORMULAB-SOP-VISC-01",
    title: "In-house viscosity determination procedure",
    issuingOrganization: "FormuLab (internal)",
    status: "internal",
    jurisdiction: [],
    applicableProductCategories: [],
    summary: "Placeholder in-house SOP for rotational viscometer readings. Replace or supplement with your lab's real, validated method.",
    knownLimitations: "Not a substitute for a validated, accredited method.",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const SEED_LABORATORY_TEST_METHODS: LaboratoryTestMethod[] = [
  {
    schemaVersion: "1.0",
    id: "labmethod-seed-ph",
    testDefinitionCode: "TEST-PH",
    standardId: "labstd-seed-ph",
    methodName: "Benchtop pH determination",
    methodVersion: "1.0",
    assignmentType: "primary",
    status: "active",
    requiredEquipment: ["calibrated pH meter", "temperature probe"],
    reagentsAndConsumables: ["pH 4/7/10 calibration buffers"],
    instrumentSettings: [],
    procedureSteps: ["Calibrate the pH meter against buffers.", "Bring sample to room temperature.", "Immerse probe and record stable reading."],
    safetyWarnings: [],
    relatedTestDefinitionCodes: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    schemaVersion: "1.0",
    id: "labmethod-seed-viscosity",
    testDefinitionCode: "TEST-VISCOSITY",
    standardId: "labstd-seed-viscosity",
    methodName: "Rotational viscometer reading",
    methodVersion: "1.0",
    assignmentType: "primary",
    status: "active",
    requiredEquipment: ["rotational viscometer"],
    reagentsAndConsumables: [],
    instrumentSettings: [{ parameter: "spindle", value: "per product viscosity range" }],
    procedureSteps: ["Equilibrate sample to specified temperature.", "Select spindle/speed per expected range.", "Record stable torque reading."],
    safetyWarnings: [],
    relatedTestDefinitionCodes: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
];
