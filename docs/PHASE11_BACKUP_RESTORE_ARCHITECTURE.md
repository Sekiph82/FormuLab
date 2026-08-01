# Phase 11 Backup, Restore and Verification Architecture

Session 0 (assessment and planning only — nothing in this document is
implemented yet). Grounded in `docs/PHASE11_DATA_INVENTORY.md`'s
inventory and in the real dependencies already present in
`apps/desktop/src-tauri/Cargo.toml`.

## Design constraints this architecture must satisfy

- Real data root: `project_root()` (`formulab-root.txt` else
  `base_workspace_dir()`), never assumed to equal `app_data_dir()`.
- Real, evidenced exclusions: `EBWebView` (contains a plaintext API key
  in `localStorage`, see inventory item 15), `runtime/pipeline`,
  `runtime/formulation`, `runtime/skills` (regenerated code cache, item
  14), `.FormuLab/runs.db` (this session's own never-touch rule, and
  independently disposable/rebuildable per item 8).
- Real, evidenced append-only collections (24 of 90 master collections,
  plus `audit.jsonl`/`runs.jsonl`/`provenance.jsonl`) must never be
  restored in a way that truncates their history.
- `.FormuLab/runs.db` must never be touched by backup or restore code —
  it is excluded from the package and restore never writes to it
  (a post-restore app launch rebuilds it lazily from `runs.jsonl`, per
  `runs_index.rs`'s own stated design).
- Root-pointer files (`formulab-root.txt`, `base-workspace.txt`,
  `active-workspace.txt`) are machine-specific absolute paths — captured
  in the manifest for diagnostic purposes only, never blindly restored
  onto a different machine's filesystem.

## Package format

**Proposed: `.formulab-backup`**, a single file, being a standard ZIP
container (not a custom binary format) with:
- `manifest.json` at the archive root (uncompressed entry, or first
  entry — readable without decompressing the whole archive).
- `data/` — a mirror of the included real-data tree (see inclusion list
  below), stored relative to `project_root()`.
- `runs/` — `.FormuLab/runs.jsonl`, `remote-runs.jsonl`,
  `provenance.jsonl`, `logs/*.txt`, `compute.json` — stored relative to
  `workspace_dir()`/`base_workspace_dir()`, kept in a separate top-level
  folder from `data/` because they resolve under a *different* root
  function (see inventory's root-resolution layer) and must be restored
  to the correct one, not conflated with `project_root()`'s tree.
- No dependency on a new archive format: `Cargo.toml` has no `zip` crate
  today — **this is a new, disclosed dependency Session 1 must add**
  (the standard `zip` crate, pure Rust, matching the "no ad hoc format"
  principle). `sha2` (already a dependency, `Cargo.toml:35`, already used
  for exactly this kind of checksum in `attachments.rs:18,38-39`) covers
  the manifest's hash inventory with no new crate.
- Rejected alternative: a bare directory copy. A single file is easier
  for a user to move/name/attach to a support ticket, and lets the
  manifest be read without walking a whole directory tree first
  (relevant to verification, below).

## Manifest structure (`manifest.json`)

```jsonc
{
  "backupFormatVersion": "1.0",
  "formulabAppVersion": "0.4.0",           // from tauri.conf.json at backup time
  "createdAt": "2026-08-01T12:00:00Z",
  "dataRootIdentifier": {
    // Not the raw absolute path alone — also a stable fingerprint so a
    // restore can detect "this backup came from a different root" even
    // if paths happen to collide across machines.
    "resolvedProjectRoot": "C:\\Users\\...\\Documents\\FormuLab",
    "resolvedWorkspaceRoot": "C:\\Users\\...\\Documents\\FormuLab",
    "formulabRootOverrideActive": false,
    "activeWorkspaceOverrideActive": false
  },
  "schemaVersions": {
    "global": "1.0",                        // reserved; see Migration Architecture doc
    "perCollection": { "materials": "1.0", "formulations": "1.0", "...": "1.0" }
  },
  "included": ["data/formulations", "data/master", "data/sessions", "formulas",
               ".FormuLab/runs.jsonl", ".FormuLab/remote-runs.jsonl",
               ".FormuLab/provenance.jsonl", ".FormuLab/logs", ".FormuLab/compute.json"],
  "excluded": ["data/literature (optional, see inventory item 5)",
               ".FormuLab/runs.db (disposable, rebuilt on next launch)",
               "EBWebView (webview cache + local API key)",
               "runtime/pipeline, runtime/formulation, runtime/skills (regenerated code cache)"],
  "fileInventory": [
    { "path": "data/master/materials.json", "bytes": 12345, "sha256": "..." }
    // one entry per included file — the basis for both the size total
    // and the verification pass below
  ],
  "warnings": ["data/literature was NOT included (network cache, excluded by default)"],
  "compatibility": {
    "minSupportedAppVersion": "0.4.0",
    "maxKnownAppVersion": "0.4.0"
  }
}
```

Every field above is derived from something this session confirmed
exists (`tauri.conf.json`'s `version`, the per-record `schemaVersion`
literals, the exclusion list backed by the inventory doc) — nothing is
invented ahead of Session 1 actually building it.

## Backup creation — staging and atomic finalization

1. **Stage** into a temporary directory beside the final destination
   (same volume, so the final move is a rename, not a copy — matching
   the existing `write_array`'s write-then-rename discipline in
   `masterdata.rs:427-435`).
2. Walk the inclusion list, hashing each file with `sha2` as it is
   copied (same crate/pattern as `attachments.rs:38-39`'s
   `sha256_hex`).
3. Write `manifest.json` last, once every file's size/hash is known.
4. Zip the staging directory into `<name>.formulab-backup.tmp`.
5. **Atomic finalization**: rename `.tmp` to the final `.formulab-backup`
   name only after the zip write completes and its own central directory
   has been read back successfully (a cheap self-check: open the just
   written archive and confirm the manifest entry round-trips) — the
   same "don't call it done until you can read it back" discipline the
   inventory's write-then-rename pattern already uses elsewhere.
6. **Interrupted-backup handling**: a crash before step 5 leaves only a
   `.tmp` file, which a later backup run (or a cleanup pass) recognizes
   by extension and discards — never treated as a valid backup, never
   left silently masquerading as one.

## Restore — staging and safety

1. **Verify first** (see Backup Verification below) — restore never
   begins against an unverified package.
2. **Safety backup of current data before restore**: create a fresh
   backup of the *current* `project_root()`/`workspace_dir()` state,
   using this same mechanism, before touching anything — restore failure
   must never be able to leave the user with neither the old nor the new
   data.
3. **Stage** the restore into a temporary directory (not directly onto
   live files), fully extracted and re-verified (hash-checked against
   the manifest a second time, post-extraction, to catch a truncated
   unzip) before any live file is touched.
4. **Compatibility check** against `manifest.json`'s
   `backupFormatVersion`/`formulabAppVersion`/`schemaVersions` — see
   Migration Architecture doc for what happens when the backup is from
   an older schema version (migration integration point).
5. **Locked-file handling**: if the running app currently holds a file
   open in the destination (in practice: none of `masterdata.rs`'s
   writers hold files open, all are open-write-close, but a live restore
   should still assume the app could be mid-write) — restore must run
   with the app either fully quit or with write commands paused; staging
   to a temp dir first (step 3) means a lock is only ever hit at the
   final swap-in step, minimizing the exposure window.
6. **Validation before activation**: after copying staged files into
   place, re-read a sample of restored master-data collections through
   the real Zod schemas (matching this repo's existing
   `.parse()`-against-real-schema discipline used by the Phase 10
   fixture builder) before declaring restore complete.
7. **Rollback on restore failure**: if validation (step 6) fails, restore
   from the safety backup created in step 2 — never leave a partially
   restored, partially validated data root as the live state.
8. **Cancellation**: any point before the final swap-in (step 3's staging
   is complete but not yet copied over live files) can cancel cleanly by
   discarding the staging directory; cancellation after the swap begins
   is not offered as a partial rollback — the whole restore either
   completes or falls back to the step-2 safety backup, per step 7.

## Full restore only, not partial

Per this session's explicit instruction: full restore is the first
target, and partial restore is not invented without evidence the data
model makes it safe. Evidence found this session that argues *against* a
naive partial restore: `formulation.rs`'s versions are immutable and
referenced only by directory nesting (no cross-collection foreign keys
to reconcile), which suggests a per-collection partial restore *could*
eventually be safe — but `masterdata.rs`'s append-only collections
(24 of 90) would need explicit merge-vs-replace semantics for a partial
restore to avoid silently truncating history, which is unresolved and
therefore out of scope until a dedicated session designs it.

## Backup verification (standalone, does not restore)

Runs against a `.formulab-backup` file without extracting it beyond
reading the manifest and per-file hashes.

Checks:
- Archive readability (zip central directory parses).
- `manifest.json` present, well-formed JSON, matches its own declared
  schema.
- `backupFormatVersion` recognized (not future, not pre-historic).
- Every path in `fileInventory` exists in the archive; no unexpected
  extra paths outside the manifest's `included` set.
- No duplicate archive paths (a zip can technically contain the same
  path twice — reject on sight).
- No path-traversal entries (`../`, absolute paths, drive-letter paths)
  — reject the whole archive rather than sanitize and continue.
- No symbolic links or junction entries in the archive (zip supports a
  symlink bit; refuse it outright — a restored symlink could point
  anywhere on the target machine).
- Declared file sizes/hashes match actual decompressed bytes for every
  entry.
- `formulabAppVersion`/`schemaVersions` checked against what this build
  supports — future-versioned fields are flagged as "unsupported schema
  version," not silently accepted.
- JSON entries are parsed, not just size/hash-checked, catching a
  corrupted-but-right-length file.
- `.FormuLab/runs.db` must never appear in a valid backup — its presence
  is itself flagged as `unsafe` (a violation of this project's own
  never-touch rule, and evidence the backup was produced by tooling that
  didn't respect the exclusion list).
- No executable content (`.exe`/`.dll`/`.sh` etc. — none should ever be
  in scope, so any occurrence is `unsafe`, not merely unexpected).
- No absolute paths recorded inside `data/`/`runs/` archive entries
  themselves (only the manifest's `dataRootIdentifier` may carry an
  absolute path, and only as metadata, never as an extraction target).

Statuses:
- **valid** — every check passes, versions current.
- **valid with warnings** — passes, but e.g. `data/literature` excluded,
  or an append-only collection has more revoked-then-reissued rows than
  usual (informational, never blocking).
- **incompatible** — well-formed and uncorrupted, but
  `backupFormatVersion`/`formulabAppVersion`/a collection's
  `schemaVersion` is one this build cannot read (distinct from
  corruption: the bytes are fine, the *shape* isn't supported yet, or is
  from a newer build than this one).
- **corrupted** — bytes don't match declared hashes/sizes, JSON fails to
  parse, or the zip central directory itself is damaged.
- **unsafe** — path traversal, symlink entries, executable content, or a
  present `.FormuLab/runs.db` (see above).

Corruption and incompatibility are always reported as distinct statuses
— never conflated, per this session's explicit instruction.

## Known open questions for Session 1 (not resolved here)

- Whether `data/master/backups/<collection>-<timestamp>.json` (the
  existing ad hoc pre-delete snapshot mechanism, inventory item 3) should
  be superseded by the new backup system or left as-is alongside it.
- Whether `data/literature` defaults to included or excluded (leaning
  excluded-by-default with an opt-in, pending a Session 1 decision, not
  assumed here).
- Disk-space validation strategy (check free space against the manifest
  `fileInventory` size total before staging) — mechanism is
  straightforward (`std::fs` on Windows via the same APIs
  `set_workspace_base` already uses to create/canonicalize directories,
  `workspace.rs:82-91`) but exact threshold/margin is a Session 1 design
  decision, not fixed here.
