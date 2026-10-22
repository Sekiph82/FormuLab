STATUS: READY

Implemented a deterministic integration acceptance fixture that trains an accepted model from 60 completed synthetic lab-linked records, ranks DOE candidates from measured-space acquisition, records a human-attributed accepted recommendation and linked planned/completed synthetic trial, then retrains an immutable version-2 model from the expanded 61-record dataset. The test labels all fixtures as synthetic and asserts exact run/trial/measurement and prior-model lineage. It writes only to mocked in-memory stores.

The existing `DoePanel` integration suite also verifies the real UI path creates a planned LaboratoryTrial only through the accepted recommendation flow and blocks generic Runs/retry bypasses. Fixed the FVL-11.002 fixture type declaration exposed by desktop TypeScript validation; runtime assertions are unchanged.

Validation:
- `pnpm --filter @formulab/desktop exec vitest run src/lib/FVL11.fullChainAcceptance.test.ts src/lib/FVL11.fullChainRun2.test.ts src/components/formula/DoePanel.test.tsx src/lib/doeModelRetraining.test.ts` — 4 files, 18 tests passed.
- `pnpm --filter @formulab/desktop typecheck` — passed.
- `pnpm codex:tasks:check` — passed at 166/178, current FVL-11.003.
- `git diff --check` — passed.

No real literature, physical measurements, laboratory execution, or scientific performance is claimed.
