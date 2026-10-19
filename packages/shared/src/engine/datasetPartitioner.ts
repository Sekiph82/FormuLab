import { buildDatasetManifest, buildFormulaVersionBundleManifest, canonicalizeForFingerprint, sha256Hex, type FormulaVersionBundleInput } from "./datasetManifestBuilder";
import {
  DATASET_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSION,
  type SourceRecordReference,
} from "../schemas/dataset";
import {
  datasetPartitionManifestSchema,
  PARTITION_GROUPING_STRATEGY,
  PARTITION_SCHEMA_VERSION,
  PARTITION_STRATEGY,
  splitRatiosSchema,
  type DatasetPartitionManifest,
  type PartitionName,
  type SplitRatios,
} from "../schemas/datasetPartition";

export interface DatasetPartitionConfig {
  ratios: SplitRatios;
  seed: number;
}

export type DatasetPartitionErrorCode =
  | "invalid_config"
  | "invalid_bundle"
  | "ambiguous_lineage"
  | "insufficient_groups"
  | "schema_validation_failed";

export class DatasetPartitionError extends Error {
  readonly code: DatasetPartitionErrorCode;
  readonly formulaVersionId?: string;

  constructor(code: DatasetPartitionErrorCode, message: string, formulaVersionId?: string) {
    super(message);
    this.name = "DatasetPartitionError";
    this.code = code;
    this.formulaVersionId = formulaVersionId;
  }
}

interface PreparedBundle {
  input: FormulaVersionBundleInput;
  manifest: Awaited<ReturnType<typeof buildFormulaVersionBundleManifest>>;
  experimentalRecords: SourceRecordReference[];
}

interface MutableGroup {
  formulaIds: Set<string>;
  formulaVersionIds: Set<string>;
  sourceRecords: Map<string, SourceRecordReference>;
  members: PreparedBundle[];
  groupId?: string;
  partition?: PartitionName;
}

const PARTITION_NAMES: PartitionName[] = ["train", "validation", "test"];

/** Shared reference data informs predictors but is not itself a dependent experiment group. */
const NON_EXPERIMENT_ENTITIES = new Set([
  "rawMaterial",
  "productFamily",
  "processParameter",
  "formulationLine",
  "stabilityCondition",
  "stabilityTimePoint",
  "costSnapshot",
]);

/** Exact FVL-05 source entities whose records can encode dependent observations or their lineage.
 *
 * Every version of one `Formulation.id` is grouped, which keeps formula revisions and all linked
 * trial/retest, stability, DOE and corrective-action chains together. These source identities add
 * transitive closure when the same experiment is cited by more than one bundle. Embedded process
 * children use their true `(entity, parentRecordId, sourceRecordId)` identity; their parent trial is
 * also included as an exact `laboratoryTrial` identity. Catalog/reference inputs are excluded.
 */
const EXPERIMENT_ENTITIES = new Set([
  "formulation",
  "formulationVersion",
  "laboratoryTrial",
  "trialProcessStep",
  "trialObservation",
  "testResult",
  "stabilityStudy",
  "stabilitySample",
  "stabilityResult",
  "doeStudy",
  "doeDesign",
  "doeRun",
  "doeObservation",
  "correctiveAction",
]);

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lineageKey(ref: SourceRecordReference): string {
  return canonicalizeForFingerprint([ref.sourceEntity, ref.parentRecordId ?? null, ref.sourceRecordId]);
}

function rowsForBundle(input: FormulaVersionBundleInput): Array<{ sourceRecords: SourceRecordReference[] }> {
  return [
    input.compositionRow,
    input.processRow,
    input.testResultRow,
    input.stabilityRow,
    input.doeRow,
    input.correctiveCostContextRow,
    input.featureRow,
    input.targetRow,
  ].filter((row): row is NonNullable<typeof row> => row !== undefined);
}

