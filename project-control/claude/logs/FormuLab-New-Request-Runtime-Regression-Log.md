## Session — New Request native packaging regression: root cause, fix, and full dependency-closure audit (2026-08-21)

Branch: feature/laboratory-stability
Starting HEAD: cabeda11794fba1c92681ef2799f8980261e8764
Fix commit: f568e09 "fix(formulation): include complete embedded Python runtime dependencies"

### User-reported symptom

Clicking "Start Formulation Request" on the New Request page crashed
the embedded Python pipeline with a raw traceback surfaced to the
user:

```
Traceback (most recent call last):
  File "...\runtime\pipeline\run_cli.py", line 96, in <module>
    main()
  File "...\runtime\pipeline\run_cli.py", line 62, in main
    import pipeline
  File "...\runtime\pipeline\pipeline.py", line 32, in <module>
    import literature_cache
  File "...\runtime\pipeline\literature_cache.py", line 39, in <module>
    import artifact_naming
ModuleNotFoundError: No module named 'artifact_naming'
```

Explicitly framed by the user as a release-blocking native packaging /
runtime materialization defect, NOT the already-fixed sidebar
duplicate-"New" bug from an earlier session (confirmed separately, via
the user's own manual check of `Desktop\FormuLab.lnk`, to already be
fixed — not reopened this session).

### Reproduction (inspected real files first, no guessing)

1. Confirmed `runtime/pipeline/artifact_naming.py` genuinely exists in
   the source tree (added by FVL-04.026) and its own tests pass.
2. Confirmed `apps/desktop/src-tauri/src/formulation_v2.rs`'s
   `materialize_pipeline()` write-list had ZERO entry for
   `artifact_naming.py` — grepped directly, not inferred.
