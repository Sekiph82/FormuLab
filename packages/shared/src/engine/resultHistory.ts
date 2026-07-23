/**
 * Result-history helpers shared by laboratory `TestResult` and
 * `StabilityResult` — spec closure for "test-result history browsing is
 * only inline and partial." Both types already carry the same revision
 * mechanism (`revisesResultId`, append-only, never mutated in place — see
 * docs/TEST_RESULTS.md); this module is what actually walks that chain
 * instead of a UI reading one prior/next link at a time.
 *
 * Every function here is defensive: a malformed chain (a missing parent, a
 * cycle, a duplicate id, an orphan retest, a dangling attachment
 * reference) returns an honest warning string instead of throwing or
 * silently guessing. Nothing here infers causation between two revisions
 * — `compareResultRevisions` reports facts, never a "why."
 */
import type { AttachmentReference } from "../schemas/testDefinitions";
import type { ReplicateStats, TestReplicate, TestResultOverride } from "../schemas/testDefinitions";

/** The fields both `TestResult` and `StabilityResult` already share —
 *  enough to walk a revision chain and compare two revisions, regardless
 *  of which concrete type is passed in. */
export interface HistoricalResult {
  id: string;
  revisesResultId?: string;
  retestOf?: string;
  attachments: AttachmentReference[];
  performedBy: string;
  performedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  passFail: "pass" | "fail" | "not_evaluated";
  replicates: TestReplicate[];
  stats?: ReplicateStats;
  override?: TestResultOverride;
  createdAt: string;
  updatedAt: string;
}

export interface ResultRevisionChain {
  /** Oldest first — `chain[chain.length - 1]` is the current effective
   *  revision (see `resolveEffectiveResultRevision`). */
  chain: HistoricalResult[];
  warnings: string[];
}

/**
 * Walk backward from `startId` via `revisesResultId` to find the root,
 * then return the full chain oldest-first. `results` may be any pool of
 * results (e.g. every result for one test definition on one trial); only
 * ids reachable from `startId` are included.
 */
export function buildResultRevisionChain(results: HistoricalResult[], startId: string): ResultRevisionChain {
  const warnings: string[] = [];
  const byId = new Map<string, HistoricalResult>();
  for (const r of results) {
    if (byId.has(r.id)) {
      warnings.push(`Duplicate revision id "${r.id}" in input — the first occurrence was kept, later ones ignored.`);
      continue;
    }
    byId.set(r.id, r);
  }

  const start = byId.get(startId);
  if (!start) {
    return { chain: [], warnings: [`Result "${startId}" was not found in the provided set.`] };
  }

  // Walk backward to the root, guarding against a cycle.
  const backward: HistoricalResult[] = [start];
  const visited = new Set([startId]);
  let current = start;
  while (current.revisesResultId) {
    const parent = byId.get(current.revisesResultId);
    if (!parent) {
      warnings.push(`Result "${current.id}" revises "${current.revisesResultId}", which was not found — treating "${current.id}" as the root shown.`);
      break;
    }
    if (visited.has(parent.id)) {
      warnings.push(`Circular revision reference detected at "${parent.id}" — stopped walking further back.`);
      break;
    }
    backward.push(parent);
    visited.add(parent.id);
    current = parent;
  }
  const root = backward[backward.length - 1];

  // Walk forward from the root, collecting every result that (transitively)
  // revises it, oldest first. Guards the same duplicate/cycle cases.
  const chain: HistoricalResult[] = [root];
  const chainIds = new Set([root.id]);
  let frontier = root.id;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = [...byId.values()].find((r) => r.revisesResultId === frontier && !chainIds.has(r.id));
    if (!next) break;
    if (chainIds.has(next.id)) {
      warnings.push(`Circular revision reference detected at "${next.id}" — stopped walking forward.`);
      break;
    }
    chain.push(next);
    chainIds.add(next.id);
    frontier = next.id;
  }

  return { chain, warnings };
}

/** The tip of a chain — nothing else in it revises this one. `undefined`
 *  only when the chain itself is empty (e.g. the starting id was not
 *  found). */
export function resolveEffectiveResultRevision(chain: HistoricalResult[]): HistoricalResult | undefined {
  return chain[chain.length - 1];
}

export interface RetestLineage {
  /** The retested-from result's id, or the result's own id when it has no
   *  `retestOf` (it is its own lineage root). */
  rootId: string;
  results: HistoricalResult[];
}

/**
 * Group results by retest lineage (`retestOf`), distinct from the
 * revision chain (`revisesResultId`) — a retest is a fresh sample, not a
 * correction of the same measurement. An orphan retest (`retestOf` points
 * at an id absent from `results`) becomes its own single-result lineage,
 * with a warning rather than being silently dropped.
 */