function experimentalLineage(input: FormulaVersionBundleInput): SourceRecordReference[] {
  const unique = new Map<string, SourceRecordReference>();
  for (const row of rowsForBundle(input)) {
    for (const ref of row.sourceRecords) {
      if (NON_EXPERIMENT_ENTITIES.has(ref.sourceEntity)) continue;
      if (!EXPERIMENT_ENTITIES.has(ref.sourceEntity)) {
        throw new DatasetPartitionError(
          "ambiguous_lineage",
          `Cannot determine leakage semantics for source entity "${ref.sourceEntity}" in formula version "${input.compositionRow.formulaVersionId}".`,
          input.compositionRow.formulaVersionId,
        );
      }
      const requiresParent = ref.sourceEntity === "trialProcessStep" || ref.sourceEntity === "trialObservation";
      if (requiresParent !== (ref.parentRecordId !== undefined)) {
        throw new DatasetPartitionError(
          "ambiguous_lineage",
          `Source entity "${ref.sourceEntity}" has an invalid parent identity in formula version "${input.compositionRow.formulaVersionId}".`,
          input.compositionRow.formulaVersionId,
        );
      }
      unique.set(lineageKey(ref), ref);
      if (ref.parentRecordId !== undefined) {
        const parent: SourceRecordReference = { sourceEntity: "laboratoryTrial", sourceRecordId: ref.parentRecordId };
        unique.set(lineageKey(parent), parent);
      }
    }
  }
  return [...unique.values()].sort((a, b) => compareOrdinal(lineageKey(a), lineageKey(b)));
}

class DisjointSet {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(value: number): number {
    const parent = this.parent[value]!;
    if (parent !== value) this.parent[value] = this.find(parent);
    return this.parent[value]!;
  }

  union(left: number, right: number): void {
    let a = this.find(left);
    let b = this.find(right);
    if (a === b) return;
    if (this.rank[a]! < this.rank[b]!) [a, b] = [b, a];
    this.parent[b] = a;
    if (this.rank[a] === this.rank[b]) this.rank[a] = this.rank[a]! + 1;
  }
}

function createGroups(bundles: PreparedBundle[]): MutableGroup[] {
  const sets = new DisjointSet(bundles.length);
  const firstByIdentity = new Map<string, number>();
  bundles.forEach((bundle, index) => {
    const composition = bundle.input.compositionRow;
    const identities = [
      `formula:${composition.formulaId}`,
      ...bundle.experimentalRecords.map((ref) => `record:${lineageKey(ref)}`),
    ];
    for (const identity of identities) {
      const first = firstByIdentity.get(identity);
      if (first === undefined) firstByIdentity.set(identity, index);
      else sets.union(index, first);
    }
  });

  const byRoot = new Map<number, MutableGroup>();
  bundles.forEach((bundle, index) => {
    const root = sets.find(index);
    let group = byRoot.get(root);
    if (!group) {
      group = { formulaIds: new Set(), formulaVersionIds: new Set(), sourceRecords: new Map(), members: [] };
      byRoot.set(root, group);
    }
    group.formulaIds.add(bundle.input.compositionRow.formulaId);
    group.formulaVersionIds.add(bundle.input.compositionRow.formulaVersionId);
    bundle.experimentalRecords.forEach((ref) => group!.sourceRecords.set(lineageKey(ref), ref));
    group.members.push(bundle);
  });
  return [...byRoot.values()];
}

async function stableGroupId(group: MutableGroup): Promise<string> {
  const identity = {
    formulaIds: [...group.formulaIds].sort(compareOrdinal),
    formulaVersionIds: [...group.formulaVersionIds].sort(compareOrdinal),
    sourceRecords: [...group.sourceRecords.values()].sort((a, b) => compareOrdinal(lineageKey(a), lineageKey(b))),
  };
  return `sha256:${await sha256Hex(canonicalizeForFingerprint(identity))}`;
}

async function seededOrder(seed: number, groupId: string): Promise<string> {
  return sha256Hex(`${seed}\u0000${groupId}`);
}

function assignmentError(counts: Record<PartitionName, number>, total: number, ratios: SplitRatios): number {
  return PARTITION_NAMES.reduce((sum, name) => {
    const delta = counts[name] - total * ratios[name];
    return sum + delta * delta;
  }, 0);
}

/**
 * Partitions whole formula/experiment lineage groups. Formula id is the stable revision root from
 * the composition contract; experiment ids and exact parent scope close cross-bundle relationships.
 * The splitter reads only these identities plus bundle hashes; feature values and measured targets
 * never enter group formation or assignment.
 */