3. Confirmed the REAL app-data materialized directory
   (`%APPDATA%\com.formulab.app\runtime\pipeline\`, inspected via direct
   PowerShell `Get-ChildItem`) genuinely lacked `artifact_naming.py` —
   direct reproduction of the reported bug, before any code was
   touched.

### Root cause

`formulation_v2.rs`'s `materialize_pipeline()` embeds and writes each
Python module INDIVIDUALLY (`include_str!()` at compile time, written
to disk at first use). This list is independently maintained from the
actual Python import graph, and was never updated when
`literature_cache.py` started importing `artifact_naming` (FVL-04.026).
The file's own doc comments confirm this exact class of defect has
recurred before (FVL-02.009, FVL-03.012, several Phase 14/15 sessions)
— a structural drift risk between two independently-maintained
artifacts, not a one-off mistake.

### Fix (in source/build — never a manual `%APPDATA%` patch)

Added `F_ARTIFACT_NAMING` (`include_str!("../../../../runtime/pipeline/artifact_naming.py")`)
and the corresponding `("artifact_naming.py", F_ARTIFACT_NAMING)` entry
to `materialize_pipeline()`'s write-list, following the file's own
established doc-comment convention (explains why, references
FVL-04.026). `cargo check --quiet`: clean on first attempt.

The user's real `%APPDATA%\com.formulab.app` directory was NEVER
manually edited — inspected only. The fix ships in source/build, so a
clean install (or the next real `generate_formulation` invocation on
this rebuilt app) materializes it automatically via the app's own
normal, unmodified behavior.

### Full dependency-closure audit (not stopping at one file)

Per the explicit instruction not to add one file and declare victory,
audited the FULL reachable first-party Python import closure from
`run_cli.py`/`pipeline.py`, including LAZY/in-function imports (not
just top-of-file): `run_cli.py`'s own `import pipeline` (inside
`main()`), `literature_cache.py`'s `import discover` (inside a
function), `scientific_formulation.py`'s local `materials`/`evidence`
imports, `provenance.py`'s local `study_count` import, `engine.py`'s
local `rules_validate` import. Cross-checked every reachable module
against `materialize_pipeline()`'s real write-list. Result:
`artifact_naming.py` was the ONLY genuine gap — no second or third
missing module found.

Classification of every module in the closure:
- **Embedded/materialized (in `runtime/pipeline/`)**: pipeline, literature_cache,
  rules, region_profiles, run_cli, fulltext, canonical_paper, evidence,
  strategy, provenance, engine, materials, master_materials_adapter,
  manufacturing, traceability, validation_plan, scientific_formulation,
  architecture_portfolio, artifact_naming (19 modules, all now correctly
  materialized).
- **Materialized elsewhere (sibling directory)**: `discover.py`, into
  `runtime/skills/core/formulation-discovery/` (relative-import
  convention `literature_cache.py` already relies on).
- **Legacy/unreachable (deliberately NOT materialized)**: `llm.py`
  (zero-LLM round — no longer imported anywhere in the deterministic
  path), `safety.py`, `regulatory.py` (retired Python-side authorities,
  FVL-03.009/.010 — real evaluation is now client-side TS), `materials_cli.py`
  (standalone CLI tool, not imported by the pipeline).
- **stdlib / intentional external dep**: none flagged — no new
  third-party dependency was introduced by this fix.

### New regression tests (would have failed before the fix; not a trivial string-search test)

**`runtime/pipeline/test_native_packaging_closure.py` (PKG1-PKG5)** —
parses `formulation_v2.rs`'s REAL materialized-file list directly from
its own source text (regex over the `materialize_pipeline()` function
body — never hand-duplicated, so this test can never silently drift
from what the app actually does), and independently computes the REAL
Python import closure via `ast.parse()`/`ast.walk()` (never by
importing the package — this test's own correctness never depends on
the developer source tree being importable at native runtime). PKG3 is
a meta-test proving the `find_missing()` checker itself is capable of
catching a genuinely missing module (`{"a","b","c"} - {"a","b"} ==
{"c"}`) — directly answering "would this test have caught the real
regression before it shipped." PKG4 proves the legacy/unreachable
modules above never silently become required. PKG5 is a structural
proof that this file's own source never contains `import
pipeline`/`import run_cli`/`import literature_cache`.

**`runtime/pipeline/test_native_packaging_smoke.py` (PKG6)** — copies
ONLY the files `materialize_pipeline()` actually lists (same
regex-extraction, independently re-implemented) into a genuinely
disposable `tempfile.TemporaryDirectory()`, strips `PYTHONPATH` from
the subprocess environment, and runs `python -c "import pipeline"` with
`cwd` set to that isolated directory. This is deliberately NOT the same
as running `python runtime/pipeline/run_cli.py` from the repo root —
the repo root already has every module importable regardless of what
`materialize_pipeline()` actually copies, so it could never reproduce a
materialization gap. A stale/incomplete list genuinely reproduces
`ModuleNotFoundError` inside this isolated subprocess; the current,
fixed list does not.

Both new files pass on first run (6/6), and the full
`python -m pytest runtime/pipeline -q` suite: **378 passed, 18 subtests
passed**, zero regressions from adding them.

### Zero-LLM architecture verification (ZLLM1-3) — cited, not duplicated

- **ZLLM1** (`pipeline.py` doesn't import `llm.py`): confirmed by the
  PKG2/PKG4 closure audit above — `llm` is not in the reachable set.
- **ZLLM2** (`materialize_pipeline()` doesn't newly make `llm.py`
  reachable): confirmed — this session's only addition was
  `artifact_naming.py`; `llm.py` remains absent from both the source
  list and the materialized set (also directly verified: it is
  genuinely absent from the real `%APPDATA%` directory too).
- **ZLLM3** (New Request works without provider/model/API-key): cited
  from the pre-existing `test_llm_call_is_never_reached_by_the_deterministic_path`
  test (`test_pipeline.py`) — patches `llm.call` to raise, runs a REAL
  end-to-end `pipeline.run()` (formulation generation, manufacturing
  planning, validation-plan generation), proves the exception never
  fires. `run_cli.py`'s own docstring confirms provider/model/api_key
  are read but IGNORED as of the Phase 15 zero-LLM round. PKG6 is
  strictly stronger evidence for the packaging half of this claim: the
  isolated materialized runtime doesn't even CONTAIN `llm.py`, so it
  cannot be reached even if some future code tried.

### Native build / binary-level proof

Full detail in `C:\Users\sekip\Desktop\FormuLab-Build-Shortcut-Log.md`
(this session's entry). Summary: fresh `tauri build --no-bundle` from
the final pushed HEAD (`4fb0e24f7dfc4a3448e3832c4c0db92237931cad`)
succeeded; `grep -a` against the compiled `.exe` for
`artifact_naming.py`'s own distinctive doc-comment phrase and a unique
function name both found (1 and 3 matches respectively) — the fix is
genuinely compiled into the shipped binary, not merely present in
source.

### NR1-NR8 native New Request runtime acceptance — disclosed tooling limitation

`materialize_pipeline()` runs LAZILY, only inside the `generate_formulation`
Tauri command, itself only reachable through a real click on the New
Request page. No UI automation tooling exists in this environment for a
native Windows/Tauri window (the available browser-automation tools
attach only to Chrome tabs, not arbitrary native applications). This
codebase has its own established, DOCUMENTED precedent against using
`tauri::test::mock_app()` to exercise `AppHandle`-dependent path
resolution — `apps/desktop/src-tauri/src/automatic_backup.rs:176`:
*"the unsafe mocked-`AppHandle` workaround this phase's Stage 1 closure
already rejected once (`app.path().app_data_dir()` resolves
unpredictably under `tauri::test::mock_app()`)"* — so writing such a
test for `materialize_pipeline()` would be flaky/misleading, not a
genuine proof, and was deliberately not attempted.

Checked immediately after a real launch-smoke-test of the freshly
built app (process launched, responded, cleanly closed): the mere
launch does NOT trigger materialization (confirmed lazy, not eager at
startup) — `%APPDATA%\com.formulab.app\runtime\pipeline\artifact_naming.py`
is still absent, and `literature_cache.py` there is still the STALE,
pre-fix file. This is expected and does not indicate the fix failed —
it indicates the one remaining proof step genuinely requires a real
click through New Request in the rebuilt app.

**This is a disclosed tooling gap, not a silently skipped
requirement.** The strongest available NATIVE proof without fabricating
UI automation is, in combination: (1) the binary-embedding proof above,
(2) PKG1-PKG5 (the REAL file list, parsed from the REAL shipped
source, is complete against the REAL Python import graph), and (3)
PKG6 (that exact file list, materialized into a genuinely isolated
directory, imports without `ModuleNotFoundError`). The final
confirmation — clicking "Start Formulation Request" in the real,
freshly built app and confirming both a successful generation AND a
refreshed `%APPDATA%\com.formulab.app\runtime\pipeline\` directory
containing `artifact_naming.py` — has been added to this session's
manual acceptance checklist and is NOT claimed as passed here.

### Tracker state

FVL-04 = 26/26 (unchanged). Total = 89/171 (unchanged). FVL-05: NOT
STARTED. No FVL-04.027 or FVL-12 invented — this is a post-closure
regression fix, not new roadmap work.

### Manual user acceptance — PENDING

Not yet performed by the user. See this session's chat response for
the full manual acceptance checklist, including the New Request
click-through item this log's NR1-NR8 section above describes. Claude
has not claimed this passed.

## SESSION CHECKPOINT — WORK INCOMPLETE (2026-08-21, usage-limit forced stop)

User explicitly REJECTED the "disclosed tooling limitation" framing
above for NR1-NR8 and gave a detailed required acceptance strategy
(full text preserved in chat transcript) BEFORE this checkpoint was
forced by an approaching usage limit. Work on that strategy had NOT
yet started when the checkpoint was triggered — no files touched, no
tests written, no refactor attempted for NR1-NR8 beyond what's already
recorded above (PKG1-6, binary-embedding proof).

**Required approach per user (do not deviate without asking):**
- NR1-NR2: real frontend route/component + form-interaction integration
  tests for the New Request page (find the real component first —
  likely under `apps/desktop/src/app/routes/` or
  `apps/desktop/src/components/` — locate the actual "Start Formulation
  Request" button/handler before writing anything).
- NR3: prove the real submit handler reaches the real Tauri
  `invoke("generate_formulation", ...)` call — intercept at that
  boundary in a test (mock `@tauri-apps/api` invoke, a pattern this
  repo likely already uses elsewhere for other Tauri commands — grep
  for existing `vi.mock("@tauri-apps/api"` precedent before inventing
  one), asserting the real command name/payload shape, never a second
  fake bridge.
- NR4-NR6: refactor `generate_formulation` in `formulation_v2.rs`
  MINIMALLY so the AppHandle-dependent path resolution is separated
  from a pure, disposable-root-accepting materialize+launch function
  (production wrapper stays the same; a new Rust `#[test]` calls the
  pure function directly, sidestepping the documented
  `tauri::test::mock_app()` unpredictability at
  `automatic_backup.rs:176` — do NOT use mock_app(); do NOT attempt
  this refactor if inspection reveals an equivalent testable boundary
  already exists elsewhere in the file). Prove artifact_naming.py (and
  the full closure) exists in the disposable materialized dir, then run
  the REAL materialized run_cli.py isolated (PYTHONPATH stripped),
  asserting no ModuleNotFoundError AND that execution progresses past
  import/bootstrap into a real pipeline stage.
- NR7: assert the pipeline's result for a disposable safe request is a
  normal structured outcome (not a raw traceback) — network-dependent
  partial/insufficient results are acceptable, uncaught exceptions are
  not.
- NR8: independently re-verify llm.py stays unreachable after any
  refactor (reuse/extend the existing PKG4 check).
- Explicitly forbidden as "closure": include_str! text alone, PKG
  tests alone, Python pytest alone, successful build alone, generic
  launch smoke alone, doc claims, "user will test later."
- After all 8 pass: rerun affected tests, git diff --check, commit
  logically, push, verify local==remote HEAD, fresh
  `tauri build --no-bundle` from that HEAD, verify exe hash/timestamp,
  verify shortcut, launch smoke, launch the REAL app once and inspect
  the REAL `%APPDATA%\com.formulab.app\runtime\pipeline\` for
  artifact_naming.py (path/mtime/hash) as independent evidence beyond
  the disposable test directory, then update all three external logs
  again.
- If any single NR item genuinely cannot be proven even via this
  split-layer approach: document exactly which one, why, what code
  boundary was inspected, what evidence WAS obtained, and the precise
  remaining manual action — never silently mark it PASS.
- Do NOT write the final 60-item closure report or 34-item manual
  checklist until this NR acceptance work is genuinely finished (or
  explicitly, individually documented as impossible per the rule
  above).
- Do NOT start FVL-05. Tracker stays FVL-04=26/26, Total=89/171,
  FVL-05=NOT STARTED.

**Everything before this checkpoint is real, tested, committed, and
pushed** (local HEAD == remote HEAD == `4fb0e24f7dfc4a3448e3832c4c0db92237931cad`,
verified this session): the packaging fix (commit f568e09) and the
full Connector Management correction (commits 23c474d, fc1e58f,
2aef3c9, 4fb0e24) are genuinely done, tested (shared 1742/1742, desktop
1724/1724, cargo 358/358, python pipeline 378 passed/18 subtests,
tracker validator clean, git diff --check clean), and reflected
honestly in this log and the other two external logs. Only the NR1-NR8
acceptance-strategy work above, and the final report, remain.

**Continuation point:** start by locating the real New Request
page/component and its submit handler (NR1-NR2), and grep this repo
for an existing `@tauri-apps/api` invoke-mocking test convention before
writing NR3's test, so the interception pattern matches how this
codebase already tests other Tauri commands rather than inventing a
new one.

## Session — NR1-NR8 layered acceptance CLOSED with executable evidence (2026-08-21)

**This entry SUPERSEDES the prior "NR1-NR8 disclosed tooling
limitation" section above.** That framing was rejected by the user as
premature — the governing prompt's own fallback ("if UI automation
doesn't exist, use the exact native command/runtime boundary beneath
the button") had not yet been genuinely exhausted at the frontend/
Tauri-boundary/runtime layers. This session did that work.

Starting local HEAD: `4fb0e24f7dfc4a3448e3832c4c0db92237931cad`
Starting remote HEAD: `4fb0e24f7dfc4a3448e3832c4c0db92237931cad` (match)

### Step 1 — real code-path recovery (no guessing)

Read directly, confirmed the exact real chain:

```
NewFormulationRequestPage.tsx submit()
  -> generateFormulation(brief, cfg, formulaCount)   [apps/desktop/src/lib/formulationV2.ts]
  -> call<GenerateResult>("generate_formulation", { request: { brief, provider, model, api_key, n } })
  -> invoke("generate_formulation", { token, request })   [dynamic import of @tauri-apps/api/core]
  -> Rust generate_formulation(app, token, request)   [apps/desktop/src-tauri/src/formulation_v2.rs]
  -> materialize_pipeline(&app) -> materialize_pipeline_to(pipe_dir, skills_dir)
  -> run_pipeline_cli(python, cli, payload)
  -> run_cli.py -> import pipeline -> import literature_cache -> import artifact_naming
```

### NR1/NR2 — reused evidence, not duplicated

`apps/desktop/src/app/routes/NewFormulationRequestPage.test.tsx`
(pre-existing, unchanged this session, 11 tests, all passing) already
proves, against the REAL production component:
- **NR1**: real page renders (`"renders the approved screen's primary
  sections"` — all 5 real section headings, including the real "Start
  Formulation Request" button's existence via later tests).
- **NR2**: real form interaction — button disabled until the
  natural-language request is filled
  (`"keeps Start Formulation Request disabled until the natural-
  language request is filled"`), the example-requests button fills the
  authoritative field, the formula-count control defaults to 3 and
  each of 4-7 can be selected, and the selected count reaches
  `generateFormulation`'s real request payload
  (`"the selected formula count reaches generateFormulation's request
  payload"`, `"defaults to 3 in the request payload when the count is
  never touched"`, `"existing request fields remain intact alongside
  the new count control"`).

Classified as reused evidence per the governing prompt's own
instruction — not rewritten, not duplicated.

### NR3 — PASS (new test, real submit -> real invoke boundary)

New file: `apps/desktop/src/app/routes/NewFormulationRequestPage.nativeBoundary.test.tsx`
(2 tests). Deliberately does NOT mock `@/lib/formulationV2` — the real
`generateFormulation()`/`call()`/`loadProviderConfig()` all run.
Mocks ONLY `@/lib/tauri`'s `isTauri` (forced `true`) and
`@tauri-apps/api/core`'s `invoke`, matching this repo's own
established convention (`migrationRunner.test.ts`'s identical pattern
for other Tauri commands — found by grep before writing this, per
instruction, rather than inventing a new mocking strategy).

- `"clicking Start Formulation Request invokes the exact production
  command name with the real payload shape — no second bridge"`:
  asserts `invoke` was called with command `"generate_formulation"`
  and `{ token: expect.any(String), request: { brief: { target: "A
  gentle sulfate-free shampoo for an oily scalp." }, provider,
  model, api_key, n: 5 } }` — the exact real shape
  `formulationV2.ts` builds.
- `"navigates to the returned session on a real ok response"`: proves
  the real promise chain (invoke -> generateFormulation -> submit()'s
  own status handling) genuinely settles.

Both PASS. `pnpm --filter @formulab/desktop test -- NewFormulationRequestPage`: 13/13 (11 NR1/NR2 + 2 new NR3).

### Rust refactor (NR4-NR8 testability) — architecturally minimal, one authoritative path

`apps/desktop/src-tauri/src/formulation_v2.rs`:
- `materialize_pipeline_to(pipe_dir, skills_dir)` — extracted as the
  ONE authoritative embedded-runtime write-list (the exact same 19-
  entry list, verbatim), decoupled from `AppHandle`. `materialize_pipeline(app)`
  is now a thin wrapper: resolves the two real `AppHandle`-derived
  destinations, then delegates to it.
- `run_pipeline_cli(python, cli, payload)` — extracted as the ONE
  authoritative runtime-launch implementation (spawn, write stdin,
  wait, parse JSON), also `AppHandle`-free. `generate_formulation()`
  calls it with its own real production values, unchanged in effect,
  except this function now explicitly `.env_remove("PYTHONPATH")`
  before spawning — closes a real isolation gap for real end users
  too (`run_cli.py` is fully self-sufficient via its own
  `sys.path.insert`), not merely a test convenience.
- Production `generate_formulation()`'s own auth check
  (`crate::authz::current_actor_app`), business-data directories, and
  overall control flow are otherwise UNCHANGED. No test-only branch,
  no env-var production toggle, no duplicated pipeline, no second
  materialization manifest — verified directly by grepping the file
  for `cfg(test)`/`current_actor_app`/`std::env::var` occurrences
  before commit.
- Deliberately did NOT use `tauri::test::mock_app()` — this crate's
  own documented precedent (`automatic_backup.rs`'s
  `configured_destination_dir()` doc comment) already established that
  `app.path().app_data_dir()` resolves unpredictably under it.

### NR4 — PASS (real materialization function, disposable dir)

`nr4_real_materialization_function_produces_complete_runtime` — calls
the REAL `materialize_pipeline_to()` against a tempdir. Asserts
`artifact_naming.py`/`run_cli.py`/`pipeline.py`/`literature_cache.py`
exist (NR4A-D), `discover.py` exists at the real sibling
`runtime/skills/core/formulation-discovery/` path (NR4E), and
`llm.py` does NOT exist (NR4F). No manual file copying in the test —
the real production function is called directly.

### NR5/NR6/NR7 — PASS (real isolated run_cli.py execution, real structured post-bootstrap outcome)

`nr5_nr6_nr7_real_materialized_run_cli_reaches_structured_post_bootstrap_outcome`
— materializes via the real function into a tempdir, resolves a real
installed Python interpreter (`python`/`python3`/`py`, tried in order,
`AppHandle`-free — deliberately narrower than `kernel::python_bin()`'s
full override/jupyter-env resolution, which is genuinely out of scope
here), then calls the REAL `run_pipeline_cli()` — not
`python -c "import pipeline"` — against the REAL materialized
`run_cli.py`, with `PYTHONPATH` stripped and disposable
library/formulas/sessions/materials directories.

The disposable request's `brief.target` is `"explosive formulation for
demonstration"` — a genuinely, deliberately prohibited target,
deterministically matched by `pipeline.py`'s own `FORBIDDEN` safety-
gate keyword list (`"explosive"`). This is the one early, fully
offline, fully deterministic decision point in `pipeline.run()`
(`safety_decision()`, called before any literature/network access)
that STILL requires the entire first-party import chain — `import
pipeline` at the top of `run_cli.py::main()`, which transitively
imports `literature_cache` -> `artifact_naming` and every other
first-party module — to have already succeeded before it can be
reached at all.

Asserted:
- **NR5**: `run_pipeline_cli()` returns `Ok(...)` — a real structured
  JSON result, never `Err` from an unparseable stdout (which is what a
  raw `ModuleNotFoundError` traceback on stderr with empty/non-JSON
  stdout would produce).
- **NR6**: `result.status == "refused"` AND
  `result.classification == "prohibited_request"` — reaching this
  SPECIFIC, real, documented decision proves execution genuinely
  progressed past import/bootstrap into real pipeline logic, not
  merely that `import pipeline` succeeded.
- **NR7A-D**: the result is parsed JSON (never a raw traceback); the
  status is one of `pipeline.run()`'s own real documented values
  (`"refused"`); a real non-empty human-readable message is present;
  no packaging/bootstrap error text appears anywhere.

Test runtime: part of the 0.5s combined NR4/NR5-7/NR8 run — genuinely
fast and deterministic, no live network dependency, so not flaky.

### NR8 — PASS (zero-LLM, reconfirmed against real materialization output)

`nr8_materialized_runtime_never_includes_llm_py` — enumerates the
REAL materialized directory's actual file list (not source-text regex
— that's PKG4's job, on the Python side) and asserts `llm.py` is
absent. Independently reconfirms NR4F.

