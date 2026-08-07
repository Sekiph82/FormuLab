# FormuLab

Brand name: **FormuLab** — "Local-first, model-agnostic AI research
workbench for macOS, Windows & Linux." Bundle identifier:
`com.formulab.app`. Internal packages: `@formulab/shared`,
`@formulab/desktop`.

Project rules and working context for AI agents (Claude Code, Cursor, Codex, etc.).
`CLAUDE.md` is a symlink to this file — edit only `AGENTS.md`.

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

- Default working language for discussion is Chinese; **all project files and
  code are in English** (this is a pure-English project).
- One progress file: `PROGRESS.md`. Append one line per real milestone,
  `YYYY-MM-DD HH:MM` + a one-sentence conclusion, newest on top. Results and
  blockers only.
- Avoid adding new Markdown docs unless requested — too many docs become debt.
- Prefer minimal, verifiable changes; every step should produce a checkable result.
- Do not write inferences as verified facts; tie conclusions to code or data.
- New session workspaces are local git repos: the app initializes them and makes
  best-effort local commits after workspace file changes. Never set a remote or push.

## Phase handoffs

- Use `docs/handoffs/PHASE7_CURRENT.md` for active Phase 7 state.
- Keep implementation sessions bounded to one related subsystem and one logical commit.
- Use a fresh Claude context after each completed session.
- Update the active handoff once at session end.
- Reserve full regression, release builds, installers, and native verification for closure sessions.

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
