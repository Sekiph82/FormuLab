import { z } from "zod";
import { DATASET_SCHEMA_VERSION, FEATURE_SCHEMA_VERSION, nonBlankString, sourceRecordReferenceSchema } from "./dataset";
import { digestSchema, MANIFEST_SCHEMA_VERSION } from "./datasetManifest";

/** Independent version for the persisted train/validation/test assignment contract. */
export const PARTITION_SCHEMA_VERSION = "1.0" as const;
export const PARTITION_STRATEGY = "grouped_greedy_hash" as const;
export const PARTITION_GROUPING_STRATEGY = "formulaId+experimental-lineage-closure-v1" as const;

export const partitionNameSchema = z.enum(["train", "validation", "test"]);
export type PartitionName = z.infer<typeof partitionNameSchema>;

export const splitRatiosSchema = z.object({
  train: z.number().min(0).max(1),
  validation: z.number().min(0).max(1),
  test: z.number().min(0).max(1),
}).superRefine((ratios, ctx) => {
  const sum = ratios.train + ratios.validation + ratios.test;
  if (Math.abs(sum - 1) > 1e-12) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "split ratios must sum to 1" });
  }
});
export type SplitRatios = z.infer<typeof splitRatiosSchema>;

export const partitionGroupSchema = z.object({
  groupId: nonBlankString("groupId"),
  formulaIds: z.array(nonBlankString("formulaId")).min(1),
  formulaVersionIds: z.array(nonBlankString("formulaVersionId")).min(1),
  sourceRecords: z.array(sourceRecordReferenceSchema),
  partition: partitionNameSchema,
});
export type PartitionGroup = z.infer<typeof partitionGroupSchema>;

export const datasetPartitionEntrySchema = z.object({
  formulaVersionId: nonBlankString("formulaVersionId"),
  bundle: digestSchema,
  groupId: nonBlankString("groupId"),
  partition: partitionNameSchema,
});
export type DatasetPartitionEntry = z.infer<typeof datasetPartitionEntrySchema>;

export const datasetPartitionManifestSchema = z.object({
  partitionSchemaVersion: z.literal(PARTITION_SCHEMA_VERSION),
  datasetSchemaVersion: z.literal(DATASET_SCHEMA_VERSION),
  featureSchemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
  manifestSchemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  strategy: z.literal(PARTITION_STRATEGY),
  groupingStrategy: z.literal(PARTITION_GROUPING_STRATEGY),
  seed: z.number().int().safe(),
  ratios: splitRatiosSchema,
  dataset: digestSchema,
  groups: z.array(partitionGroupSchema),
  entries: z.array(datasetPartitionEntrySchema),
});
export type DatasetPartitionManifest = z.infer<typeof datasetPartitionManifestSchema>;