### PKG1-PKG6 — still PASS, unmodified in intent

`python -m pytest runtime/pipeline/test_native_packaging_closure.py
runtime/pipeline/test_native_packaging_smoke.py -v`: 6/6. The Rust
refactor's renaming (`materialize_pipeline` -> thin wrapper calling
`materialize_pipeline_to`) does not break PKG1-5's own source-text
regex extraction (`"fn materialize_pipeline"` is a substring match
that still finds `materialize_pipeline_to`'s body first, where the
real write-list loop now lives) — verified empirically, not merely by
reasoning, before commit.

### NR ACCEPTANCE MATRIX

| ID | Requirement | Test file | Exact test name | Result |
|----|---|---|---|---|
| NR1 | Real New Request page renders | `NewFormulationRequestPage.test.tsx` | `renders the approved screen's primary sections` | PASS (reused) |
| NR2 | Real form interaction, count reaches payload | `NewFormulationRequestPage.test.tsx` | `keeps Start Formulation Request disabled...` + `the selected formula count reaches generateFormulation's request payload` | PASS (reused) |
| NR3 | Real submit reaches real `invoke("generate_formulation",...)` | `NewFormulationRequestPage.nativeBoundary.test.tsx` | `clicking Start Formulation Request invokes the exact production command name with the real payload shape — no second bridge` | PASS |
| NR4 | Real materialization function produces complete runtime | `formulation_v2.rs` (`#[cfg(test)] mod tests`) | `nr4_real_materialization_function_produces_complete_runtime` | PASS |
| NR5 | Real materialized `run_cli.py` executes, no ModuleNotFoundError | `formulation_v2.rs` | `nr5_nr6_nr7_real_materialized_run_cli_reaches_structured_post_bootstrap_outcome` | PASS |
| NR6 | Execution passes bootstrap into a real pipeline stage | same test | same test | PASS |
| NR7 | Normal structured outcome, never a raw traceback | same test | same test | PASS |
| NR8 | Zero-LLM preserved after refactor, against real output | `formulation_v2.rs` | `nr8_materialized_runtime_never_includes_llm_py` | PASS |
| APPDATA-REAL-1 | Real `%APPDATA%` runtime refreshed by the rebuilt app | — | — | MANUAL-PENDING (see below) |

