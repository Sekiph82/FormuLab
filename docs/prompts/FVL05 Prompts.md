# FVL-05 — Corrective/Reopen Prompt Ledger

Append-only. Never delete an earlier prompt — this file is the exact
record of what was asked, in order, so a future session (or audit) can
reconstruct why a given corrective cycle happened without trusting any
one session's own paraphrase of its own instructions.

---

## PROMPT 1 (2026-08-23) — FVL-05.004 corrective cycle (AUDIT_000018 re-resolution)

Reconstructed verbatim from this same conversation's own history (the
prior session's governing message is not separately recorded anywhere
else in the repository, and this ledger file was empty until this
session populated it) — the exact text that opened the corrective cycle
which produced commits `92a89ae` (fix) and `0b02cab` (docs/build
evidence) on `feature/laboratory-stability`:

```
Continue FormuLab manually in the EXISTING repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:

feature/laboratory-stability

CURRENT TASK ONLY:

FVL-05.004 — Process plan + actual process observations extractor

DO NOT start FVL-05.005.
DO NOT perform any Autopilot work.
DO NOT create Drive handoff/audit/prompt files.
The user has abandoned FormuLab Autopilot. This is a normal manual Claude Code session.

FVL-05.001 = COMPLETE
FVL-05.002 = COMPLETE
FVL-05.003 = COMPLETE
FVL-05.004 = NOT YET AUDIT-CLOSED

The latest independent GPT audit is AUDIT_000018 and its verdict is:

CONTINUE

The two concrete remaining findings are:

1. Lineage is still NOT collision-safe across multiple linked trials.
2. Dataset process schemas have not yet been independently proven faithful to the authoritative LaboratoryTrial / TrialProcessStep / TrialObservation source constraints.

Earlier audits also raised the Manufacturing Procedure/process-plan source question. Re-verify that conclusion from actual repository contracts before closure. Do not reopen it if current source evidence conclusively resolves it, but do not rely only on tracker/log prose.

No subagents.
No background agents.
No plan mode.
No force push.
No history rewrite.
No destructive git reset/clean.
Do not touch unrelated dirty files.
Do not mutate real user/business data.

[... sections 1-11: recover exact current truth; fix the lineage
collision defect (LINEAGE1-6); verify source-schema parity directly;
re-resolve the Manufacturing Procedure question (PLAN1/PLAN1-EVIDENCE);
re-audit existing FVL-05.004 behavior; tracker must not lie; tests;
commit and push; desktop build & shortcut acceptance gate; external log
before stop; strict closure gate — full text preserved in this session's
own conversation transcript and in the resulting tracker row / external
log entries it produced, not reproduced a second time here to avoid an
unbounded duplicate of an already-executed, already-logged prompt ...]
```

Outcome: FVL-05.004 lineage rebuilt on a collision-safe
`JSON.stringify([trial.id, record.id])` encoding, `processStepPlanSchema.phase`
constraint relaxed to match source, `plannedProcedure` (persisted
`process_parameters` Manufacturing Procedure) added. Declared "IMPLEMENTATION
AND ACCEPTANCE COMPLETE" at the end of that session — see
`docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`'s
"third corrective verification cycle" section for full detail. That
completion claim was itself reopened by PROMPT 2 below.

---

## PROMPT 2 (2026-08-23) — FVL-05.004 REOPEN (independent GPT re-audit, findings A-J)

Verbatim, the exact prompt that opened this corrective cycle:

```
Continue FormuLab manually in the EXISTING repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:

feature/laboratory-stability

CURRENT TASK ONLY:

FVL-05.004 — Process plan + actual process observations extractor

DO NOT start FVL-05.005.
DO NOT perform any Autopilot work.
This is a normal manual Claude Code session.

IMPORTANT:
A new independent GPT audit has REOPENED FVL-05.004.
The previous statement:

FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

must NOT be treated as current truth.

Read this audit FIRST:

docs/audits/FVL05-GPT Audits.md

Read the newest FVL-05 corrective prompt ledger too:

docs/prompts/FVL05 Prompts.md

The current GPT verdict is:

CONTINUE / REOPEN FVL-05.004

Repository truth overrides tracker, handoff, external log, prior completion claims, and prior prompts.

Do not merely patch the listed findings mechanically. Re-audit the whole FVL-05.004 contract after fixing them.

[... sections 1-20, findings A-J (dataset schema version compatibility;
process_parameters authoritative identity; lineage contract vs
collision-safe encoding; saved_version trial conditional invariant;
trial observation -> process step referential integrity; process step
attachment disposition; durable source schema parity; formula code
uniqueness for plan linkage; deterministic ordering; structured error
context), required new regression tests (VERSION1, PLANKEY1, PLANKEY2,
FORMCODE1, LINK1, OBSREF1, OBSREF2, ATTACH1, PARITY1, ORDER1, ERROR1),
whole-scope adversarial re-audit, acceptance commands, commit/push,
native build/shortcut gate, audit/prompt ledger maintenance, external
log checkpoint, and the strict closure gate ...]
```

Note: `docs/audits/FVL05-GPT Audits.md` and this ledger file were both
found EMPTY (0 bytes) when this prompt directed reading them first — the
findings A-J quoted above/summarized in this prompt ARE, in full, the
only record of that independent audit that exists anywhere in this
repository or its history. `docs/audits/FVL05-GPT Audits.md` now records
those findings verbatim in its own `AUDIT_FVL05_GPT_000001` section
alongside this session's resolution, so this prompt's own paraphrase
above is not the sole surviving copy going forward.

Outcome: see `AUDIT_FVL05_GPT_000001`'s `CLAUDE RESOLUTION` section in
`docs/audits/FVL05-GPT Audits.md`, and this same corrective cycle's
section in `docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`.
