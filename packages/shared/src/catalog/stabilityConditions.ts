/**
 * Seed structural storage conditions and time points (spec §11) —
 * configurable starting examples, never a claim that this set is what any
 * regulator or standard requires. A study picks whichever subset applies.
 */
import type { StabilityCondition, StabilityTimePoint } from "../schemas/stability";

export const SEED_STABILITY_CONDITIONS: StabilityCondition[] = [
  { schemaVersion: "1.0", id: "cond-4c", code: "4C", label: "4°C (refrigerated)", temperatureC: "4", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-25c", code: "25C", label: "25°C / long-term", temperatureC: "25", temperatureToleranceC: "2", humidityPercent: "60", humidityTolerancePercent: "5", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-30c", code: "30C", label: "30°C / intermediate", temperatureC: "30", temperatureToleranceC: "2", humidityPercent: "65", humidityTolerancePercent: "5", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-40c", code: "40C", label: "40°C / accelerated", temperatureC: "40", temperatureToleranceC: "2", humidityPercent: "75", humidityTolerancePercent: "5", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-45c", code: "45C", label: "45°C / accelerated-high", temperatureC: "45", temperatureToleranceC: "2", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-room", code: "ROOM", label: "Room temperature", verificationStatus: "not_verified", active: true, lightCondition: "ambient", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-freeze-thaw", code: "FREEZE_THAW", label: "Freeze-thaw cycling", freezeThawCycleDefinition: "24h at -10°C, 24h at 25°C, repeat — edit to match your protocol.", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-light", code: "LIGHT", label: "Light exposure", lightCondition: "uv", verificationStatus: "not_verified", active: true, orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "cond-custom", code: "CUSTOM", label: "Custom condition", customInstructions: "Edit this condition to describe your own storage requirement.", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
];

export const SEED_STABILITY_TIME_POINTS: StabilityTimePoint[] = [
  { schemaVersion: "1.0", id: "tp-initial", code: "INITIAL", label: "Initial", daysFromStart: 0, custom: false },
  { schemaVersion: "1.0", id: "tp-24h", code: "24H", label: "24 hours", daysFromStart: 1, custom: false },
  { schemaVersion: "1.0", id: "tp-1wk", code: "1WK", label: "1 week", daysFromStart: 7, custom: false },
  { schemaVersion: "1.0", id: "tp-2wk", code: "2WK", label: "2 weeks", daysFromStart: 14, custom: false },
  { schemaVersion: "1.0", id: "tp-1mo", code: "1MO", label: "1 month", daysFromStart: 30, custom: false },
  { schemaVersion: "1.0", id: "tp-2mo", code: "2MO", label: "2 months", daysFromStart: 60, custom: false },
  { schemaVersion: "1.0", id: "tp-3mo", code: "3MO", label: "3 months", daysFromStart: 90, custom: false },
  { schemaVersion: "1.0", id: "tp-6mo", code: "6MO", label: "6 months", daysFromStart: 180, custom: false },
  { schemaVersion: "1.0", id: "tp-12mo", code: "12MO", label: "12 months", daysFromStart: 365, custom: false },
];
