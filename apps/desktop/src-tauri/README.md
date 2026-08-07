# apps/desktop/src-tauri

The Rust side of the Tauri app.

Responsibilities:

- Native commands exposed to the frontend (filesystem within the workspace, OS keychain
  access for API keys, formulation generation via `formulation_v2.rs`, etc.).
- Supervising the Jupyter kernel/Gateway processes (`kernel.rs`/`jupyter.rs`) — there is
  no agent-runtime sidecar; formulation generation runs as a direct command into the
  bundled Python pipeline, not a supervised long-running process.
- Packaging configuration — targets: `dmg` / `app` (macOS), `nsis` / `msi` (Windows).
- Auto-update check (`updates.rs`) — download/install/rollback is Phase 12 scope, not yet built.

Keep this thin: system capabilities only, no heavy computation. Heavy work goes to
`runtime/formulation`, `runtime/kernel`, `runtime/pipeline`.
