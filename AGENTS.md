# FormuLab

Brand name: **FormuLab** — "Local-first, model-agnostic AI research
workbench for macOS, Windows & Linux." Bundle identifier:
`com.formulab.app`. Internal packages: `@formulab/shared`,
`@formulab/desktop`.

Project rules and working context for AI agents.

**Primary implementation/execution agent: Codex.** Codex owns active FormuLab implementation work, testing, TASKS.md state transitions, commits, and pushes unless the owner explicitly assigns a different actor for a specific task. Other agent-specific files are compatibility/history surfaces only and must not override this rule.

Canonical repository: https://github.com/Sekiph82/FormuLab
Canonical task ledger: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md

`CLAUDE.md` is retained only as a compatibility pointer back to this governance file; edit project-wide rules here.

## H!veAI GitHub tracking

- The repository root `TASKS.md` is the **only current project-status tracker**: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
- Codex is the default required actor for active implementation unless `TASKS.md` explicitly names another actor.
- H!veAI project truth is GitHub repository metadata plus root `TASKS.md` on the configured tracked branch.
- Current H!veAI tracked branch for FormuLab is `main`.
- `PROGRESS.md`, `project-control/**`, handoffs, audits, prompts, logs, roadmap/spec documents, GitHub issues, and `docs/migration/legacy-task-trackers/**` are evidence/history or scope context only. They must not override task state in root `TASKS.md`.
- Do not create or revive `.hiveai/PROJECT*`, `.hiveai/TASKS*`, `.hiveai/STATE*`, `.hiveai/HANDOFF*`, `.hiveai/EVENTS*`, `.hiveai/RULES*`, dashboard manifests, or any other competing task ledger.
- When a task starts, update both its checkbox row and the `Project Status` section in `TASKS.md` in the same logical change.
- When a task is independently accepted/validated complete, mark it `[x]`, advance `Current Task`/`Next Task`, and keep the human-readable progress summary consistent with the checkbox ledger.
- Valid task markers for H!veAI are `[x]` complete, `[~]` in progress, `[ ]` planned/pending, and `[!]` blocked.
- Never infer the current task from the first unchecked item. `Current Task` in `TASKS.md` is explicit authority.
- Commit and push `TASKS.md` with the implementation state it describes. Do not claim a remote task-state transition before that state exists on the tracked GitHub branch.

## Design principles

Keep it **simple, explicit, clear, complete**.

- **Simple** — no over-engineering; if not necessary, do not add entities.
- **Explicit** — no ambiguity; no bugs.
- **Clear** — understandable at a glance.
- **Complete** — cover the key points; prioritize safety.

## What this project is

An open-source, local-first, model-agnostic, reproducible AI research desktop
for macOS, Windows, and Linux. See `README.md`, `docs/PRD.md`, and
`docs/TECHNICAL_DESIGN.md`.

Recommended stack: **Tauri 2 + React + TypeScript + Vite**, Tailwind + Radix UI,
a direct Tauri-command pipeline (`formulation_v2.rs::generate_formulation`)
into the bundled Python/R runtime (`runtime/pipeline`, `runtime/formulation`,
`runtime/kernel`) — no separate agent-runtime sidecar — local workspace +
SQLite + JSONL provenance.

## Repository map

