# apps/desktop

The Tauri 2 + React + TypeScript + Vite desktop application — the FormuLab shell.

## Layout

- `src/` — the React frontend.
  - `app/` — `routes/`, `layout/`, `providers/` (routing, shell layout, context providers).
  - `components/` — reusable UI: `sidebar/`, `topbar/`, `command-palette/`, `cards/`,
    `artifact-viewer/`, `approval-dialog/`, `tool-call-card/`, `code-viewer/`, `markdown-viewer/`.
  - `features/` — feature modules: `onboarding/`, `projects/`, `chat/`, `agent-runtime/`,
    `literature/`, `artifacts/`, `provenance/`, `review/`, `skills/`, `settings/`.
  - `lib/` — `api/`, `events/` (event bus for agent streams), `store/` (Zustand), `theme/`.
- `src-tauri/` — the Rust side: native commands, sidecar orchestration, packaging config.

## State strategy

- UI state → Zustand (`lib/store`).
- Server / runtime state → TanStack Query.
- Streaming agent events → a dedicated event bus (`lib/events`).

Formulation generation is one direct Tauri command (`formulation_v2.rs`'s
`generate_formulation`) into the bundled Python pipeline — no agent runtime,
no sidecar. (The `agent-runtime`/`chat`/`skills` feature-module layout and
"streaming agent events" described above predate that; this file was not
kept current through that change — see `docs/TECHNICAL_DESIGN.md` and
`docs/architecture/CURRENT_STATE_AUDIT.md` for the actual current shape of
`src/`, not this section.)

## Depends on

`packages/ui`, `packages/shared`; at runtime, the bundled `runtime/pipeline`,
`runtime/formulation`, and `runtime/kernel` Python/R scripts (no sidecar).