export function groupRetestLineage(results: HistoricalResult[]): { groups: RetestLineage[]; warnings: string[] } {
  const warnings: string[] = [];
  const byId = new Map(results.map((r) => [r.id, r]));
  const groupsByRoot = new Map<string, HistoricalResult[]>();

  for (const r of results) {
    let rootId = r.id;
    if (r.retestOf) {
      if (byId.has(r.retestOf)) {
        rootId = r.retestOf;
      } else {
        warnings.push(`Result "${r.id}" is a retest of "${r.retestOf}", which was not found — showing it as its own lineage.`);
      }
    }
    // A result that is itself retested-from becomes the group's root even
    // when it appears after its retest in the input order.
    const existing = groupsByRoot.get(rootId) ?? [];
    existing.push(r);
    groupsByRoot.set(rootId, existing);
  }

  const groups = [...groupsByRoot.entries()].map(([rootId, group]) => ({ rootId, results: group }));
  return { groups, warnings };
}

export interface ResultRevisionComparison {
  mean?: { a?: string; b?: string };
  minimum?: { a?: string; b?: string };
  maximum?: { a?: string; b?: string };
  standardDeviation?: { a?: string; b?: string };
  coefficientOfVariationPercent?: { a?: string; b?: string };
  passFail: { a: string; b: string; changed: boolean };
  reviewedBy: { a?: string; b?: string; changed: boolean };
  overrideReason: { a?: string; b?: string; changed: boolean };
  attachmentsAdded: AttachmentReference[];
  attachmentsRemoved: AttachmentReference[];
}

/** Deterministic, factual diff of two result revisions — never infers why
 *  a value changed, only that it did. */
export function compareResultRevisions(a: HistoricalResult, b: HistoricalResult): ResultRevisionComparison {
  const field = (x?: string, y?: string) => (x === y ? undefined : { a: x, b: y });
  const aAttachmentIds = new Set(a.attachments.map((att) => att.id));
  const bAttachmentIds = new Set(b.attachments.map((att) => att.id));

  return {
    mean: field(a.stats?.mean, b.stats?.mean),
    minimum: field(a.stats?.minimum, b.stats?.minimum),
    maximum: field(a.stats?.maximum, b.stats?.maximum),
    standardDeviation: field(a.stats?.standardDeviation, b.stats?.standardDeviation),
    coefficientOfVariationPercent: field(a.stats?.coefficientOfVariationPercent, b.stats?.coefficientOfVariationPercent),
    passFail: { a: a.passFail, b: b.passFail, changed: a.passFail !== b.passFail },
    reviewedBy: { a: a.reviewedBy, b: b.reviewedBy, changed: a.reviewedBy !== b.reviewedBy },
    overrideReason: { a: a.override?.reason, b: b.override?.reason, changed: a.override?.reason !== b.override?.reason },
    attachmentsAdded: b.attachments.filter((att) => !aAttachmentIds.has(att.id)),
    attachmentsRemoved: a.attachments.filter((att) => !bAttachmentIds.has(att.id)),
  };
}

export interface AttachmentReplacementChain {
  /** Oldest first — the original attachment through every replacement. */
  chain: AttachmentReference[];
}

/**
 * Group a flat pool of attachments (e.g. every attachment across a whole
 * revision chain) into replacement chains via `replacesAttachmentId`. A
 * dangling reference (points at an attachment id absent from the pool)
 * still starts its own chain from that attachment — it is not dropped —
 * with a warning explaining why its predecessor could not be shown.
 */
export function resolveAttachmentReplacementChain(attachments: AttachmentReference[]): { chains: AttachmentReplacementChain[]; warnings: string[] } {
  const warnings: string[] = [];
  const byId = new Map(attachments.map((a) => [a.id, a]));
  const supersededBy = new Map<string, string>(); // old id -> new id
  for (const a of attachments) {
    if (a.replacesAttachmentId) {
      if (!byId.has(a.replacesAttachmentId)) {
        warnings.push(`Attachment "${a.id}" replaces "${a.replacesAttachmentId}", which was not found in this set.`);
      } else {
        supersededBy.set(a.replacesAttachmentId, a.id);
      }
    }
  }

  const chains: AttachmentReplacementChain[] = [];
  const visitedGlobally = new Set<string>();

  const buildFrom = (root: AttachmentReference): AttachmentReplacementChain => {
    const chain: AttachmentReference[] = [root];
    const visited = new Set([root.id]);
    let current = root.id;
    while (supersededBy.has(current)) {
      const nextId = supersededBy.get(current)!;
      if (visited.has(nextId)) {
        warnings.push(`Circular attachment-replacement reference detected at "${nextId}".`);
        break;
      }
      const next = byId.get(nextId);
      if (!next) break;
      chain.push(next);
      visited.add(nextId);
      current = nextId;
    }
    for (const c of chain) visitedGlobally.add(c.id);
    return { chain };
  };

  const roots = attachments.filter((a) => !a.replacesAttachmentId || !byId.has(a.replacesAttachmentId));
  for (const root of roots) chains.push(buildFrom(root));

  // Anything still unvisited belongs to a pure cycle with no natural root
  // (every member replaces another) — pick one representative per
  // remaining component so it is still surfaced rather than silently
  // dropped, and the cycle still gets its warning.
  for (const a of attachments) {
    if (!visitedGlobally.has(a.id)) chains.push(buildFrom(a));
  }

  return { chains, warnings };
}
