# Privacy and Network Communication

FormuLab is local-first. This document lists, honestly and completely to
the best of this project's own knowledge, every network call the shipped
desktop app makes and what stays local. Re-verified directly against the
source this session (Phase 12 Session 1) — no telemetry, analytics, or
crash-reporting SDK exists anywhere in `apps/desktop/src` or
`apps/desktop/src-tauri/src` (checked directly: zero matches for Sentry,
Amplitude, Mixpanel, PostHog, Google Analytics, Segment, or any
crash-reporting library).

## What stays local, always

- Workspace files, formulations, master data, runs, provenance, and the
  local run index (`.FormuLab/runs.db`) — never uploaded anywhere by the
  app itself.
- LLM/agent-provider API keys — written to app-private runtime config
  (OS keychain / credential manager on platforms where that's wired up),
  never into the workspace, provenance, git history, exported projects,
  logs, or the Diagnostics support bundle (`diagnostics.rs`'s redaction
  never reads `localStorage`, where a provider key can live, by
  construction — see `docs/architecture/IMPLEMENTATION_STATUS.md`'s
  Phase 11 Session 5 entry).
- Command execution, file deletion, dependency installation, and remote
  connections initiated by the agent all require a human-approved flow
  in the app (`AGENTS.md`'s own non-negotiable safety default) — nothing
  reaches the network on the agent's own initiative without that gate.

## What the app itself calls out to, and why

| Destination | When | What is sent | What is received |
|---|---|---|---|
| Your configured LLM/agent provider (OpenAI, Anthropic, a local model server, etc.) | Only when you use Chat/Agents | Your prompt/conversation content, using **your own** API key | The model's response |
| `api.github.com/repos/Sekiph82/FormuLab/releases/latest` (or a configured alternate HTTPS endpoint) | Update check — on launch (if enabled) or a manual click in Settings | Nothing identifying — a plain HTTPS GET, no request body, no user/machine identifier attached | Release metadata (version, notes, platform-asset name) — see `apps/desktop/src-tauri/src/updates.rs` |
| OpenAlex (`api.openalex.org`) | Only when you run Formulation Discovery's literature search | Your search query | Open-access paper metadata/PDFs |
| Whatever URL you explicitly open via "View Release / Download" or any in-app "open externally" action | Only on your explicit click | Standard browser request to that URL | Whatever that page returns — this leaves the app entirely, handled by your OS's default browser |

Nothing else calls out. In particular: no usage analytics, no crash
reporting, no update check silently running in the background without the
setting that controls it, no first-run "phone home," no license-check
network call (there is no license server — FormuLab is MIT-licensed and
free).

## Update checking specifically

The current update checker (Phase 11 Session 9) is **check-only** — it
fetches release metadata and shows a badge/notification; it never
downloads or executes an installer on its own. See
`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` for the design of
a future secure in-app update *installer*, which — once built — will
still follow this same disclosure discipline: documented here, and never
silent about what it downloads or why.

## Local data you control deleting

Everything FormuLab writes locally (workspace data, `.FormuLab/runs.db`,
backups, logs, the app-private config directory) lives under paths you
control and can inspect or delete yourself — see Settings → Diagnostics
for exact paths, and Settings → General → Active Data Location for where
your project data currently lives.

## Questions or a privacy concern

Open an issue, or use the process in
[`../SECURITY.md`](../SECURITY.md) if the concern is a genuine data-safety
vulnerability rather than a documentation question.
