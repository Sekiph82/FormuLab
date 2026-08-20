/**
 * FVL-04.024 (hardened) — Connector -> Existing Data Exchange Bridge.
 *
 * Session 9 proved the chain works by manually chaining connector ->
 * discovery -> mapping -> preview -> commit inside tests. That is not a
 * production bridge — nothing outside a test ever called that sequence
 * as one real operation. This module is the ONE real orchestration
 * surface: `prepareConnectorImport()`/`confirmConnectorImport()`
 * (`apps/desktop/src/lib/connectorImportBridge.ts`, desktop-only since
 * commit/persistence are Tauri-backed) call into this shared module for
 * the parts that are genuinely pure — multi-template dependency
 * ordering and cycle detection — never a second copy of that logic.
 *
 * This module owns NO write, NO connector I/O, NO mapping semantics —
 * those all stay exactly where they already are (`fileConnector.ts`/
 * `databaseConnector.ts`/`restApiConnector.ts`, `mappingProfile.ts`,
 * `dataExchangeValidation.ts`, `dataExchangeCommit.ts`). It only answers
 * one question: "given a set of target Data Exchange templates in one
 * migration batch, what order must they commit in, and is there a
 * cycle."
 */
import { getDataExchangeTemplate } from "./dataExchangeRegistry";

export interface ImportDependencyPlan {
  /** Topological commit order — a template earlier in this array has no
   *  dependency on any template later in it. */
  order: string[];
}

export interface ImportDependencyCycle {
  /** The exact cycle found, e.g. `["a", "b", "a"]`. */
  cycle: string[];
}

/**
 * Builds a dependency graph FROM THE REGISTRY ITSELF — a template A
 * depends on template B when any of A's own columns has
 * `referenceTemplate: B` (and `B !== A`; a self-reference like
 * `artwork_register.supersedes_artwork_code` is not an ordering
 * dependency between DIFFERENT templates in one batch). Never a
 * hardcoded table of "Supplier before MaterialPrice" — those pairs are
 * true only because the registry's own columns say so, and the graph
 * must stay correct automatically as the registry grows.
 */
function dependenciesOf(templateCode: string): Set<string> {
  const template = getDataExchangeTemplate(templateCode);
  const deps = new Set<string>();
  if (!template) return deps;
  for (const column of template.columns) {
    if (column.dataType === "code_reference" && column.referenceTemplate && column.referenceTemplate !== templateCode) {
      deps.add(column.referenceTemplate);
    }
  }
  return deps;
}

/**
 * Topologically orders `templateCodes` (a Kahn's-algorithm sort, so the
 * result is deterministic for a given input order, not merely "any
 * valid order"). A dependency on a template NOT in `templateCodes` is
 * ignored — that target's own data is assumed to already exist
 * canonically (exactly the same assumption Data Exchange's own
 * reference resolution already makes at preview time); this function
 * only orders templates that are ACTUALLY part of this batch.
 *
 * Returns `{cycle}` instead of `{order}` when the templates in this
 * batch reference each other circularly — a real, if unusual, registry
 * shape (e.g. two templates each optionally referencing the other) that
 * must block before any write, never silently commit in an arbitrary
 * order.
 */
export function planImportOrder(templateCodes: string[]): ImportDependencyPlan | ImportDependencyCycle {
  const set = new Set(templateCodes);
  const deps = new Map<string, Set<string>>();
  for (const t of set) deps.set(t, new Set([...dependenciesOf(t)].filter((d) => set.has(d))));
  return planImportOrderFromDependencies(templateCodes, deps);
}

/**
 * The pure Kahn's-algorithm core, separated from registry I/O so the
 * cycle-detection path itself can be exercised directly with a
 * synthetic dependency graph — the real registry may never happen to
 * contain a genuine cycle, which would otherwise leave that path
 * unproven. `deps.get(t)` is `t`'s own dependency set (templates that
 * must commit BEFORE `t`).
 */
export function planImportOrderFromDependencies(templateCodes: string[], deps: Map<string, Set<string>>): ImportDependencyPlan | ImportDependencyCycle {
  const set = new Set(templateCodes);
  // A "depends on" edge d -> t (d must commit before t) contributes one
  // to t's in-degree per dependency.
  const inDegree = new Map<string, number>();
  for (const t of set) inDegree.set(t, deps.get(t)!.size);

  // Deterministic: templates in their ORIGINAL input order are queued
  // first among equally-ready candidates, not object/Set iteration
  // order (which happens to be insertion order in V8 but shouldn't be
  // relied on implicitly).
  const ready = templateCodes.filter((t) => (inDegree.get(t) ?? 0) === 0);
  const order: string[] = [];
  const remaining = new Map(inDegree);

  while (ready.length > 0) {
    const next = ready.shift()!;
    if (order.includes(next)) continue;
    order.push(next);
    for (const t of set) {
      if (deps.get(t)!.has(next)) {
        const left = (remaining.get(t) ?? 0) - 1;
        remaining.set(t, left);
        if (left === 0 && !order.includes(t) && !ready.includes(t)) ready.push(t);
      }
    }
  }

  if (order.length !== set.size) {
    // Whatever never reached in-degree 0 is part of (or downstream of) a
    // cycle — report the unresolved set directly rather than a partial,
    // misleading "order".
    const stuck = [...set].filter((t) => !order.includes(t));
    return { cycle: stuck };
  }
  return { order };
}
