STATUS: READY

Added a focused Rust backup integrity test covering eight new master-data collections: alternative rankings, predictive models, optimization runs, DOE studies/runs/analyses, laboratory trials, and test results. The test runs the production collector, builds a package fixture, verifies it with the production backup verifier, checks each archived file's size/hash/JSON, activates staged bytes through the production restore activation helper, and confirms exact byte preservation over pre-existing live files.

Validation:
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib backup::tests::new_optimizer_doe_and_laboratory_records_survive_backup_restore_integrity_path` — passed (1 test).
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib backup::tests::` — passed (36 tests, including automatic-backup tests).
- Rust commands used the environment-only `TAURI_CONFIG={"bundle":{"externalBin":[]}}` override because this checkout has no packaged `uv` sidecar binary; no repository configuration or binary was changed.
- The Tauri command wrappers requiring `AppHandle` are not constructed in this unit test. The exercised components are the production collector, verifier, archive reader/path mapper, and restore activation helper.
- `pnpm codex:tasks:check` and `git diff --check` — passed.

Fixtures are synthetic, isolated under the OS temp directory, and removed by the test. No owner workspace data, credentials, database, or external service was used.
