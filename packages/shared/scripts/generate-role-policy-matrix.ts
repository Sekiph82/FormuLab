// Phase 13 Session 4 — regenerates the two shared JSON fixtures Rust's
// `role_policy.rs` reads via `include_str!` so it never hand-duplicates a
// permission matrix or a workflow-transition graph of its own:
//
//   - rolePolicyMatrix.generated.json  <- rolePolicy.ts's fullMatrixSnapshot()
//   - formulaStatusTransitions.json    <- status.ts's ALLOWED_NEXT
//
// Both files are checked into the repo (not generated at build/test time —
// same convention `roleVocabulary.json` already uses). Run this script after
// any change to `rolePolicy.ts`'s MATRIX or `status.ts`'s ALLOWED_NEXT;
// `rolePolicy.matrixParity.test.ts` / `status.transitionParity.test.ts`
// fail loudly if the checked-in file and a fresh computation disagree, so a
// forgotten regeneration cannot silently drift.
//
// Usage: pnpm --filter @formulab/shared generate:role-policy-matrix
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CAPABILITIES, POLICY_AREAS, ROLES, fullMatrixSnapshot } from "../src/engine/rolePolicy";
import { ALLOWED_NEXT } from "../src/schemas/status";
import { FORMULA_STATUSES } from "../src/schemas/formulation";

const matrixPath = fileURLToPath(new URL("../src/engine/rolePolicyMatrix.generated.json", import.meta.url));
const transitionsPath = fileURLToPath(new URL("../src/engine/formulaStatusTransitions.json", import.meta.url));

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

// eslint-disable-next-line no-console -- a one-off CLI script, not app code
console.log(`wrote ${matrixPath}\nwrote ${transitionsPath}`);