export async function partitionDataset(
  inputs: FormulaVersionBundleInput[],
  config: DatasetPartitionConfig,
): Promise<DatasetPartitionManifest> {
  const parsedRatios = splitRatiosSchema.safeParse(config?.ratios);
  if (!parsedRatios.success || !Number.isSafeInteger(config?.seed)) {
    throw new DatasetPartitionError("invalid_config", "Partition config requires ratios that sum to 1 and a safe integer seed.");
  }

  try {
    const prepared: PreparedBundle[] = [];
    for (const input of inputs) {
      const manifest = await buildFormulaVersionBundleManifest(input);
      prepared.push({ input, manifest, experimentalRecords: experimentalLineage(input) });
    }
    const dataset = await buildDatasetManifest(prepared.map(({ manifest }) => manifest));
    const groups = createGroups(prepared);
    groups.forEach((group) => { group.groupId = ""; });
    for (const group of groups) group.groupId = await stableGroupId(group);

    const activePartitions = PARTITION_NAMES.filter((name) => parsedRatios.data[name] > 0);
    if (groups.length < activePartitions.length) {
      throw new DatasetPartitionError(
        "insufficient_groups",
        `Cannot populate ${activePartitions.length} positive-ratio partitions from only ${groups.length} independent leakage group(s).`,
      );
    }

    const weighted = await Promise.all(groups.map(async (group) => ({
      group,
      weight: group.members.length,
      tie: await seededOrder(config.seed, group.groupId!),
    })));
    weighted.sort((a, b) => b.weight - a.weight || compareOrdinal(a.tie, b.tie) || compareOrdinal(a.group.groupId!, b.group.groupId!));

    const counts: Record<PartitionName, number> = { train: 0, validation: 0, test: 0 };
    const assignments: Record<PartitionName, number> = { train: 0, validation: 0, test: 0 };
    const total = prepared.length;
    const splitTie = async (groupId: string, name: PartitionName) => seededOrder(config.seed, `${groupId}:${name}`);

    for (let index = 0; index < weighted.length; index += 1) {
      const { group, weight } = weighted[index]!;
      const remainingGroups = weighted.length - index;
      const unfilled = activePartitions.filter((name) => assignments[name] === 0);
      const candidates = remainingGroups === unfilled.length ? unfilled : activePartitions;
      const scores = await Promise.all(candidates.map(async (name) => {
        const projected = { ...counts, [name]: counts[name] + weight };
        return { name, error: assignmentError(projected, total, parsedRatios.data), tie: await splitTie(group.groupId!, name) };
      }));
      scores.sort((a, b) => a.error - b.error || compareOrdinal(a.tie, b.tie));
      const selected = scores[0]!.name;
      group.partition = selected;
      counts[selected] += weight;
      assignments[selected] += 1;
    }

    groups.sort((a, b) => compareOrdinal(a.groupId!, b.groupId!));
    const groupRecords = groups.map((group) => ({
      groupId: group.groupId!,
      formulaIds: [...group.formulaIds].sort(compareOrdinal),
      formulaVersionIds: [...group.formulaVersionIds].sort(compareOrdinal),
      sourceRecords: [...group.sourceRecords.values()].sort((a, b) => compareOrdinal(lineageKey(a), lineageKey(b))),
      partition: group.partition!,
    }));
    const partitionByVersion = new Map<string, { groupId: string; partition: PartitionName; bundle: PreparedBundle["manifest"]["bundle"] }>();
    for (const group of groups) {
      for (const member of group.members) {
        partitionByVersion.set(member.manifest.formulaVersionId, {
          groupId: group.groupId!,
          partition: group.partition!,
          bundle: member.manifest.bundle,
        });
      }
    }
    const entries = dataset.entries.map((entry) => {
      const assignment = partitionByVersion.get(entry.formulaVersionId);
      if (!assignment || assignment.bundle.digest !== entry.bundle.digest) {
        throw new DatasetPartitionError("ambiguous_lineage", `Dataset entry "${entry.formulaVersionId}" does not resolve to its exact partition bundle.`, entry.formulaVersionId);
      }
      return {
        formulaVersionId: entry.formulaVersionId,
        bundle: entry.bundle,
        groupId: assignment.groupId,
        partition: assignment.partition,
      };
    });
    const result = {
      partitionSchemaVersion: PARTITION_SCHEMA_VERSION,
      datasetSchemaVersion: DATASET_SCHEMA_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      manifestSchemaVersion: dataset.manifestSchemaVersion,
      strategy: PARTITION_STRATEGY,
      groupingStrategy: PARTITION_GROUPING_STRATEGY,
      seed: config.seed,
      ratios: parsedRatios.data,
      dataset: dataset.dataset,
      groups: groupRecords,
      entries,
    };
    const parsed = datasetPartitionManifestSchema.safeParse(result);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      throw new DatasetPartitionError("schema_validation_failed", `Partition manifest failed schema validation: ${issues}`);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof DatasetPartitionError) throw error;
    throw new DatasetPartitionError("invalid_bundle", error instanceof Error ? error.message : String(error));
  }
}
