STATUS: READY

Built from `main` at source HEAD `f0b5fbbc1dc84f24702b64067854a0780e427637` using the existing Windows Rust/Tauri toolchain. `pnpm --filter @formulab/desktop exec tauri build --no-bundle` succeeded, then `pnpm --filter @formulab/desktop exec tauri build --ci --no-sign --bundles msi nsis` succeeded and produced both requested installers.

Artifacts:
- `apps/desktop/src-tauri/target/release/formulab.exe` — 24,681,472 bytes; SHA-256 `0F8CCE42D0F21EC590F2C06617D1FF4C72740F90F071B0B3B2279D212A9BD447`; file/product version `0.4.0`.
- `apps/desktop/src-tauri/target/release/bundle/msi/FormuLab_0.4.0_x64_en-US.msi` — 36,548,608 bytes; SHA-256 `35B7A23006E7B9B118D87D3773A838591789A955EAE6C82F6E32D21B71F5D50F`.
- `apps/desktop/src-tauri/target/release/bundle/nsis/FormuLab_0.4.0_x64-setup.exe` — 25,715,563 bytes; SHA-256 `B57C695A88675DD03335BDB36A0DB289D71C02DA6A7F62C9562208B0C258353A`; file/product version `0.4.0`.

Bundle inputs included the repository-pinned uv `0.11.26` binary from the existing user-local Python installation; its SHA-256 matched the source copy. That task-created staging copy was removed after successful bundling. Packages are unsigned local build outputs; no signing, installation, or runtime acceptance is claimed.
