// Phase 13 Session 4/4A — regenerates the shared JSON fixtures Rust's
// `role_policy.rs` reads via `include_str!` so it never hand-duplicates a
// permission matrix, a workflow-transition graph, or a masterdata
// collection->PolicyArea mapping of its own:
//
//   - rolePolicyMatrix.generated.json          <- rolePolicy.ts's fullMatrixSnapshot()
//   - formulaStatusTransitions.json            <- status.ts's ALLOWED_NEXT
//   - masterdataCollectionAreas.generated.json <- masterdataPolicyAreas.ts's MASTERDATA_COLLECTION_POLICY_AREAS
//
// All three files are checked into the repo (not generated at build/test
// time — same convention `roleVocabulary.json` already uses). Run this
// script after any change to `rolePolicy.ts`'s MATRIX, `status.ts`'s
// ALLOWED_NEXT, or `masterdataPolicyAreas.ts`'s mapping;
// `rolePolicy.matrixParity.test.ts` / `status.transitionParity.test.ts` /
// `masterdataPolicyAreas.parity.test.ts` fail loudly if a checked-in file
// and a fresh computation disagree, so a forgotten regeneration cannot
// silently drift.
//
// Usage: pnpm --filter @formulab/shared generate:role-policy-matrix
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CAPABILITIES, POLICY_AREAS, ROLES, fullMatrixSnapshot } from "../src/engine/rolePolicy";
import { ALLOWED_NEXT } from "../src/schemas/status";
import { FORMULA_STATUSES } from "../src/schemas/formulation";
import { MASTERDATA_COLLECTIONS, MASTERDATA_COLLECTION_POLICY_AREAS } from "../src/engine/masterdataPolicyAreas";

const matrixPath = fileURLToPath(new URL("../src/engine/rolePolicyMatrix.generated.json", import.meta.url));
const transitionsPath = fileURLToPath(new URL("../src/engine/formulaStatusTransitions.json", import.meta.url));
const masterdataAreasPath = fileURLToPath(
  new URL("../src/engine/masterdataCollectionAreas.generated.json", import.meta.url),
);

const matrixOut = {
  areas: [...POLICY_AREAS],
  roles: [...ROLES],
  capabilities: [...CAPABILITIES],
  matrix: fullMatrixSnapshot(),
};
writeFileSync(matrixPath, JSON.stringify(matrixOut, null, 2) + "\n", "utf-8");

const transitionsOut = {
  statuses: [...FORMULA_STATUSES],
  allowedNext: ALLOWED_NEXT,
};
writeFileSync(transitionsPath, JSON.stringify(transitionsOut, null, 2) + "\n", "utf-8");

const masterdataAreasOut = {
  collections: [...MASTERDATA_COLLECTIONS],
  areas: MASTERDATA_COLLECTION_POLICY_AREAS,
};
writeFileSync(masterdataAreasPath, JSON.stringify(masterdataAreasOut, null, 2) + "\n", "utf-8");

// eslint-disable-next-line no-console -- a one-off CLI script, not app code
console.log(`wrote ${matrixPath}\nwrote ${transitionsPath}\nwrote ${masterdataAreasPath}`);