### Commits this leg

- `2a3f919` refactor(formulation): make native runtime materialization/launch testable without AppHandle mocking, close NR4-NR8
- `b02e98a` test(formulation): prove New Request reaches the real Tauri generate_formulation command boundary (NR3)

Final local HEAD: `b02e98aa09388323c16d4a9daf98823425e71d51`
Final remote HEAD: `b02e98aa09388323c16d4a9daf98823425e71d51` (match, pushed and independently verified via `git cat-file -s` against 4 key remote blobs before build)

### Full regression gate (all green, this leg)

- `pnpm --filter @formulab/shared test`: 1742/1742 (83 files)
- `pnpm --filter @formulab/shared typecheck`: clean
- `pnpm --filter @formulab/desktop test`: 1726/1726 (167 files — +1 file/+2 tests over the prior checkpoint, from NR3)
- `pnpm --filter @formulab/desktop typecheck`: clean
- `pnpm --filter @formulab/desktop lint`: clean
- `cargo check`: clean
- `cargo test`: 361/361 (358 + 3 new NR4/NR5-7/NR8)
- `python -m pytest runtime/pipeline -q`: 378 passed, 18 subtests passed
- `python scripts/validate_v1_tracker.py`: OK, 171 tasks, no drift
- `git diff --check`: clean
- Connector Management regression (explicit re-run, no regressions found — nothing in this leg touched its own files): `pnpm --filter @formulab/desktop test -- ConnectorManagement.test connectorImportBridge` — 83/83

