# CONTROL-HUB GPT AUDIT 000003

Date: 2026-08-27
Scope: Correct the Control Hub architecture so it conforms to FormuLab's existing H!veAI `source-map` manifest contract.

## Finding

The initial Control Hub design incorrectly elevated `project-control/state/project-state.json` and session files toward H!veAI task/status authority. This conflicts with the existing H!veAI manifest model, where `.hiveai/PROJECT_DASHBOARD.md` is pointer-only and the declared canonical task source is authoritative.

The local H!veAI screenshots showed the practical consequence: the active FormuLab checkout did not contain `.hiveai/PROJECT_DASHBOARD.md`, so H!veAI entered `LEGACY_FALLBACK`, reported `MANIFEST ABSENT`, and could not resolve canonical task authority.

## Corrected architecture

- `.hiveai/PROJECT_DASHBOARD.md` is the H!veAI project manifest/source map.
- `docs/FORMULAB_V1_TASK_TRACKER.md` is the canonical FormuLab task ledger.
- `project-control/` is GPT↔Claude communication/evidence history only.
- `project-control/state/**` and `project-control/sessions/**` are optional coordination metadata, not H!veAI task authority.
- GPT audits/prompts and Claude logs/handoffs may be surfaced as progress/history/evidence sources only when declared by the manifest.
- The manifest must exist on the active local development branch so H!veAI's local watcher can discover it.

## Repository correction already applied

- Restored a pointer-only FormuLab `.hiveai/PROJECT_DASHBOARD.md` on `main`.
- Added the same canonical manifest to `feature/laboratory-stability` so the local active checkout exposes it to H!veAI.
- Reframed `project-control/README.md`, `PROTOCOL.md`, and `dashboard/HIVEAI-INTEGRATION.md` as evidence/communication documentation only.
- Demoted `project-control/state/project-state.json` to coordination metadata.

## Supersession

`CONTROL-HUB-GPT-PROMPT-000001.md` and `CONTROL-HUB-GPT-PROMPT-000002.md` are superseded for migration execution.

Use `CONTROL-HUB-GPT-PROMPT-000003.md` only.

## Verdict

ARCHITECTURE CORRECTED / MIGRATION MAY CONTINUE UNDER PROMPT 000003.

FVL-05.010 remains forbidden until FVL-05.009 is independently audited and accepted.
