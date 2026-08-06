# Privacy and Network Communication

FormuLab is local-first. This document lists every network call
**FormuLab's own first-party code** (`apps/desktop/src`,
`apps/desktop/src-tauri/src`) initiates, based on direct inspection of
that code — it is not an exhaustive audit of every line of every
third-party dependency in `node_modules` (a real, disclosed scope limit,
not a claim that dependency code has been separately verified not to
phone home). No telemetry, analytics, or crash-reporting SDK exists
anywhere in FormuLab's own source (checked directly: zero matches for
Sentry, Amplitude, Mixpanel, PostHog, Google Analytics, Segment, or any
crash-reporting library).

## What stays local, always

- Workspace files, formulations, master data, runs, provenance, and the
  local run index (`.FormuLab/runs.db`) — never uploaded anywhere by the
  app itself.
- LLM/agent-provider API keys — **currently written to the browser
  `localStorage` inside the app's own WebView2 profile** (e.g.
  `formulab.v2.key.<provider>`, confirmed directly in
  `apps/desktop/src/lib/formulationV2.ts`), not OS keychain/credential-
  manager storage — that stronger storage is `AGENTS.md`'s stated goal
  for this project, not yet how the code actually works today, and this
  document says so plainly rather than describing the goal as already
  true. Keys are never written into the workspace, provenance, git
  history, exported projects, or logs, and the Diagnostics support
  bundle's redaction never reads `localStorage` by construction (see
  `docs/architecture/IMPLEMENTATION_STATUS.md`'s Phase 11 Session 5
  entry) — but `localStorage` itself is plaintext, readable by anything
  with access to the WebView2 profile directory on this machine, which
  is a materially weaker guarantee than OS-keychain storage would be.
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

FormuLab's own code initiates no other network call: no usage analytics,
no crash reporting, no update check silently running in the background
without the setting that controls it, no first-run "phone home," no
license-check network call (there is no license server — FormuLab is
MIT-licensed and free). This is a statement about FormuLab's own source,
not a guarantee about every bundled third-party library's own behavior
(see the scope note above).

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
