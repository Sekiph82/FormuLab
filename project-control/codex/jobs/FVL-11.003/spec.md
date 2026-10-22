# FVL-11.003 acceptance specification

## Goal

Exercise the existing FormuLab workflow from a generated candidate through laboratory records, dataset eligibility, predictive-model training, active-learning selection, and retraining lineage.

## Acceptance criteria

- The acceptance run is deterministic, local, isolated, and uses clearly labeled synthetic fixtures only; it makes no literature, physical laboratory, product safety, or real-world model-performance claim.
- The candidate retains exact formulation-version and source-session lineage through laboratory and model records.
- Laboratory execution, result recording, verification, and approvals use the existing role and human-gate rules. Synthetic test identities are confined to test fixtures; no system actor is represented as a real approver.
- Dataset creation preserves unknowns, records its schema/fingerprint, and enforces eligibility and grouped train/validation/test isolation before model training.
- Accepted/rejected model outcomes are asserted truthfully, with the exact training lineage, metrics, and applicability limits preserved.
- Active-learning selection is deterministic and uses only eligible candidates; retraining records link back to the triggering study/design/run/trial or result without implying scientific validity.
- No task writes to user workspaces, `.FormuLab/runs.db`, live workspaces, or external services; temporary fixtures are removed at test end.
- Targeted acceptance tests, `pnpm codex:tasks:check`, and `git diff --check` pass. Full-project regression remains reserved for FVL-11.009.

## Scope boundaries

Do not weaken authorization, measurement provenance, human approval, eligibility thresholds, or data-integrity checks to force a green model result. If a real owner/laboratory decision or unavailable native evidence is required, document it and continue any independent READY queue item.