- `apps/desktop/` — Tauri + React desktop shell (`src/` frontend, `src-tauri/` Rust).
- `packages/` — `ui`, `shared`.
- `runtime/` — `formulation`, `kernel`, `pipeline`, `harness`, `skills` (the
  optimizer, R/Python kernel bridge, literature/materials pipeline, the
  bundled harness, and self-authored scientific skills — all bundled via
  `tauri.conf.json`'s `bundle.resources` or run as local processes).
- `docs/` — product and technical specs.
- `examples/` — the bundled demo projects (`shampoo-formulation`, `surface-cleaner`).
- `scripts/` — release and dev scripts.

## Architecture guardrails

- Formulation generation runs through one direct Tauri command
  (`generate_formulation`) into the bundled Python pipeline — no agent
  runtime, no sidecar process to supervise.
- Keep the frontend, desktop shell, and Python/R runtime decoupled.
- Skills must stay pluggable.
- Keep the artifact schema and workflow templates stable and versioned.

## Safety defaults (non-negotiable for the desktop)

- The agent may only access the current workspace.
- Command execution, file deletion, dependency install, and remote connections
  require approval (manual approval mode by default — never ship `off`).
- API keys go to the OS keychain / credential manager; never into provenance,
  logs, crash reports, git, or exported projects.

## Working conventions

- Default working language for discussion with the owner is Turkish; **all project files and
  code are in English** unless the owner explicitly requests otherwise.
- `PROGRESS.md` is a historical progress log, not a task-state authority. Append
  one line per real milestone when useful: `YYYY-MM-DD HH:MM` plus a one-sentence
  conclusion, newest on top. Results and blockers only.
- Avoid adding new Markdown docs unless requested — too many docs become debt.
- Prefer minimal, verifiable changes; every step should produce a checkable result.
- Do not write inferences as verified facts; tie conclusions to code or data.
- New session workspaces are local git repos: the app initializes them and makes
  best-effort local commits after workspace file changes. Never set a remote or push.

## Session evidence and handoffs

- `project-control/**` may hold provider-specific implementation evidence, audits,
  prompts, logs, or handoffs, but none of it is task-state authority.
- Keep implementation sessions bounded to one related subsystem and one logical commit.
- Provider-specific contexts or handoffs may be used only when explicitly requested, without duplicating the canonical task state already present in `TASKS.md`.
- Do not route active implementation to Claude by default; Codex is the primary executor.
- Reserve full regression, release builds, installers, and native verification for closure sessions.

## Codex milestone automation

- The explicit `Current Task` in root `TASKS.md` is the only task an automated run may start. Never select the first unchecked row or cross a milestone boundary implicitly.
- Run one implementation worker at a time. Use one independent read-only reviewer; add a specialist only for a security, data-integrity, or UI-specific acceptance need.
- Update the selected task and `Project Status` together when work starts, then update `TASKS.md` at every task transition. Do not create another task ledger.
- Do not run the full project suite for each task. Record task-level review evidence and run the milestone's complete acceptance suite at its explicit closure task. If fixes change code after a failing suite, rerun affected checks and validate the final state before closing.
- Use one task-owned worktree/branch for a milestone. Keep it isolated from owner work, merge only after milestone acceptance, and remove only exact worktrees, branches, and temporary paths created by that run.
- Record free space before and after on the same volume. Never sweep shared TEMP, Codex/AppData, package caches, or other user data. Report unavoidable OS/application writes; do not promise an exact free-space match.
- When a task reaches a human approval, authentication, regulated decision, ambiguous acceptance, external-publication, owner-data, or genuine blocker gate, record the exact question in `TASKS.md`, block only the task that depends on it, and continue with the next READY task that is independent of all open questions. Use an isolated task-owned worktree to keep unrelated owner changes untouched. Do not stop the overall queue while any independent READY task remains; wait only when no READY task can safely proceed or the queue is complete. Never bypass a human gate or fabricate approval/verification.
- For app-initialized local session workspaces, do not add a remote or push. For the canonical FormuLab repository, follow the publication step explicitly required by root `TASKS.md`; these are different workspace types.

## Data integrity

- Preserve `.FormuLab/runs.db`.
- Saved formula versions are immutable.
- Blank import or analytical values remain blank or unknown — never zero.
- Missing evidence must not be fabricated or treated as certainty.
- Imports, agents, and system actors cannot approve or verify regulated records.
- Approval and verification require a named authorized human.

## Git and testing

- Do not overwrite unrelated working-tree changes.
- Stage only current-task files.
- Use targeted tests during implementation sessions.
- Run full-project regression only in closure sessions.
- Do not force-push.