### Native build from final pushed HEAD

Full detail in `C:\Users\sekip\Desktop\FormuLab-Build-Shortcut-Log.md`
(this session's matching entry). Summary:
- Command: `pnpm --filter @formulab/desktop tauri build --no-bundle`, exit code 0.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
- Size: 24,870,400 bytes
- Modified: 2026-08-21 16:05:17
- SHA256: `7F41E9F56089648431E7D31A3199095861C6DDC996A295D7CA2386185E847936`
- `Desktop\FormuLab.lnk` TargetPath matches exactly — no edit needed.
- Binary-embedding proof (re-verified against THIS fresh binary):
  `grep -ac` for `artifact_naming.py`'s distinctive doc-comment phrase
  -> 1 match; its `sanitize_filename_component` function name -> 3
  matches. The fix is genuinely compiled into this exact shipped
  binary.
- Launch smoke: process launched (pid 15028, then pid 18548 for the
  CDP attempt below), responded, closed cleanly both times.

### APPDATA-REAL-1 — MANUAL-PENDING (both automated avenues genuinely exhausted, not merely asserted)

Per the governing prompt's own ordered preference (A: existing
frontend/native harness; B: existing local command/IPC harness; C: no
fragile mouse automation) — before falling back to C, an additional,
genuine attempt was made that is NEITHER of those and NOT mouse/UI
automation: launched the fresh app with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"`
set, then probed `http://127.0.0.1:9333/json` (the standard Chrome
DevTools Protocol target-list endpoint) to check whether the real
production webview's own JS runtime — and therefore the real
`window.__TAURI__.core.invoke("generate_formulation", ...)` call —
could be reached and driven directly, with zero mouse/coordinate
automation. Result: **not reachable** (`Unable to connect to the
remote server`) — this Tauri/WebView2 build does not honor that
environment variable as configured, and making it do so would require
a `tauri.conf.json`/WebView2 initialization change made SOLELY to
manufacture a test capability (an always-on remote-debugging surface
in a shipped build), which is itself an undesirable production
change, not a "tiny testability seam" — correctly out of scope per
the governing prompt's own instruction not to change production
semantics merely for testing.

No CLI/headless invocation mode exists in `main.rs` (checked). No
existing IPC test harness for Tauri commands exists in this repo
outside the Vitest-level `invoke` mock already used for NR3 (which is
frontend-only — it does not, and structurally cannot, touch the real
native `AppHandle`/`app_data_dir()` resolution NR4-NR8 already proved
correct against a REAL disposable directory).

Inspected `%APPDATA%\com.formulab.app\runtime\pipeline\` after this
session's fresh launch (twice — once plain, once with the CDP flag):
`artifact_naming.py` is still absent; `literature_cache.py`'s mtime is
still `2026-08-21 11:57:14` — the STALE, pre-fix materialization from
before this session's own packaging fix was even built. This is
EXPECTED and does not indicate any defect: `generate_formulation` (and
therefore `materialize_pipeline`) is genuinely lazy, reachable only
through a real IPC call the webview's own JS makes on a real button
click — confirmed by direct code inspection (Step 1 above), not
assumed.

**NR1-NR8 are all independently PASS at the frontend/Tauri-boundary/
runtime layers, each against REAL production code — this narrow,
final, physical-click confirmation is genuinely the only remaining
gap, and is now added to the manual acceptance checklist.**

### Tracker state

FVL-04 = 26/26 (unchanged). Total = 89/171 (unchanged). FVL-05: NOT
STARTED. No FVL-04.027 or FVL-12 invented.

### POST-FVL-04 REGRESSION AND ACCEPTANCE HARDENING — AUTOMATED CLOSURE COMPLETE

MANUAL USER ACCEPTANCE — PENDING (at the time this section was
written). Superseded below.

REAL WINDOWS CLICK-THROUGH APPDATA MATERIALIZATION — MANUAL PENDING
(at the time this section was written). Superseded below.

Claude did not claim either passed at that point. See this session's
chat response for the exact 10-item final manual checklist that was
handed to the user.

## USER MANUAL ACCEPTANCE — PASS (2026-08-21)

The user performed the manual click-through from the 10-item checklist
above, through the real rebuilt native app:

- Launched via `Desktop\FormuLab.lnk`.
- Sidebar confirmed showing only "New Request" (the already-fixed
  duplicate-"New" issue stayed fixed — not retested/reimplemented here,
  per this session's own explicit instruction not to reopen it absent a
  genuine regression).
- Opened New Request.
- Submitted a real request: "anti-dandruff shampoo".
- Formulation Result page rendered successfully.
- 4 real formulation versions rendered with real formula content.
- No `ModuleNotFoundError`.
- No Python traceback.
- Real formulation content visible (not a placeholder/blank state).

This is real, user-performed, user-reported evidence — not fabricated
or inferred by Claude beyond what the user actually demonstrated.

**APPDATA-REAL-1 — PASS.** The real physical click-through the prior
session's own automated evidence (NR1-NR8, all independently PASS)
could not itself trigger — genuinely lazy `materialize_pipeline()`,
reachable only via a real IPC call from a real button click, no safe
automated trigger existed (two exhausted avenues: no existing harness;
a WebView2 remote-debugging probe that this build did not honor,
documented in this log's own prior entry) — has now been performed by
the user and reported successful. The user's own report (4 real
versions rendered, no ModuleNotFoundError, no traceback) is strictly
stronger evidence than a bare `artifact_naming.py` file-existence check
would have been: it proves the full chain (materialize -> run_cli.py
-> pipeline.py -> literature_cache.py -> artifact_naming.py -> real
formulation generation -> real result rendering) actually completed
end-to-end in the real native app, for the real regression this
session's Component 1 fixed.

**REAL WINDOWS NEW REQUEST CLICK-THROUGH — PASS.**

**MANUAL USER ACCEPTANCE FOR THIS REGRESSION — PASS.**

## Session — final FVL-04 reconciliation/hygiene seal (2026-08-21)

Two remaining governance/test-hygiene gaps closed:

**NR5-NR7 fail-closed** — the combined test previously returned early
(silent skip, still green `cargo test`) when no Python interpreter was
found, which could mask the acceptance never having actually run.
Changed to `.expect()` — a missing interpreter now fails the test
loudly with a clear message. `find_test_python()` reused unchanged, no
fake interpreter path added. `cargo test`: 361/361 (Python present on
this machine — the real acceptance genuinely ran and passed both
before and after this change; the fix closes a *risk*, not an active
failure).

**NR3 navigation assertion strengthened** — the second NR3 test's name
("navigates to the returned session...") previously outran its own
assertion (mainly proved the async chain settled). Rewrote
`renderPage()` to mount the real page alongside the real production
route shape (`app/router.tsx`'s own `"formulation-result/:sessionId"`
path, the same convention `FormulationResultPage.test.tsx` already
uses elsewhere), with a marker element rendering the real `:sessionId`
param at that route. The test now asserts a genuine route change to
the exact real destination, carrying the real `session_id` — never a
fabricated router. `pnpm --filter @formulab/desktop test --
NewFormulationRequestPage`: 13/13.

Commits: `2329943`, `0e1ab33`, `123b6ef` (docs reconciliation, see
`FormuLab-Connector-Management-Frontend-Log.md`/tracker for that part's
own detail). Pushed; local HEAD == remote HEAD ==
`123b6efec1459d27a55c6ab57bb5d64c07a41e9b`.

### Full regression gate (all green, this leg)

- `pnpm --filter @formulab/shared test`: 1742/1742
- `pnpm --filter @formulab/shared typecheck`: clean
- `pnpm --filter @formulab/desktop test`: 1726/1726 (167 files)
- `pnpm --filter @formulab/desktop typecheck`: clean
- `pnpm --filter @formulab/desktop lint`: clean
- `python -m pytest runtime/pipeline -q`: 378 passed, 18 subtests passed
- `cargo check`: clean
- `cargo test`: 361/361
- `python scripts/validate_v1_tracker.py`: OK, 171 tasks, no drift
- `git diff --check`: clean (LF/CRLF warnings only)

Fresh native build performed from this final pushed HEAD — full detail
in `C:\Users\sekip\Desktop\FormuLab-Build-Shortcut-Log.md`'s matching
entry (exe SHA256 `596A82D60B34B6E8B32C27D91E9AE8B6B6E21FB5D386964C199CD0A5BA63DFCD`,
2026-08-21 17:14:52, launch smoke PASS, shortcut unchanged/correct).

### Final state verified

- FVL-04 = 26/26. Total = 89/171. FVL-05 = NOT STARTED (0/14). Next =
  FVL-05.001.
- Tracker prose no longer contains ambiguous current-looking
  81/171, 18/26, or 25/26 wording — reconciled with explicit HISTORICAL
  labels (`docs/FORMULAB_V1_TASK_TRACKER.md`).
- Handoff current-state pointer no longer says Connector Management
  frontend is NOT STARTED (`docs/handoffs/FORMULAB_V1_CURRENT.md`).
- NR5-NR7 cannot silently pass without Python.
- NR3's test name and assertion are aligned.
- User's manual New Request click-through: recorded PASS (above).
- APPDATA-REAL-1: recorded PASS (above).
- All tests green, tracker validator green, `git diff --check` green.
- All changes committed and pushed; local HEAD == remote HEAD.
- Fresh native build performed from final HEAD; shortcut verified.
- All three external logs updated.

### FVL-04 FINAL RECONCILIATION — COMPLETE

### POST-FVL-04 REGRESSION ACCEPTANCE — COMPLETE

### MANUAL NEW REQUEST ACCEPTANCE — PASS

### NEXT FROZEN TASK — FVL-05.001 NOT STARTED

FVL-05 was NOT started in this session.
