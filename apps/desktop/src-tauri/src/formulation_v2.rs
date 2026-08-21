// FormuLab v2 — direct formulation pipeline (no OpenCode agent loop).
//
// One request/response: the frontend sends a brief + provider/model/key, this
// command runs the bundled Python pipeline (real open-access literature + ONE
// LLM call) on the SAME interpreter the notebook uses (kernel::python_bin), and
// returns v1..vN formulation cards as JSON.
//
// The pipeline package (pure stdlib) is embedded and materialized on first use,
// exactly like formulation.rs, so it is always present regardless of packaging.
// literature_cache.py imports discover.py via a path two levels up, so that file
// is materialized into the sibling skills/core/formulation-discovery/ location it
// expects.
//
// Sessions: only runs that SUCCESSFULLY produce cards are kept. A failed or
// refused run has its (partial) session directory removed so the sessions/ list
// only ever contains real results.
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

// Embedded pipeline package + its one external dependency (discover.py).
const F_PIPELINE: &str = include_str!("../../../../runtime/pipeline/pipeline.py");
const F_CACHE: &str = include_str!("../../../../runtime/pipeline/literature_cache.py");
const F_RULES: &str = include_str!("../../../../runtime/pipeline/rules.py");
const F_REGION: &str = include_str!("../../../../runtime/pipeline/region_profiles.py");
const F_CLI: &str = include_str!("../../../../runtime/pipeline/run_cli.py");
const F_FULLTEXT: &str = include_str!("../../../../runtime/pipeline/fulltext.py");
// Phase 14 Session 1: literature_cache.py now imports canonical_paper.py
// directly (real cross-source dedup with provenance, replacing the old
// discard-based dedup) — it must be materialized alongside it or the
// embedded pipeline fails with ImportError on every real run.
const F_CANONICAL: &str = include_str!("../../../../runtime/pipeline/canonical_paper.py");
// Phase 14 Session 2: pipeline.py now imports evidence.py directly (structured
// evidence extraction/ranking feeding formula synthesis) — same requirement
// as canonical_paper.py above, must be materialized alongside it.
const F_EVIDENCE: &str = include_str!("../../../../runtime/pipeline/evidence.py");
// Phase 14 Session 3: pipeline.py now imports strategy.py directly
// (request-aware multi-alternative synthesis, diversity validation,
// version-specific evidence linking, scoring) — same requirement as
// canonical_paper.py/evidence.py above, must be materialized alongside them.
const F_STRATEGY: &str = include_str!("../../../../runtime/pipeline/strategy.py");
// Phase 14 Session 4: pipeline.py now imports provenance.py directly
// (generation provenance, ingredient-origin classification, deterministic
// mass-balance validation, quality gate) — same requirement as
// canonical_paper.py/evidence.py/strategy.py above.
const F_PROVENANCE: &str = include_str!("../../../../runtime/pipeline/provenance.py");
// Phase 15 zero-LLM round: pipeline.py now imports engine.py (the
// deterministic formulation engine that replaced llm.py::call() in the
// normal generation path) and materials.py (the real supplier/masterdata
// candidate-pool source) directly — same requirement as every module
// above: must be materialized alongside them or the embedded desktop app
// fails with ImportError on every real run.
const F_ENGINE: &str = include_str!("../../../../runtime/pipeline/engine.py");
const F_MATERIALS: &str = include_str!("../../../../runtime/pipeline/materials.py");
const F_MASTER_MATERIALS_ADAPTER: &str =
    include_str!("../../../../runtime/pipeline/master_materials_adapter.py");
// Phase 14 Session 5 (Phase 15 zero-LLM round): pipeline.py now imports
// manufacturing.py directly (Manufacturing Procedure/Critical Parameters/
// Equipment intelligence, zero LLM) — same requirement as every module
// above.
const F_MANUFACTURING: &str = include_str!("../../../../runtime/pipeline/manufacturing.py");
// Phase 14 Session 6: pipeline.py now imports traceability.py (decision-
// trace events) and validation_plan.py (the deterministic validation-plan
// generator) directly — same requirement as every module above.
// FVL-03.009/.010: safety.py/regulatory.py were retired as duplicate
// final-verdict authorities (see docs/FVL03_PLATFORM_INTEGRATION_
// ARCHITECTURE.md's "Safety Engine boundary"/"Regulatory Engine
// boundary") — pipeline.py no longer imports either module, so their
// F_SAFETY/F_REGULATORY embedded-file constants and materialize_pipeline()
// entries are removed here too (found as a real, build-breaking
// `cargo check` failure while closing FVL-03.012 — those two retirement
// sessions correctly made no Rust changes and so never ran `cargo check`
// themselves; fixed here rather than shipped broken).
const F_TRACEABILITY: &str = include_str!("../../../../runtime/pipeline/traceability.py");
const F_VALIDATION_PLAN: &str = include_str!("../../../../runtime/pipeline/validation_plan.py");
const F_SCIENTIFIC_FORMULATION: &str = include_str!("../../../../runtime/pipeline/scientific_formulation.py");
// FormuLab v1 (FVL-02) — pipeline.py now imports architecture_portfolio.py
// directly (the global scientific-architecture portfolio selector) — same
// requirement as every module above: must be materialized alongside them
// or the embedded desktop app fails with ImportError on every real run.
// (Found missing from this list while closing FVL-02.009 — a real,
// pre-existing packaging defect from the session that created the module;
// fixed here rather than shipped broken.)
const F_ARCHITECTURE_PORTFOLIO: &str = include_str!("../../../../runtime/pipeline/architecture_portfolio.py");
// FVL-04.026: literature_cache.py now imports artifact_naming.py directly
// (the deterministic literature/formulation artifact naming convention)
// — same requirement as every module above: must be materialized
// alongside it or the embedded desktop app fails with
// `ModuleNotFoundError: No module named 'artifact_naming'` on every real
// run. Found missing from this list as a real, release-blocking native
// packaging defect (the source-tree Python tests for FVL-04.026 never
// exercised the embedded/materialized runtime, only the importable repo
// tree) — fixed here rather than shipped broken.
const F_ARTIFACT_NAMING: &str = include_str!("../../../../runtime/pipeline/artifact_naming.py");
const F_DISCOVER: &str =
    include_str!("../../../../runtime/skills/core/formulation-discovery/discover.py");

/// Request from the frontend. `brief` is the free-form formulation brief object
/// (target/category/audience/market/…); the rest select the model + key.
#[derive(Deserialize)]
pub struct GenerateRequest {
    pub brief: serde_json::Value,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_n")]
    pub n: u32,
}

fn default_n() -> u32 {
    3
}

/// The project folder everything the user creates lives under:
///
///   <root>/formulas/            the flat library of every formula ever made
///   <root>/data/sessions/       one folder per successful run
///   <root>/data/literature/     the shared paper + PDF cache
///
/// Kept independent of OpenCode's workspace base (which re-roots per run and is
/// going away) so the layout survives that removal. Phase 11 Session 4
/// unified this resolution with `workspace::workspace_dir()` — both now
/// delegate to `data_root::resolve_data_root()`, one precedence chain
/// instead of two; see that module's doc comment.
pub(crate) fn project_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::data_root::resolve_data_root(app)?.path)
}

fn data_dir(app: &AppHandle, sub: &[&str]) -> Result<PathBuf, String> {
    let mut dir = project_root(app)?;
    for s in sub {
        dir = dir.join(s);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// App-private scratch (the materialized Python package) — code, not user data,
/// so it stays out of the user's folder.
fn app_dir(app: &AppHandle, sub: &[&str]) -> Result<PathBuf, String> {
    let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for s in sub {
        dir = dir.join(s);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The app-private directory the Python package is materialized into. Shared
/// with materials.rs, which drops its own scripts beside it so their imports
/// resolve.
pub(crate) fn pipeline_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app_dir(app, &["runtime", "pipeline"])
}

/// A folder under the user's project root (`data`, `formulas`, …).
pub(crate) fn project_data_dir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    data_dir(app, &[name])
}

/// Materialize the pipeline package + discover.py into app-private storage and
/// return the directory holding run_cli.py.
fn materialize_pipeline(app: &AppHandle) -> Result<PathBuf, String> {
    let pipe = pipeline_dir(app)?;
    for (name, src) in [
        ("pipeline.py", F_PIPELINE),
        // llm.py is deliberately NOT embedded here as of the Phase 15
        // zero-LLM round: pipeline.py no longer imports it, and nothing
        // else in this embedded package needs it — the normal
        // formulation-generation path this app ships must not carry a
        // reachable model-call code path at all, not merely an unused one.
        ("literature_cache.py", F_CACHE),
        ("rules.py", F_RULES),
        ("region_profiles.py", F_REGION),
        ("run_cli.py", F_CLI),
        ("fulltext.py", F_FULLTEXT),
        ("canonical_paper.py", F_CANONICAL),
        ("evidence.py", F_EVIDENCE),
        ("strategy.py", F_STRATEGY),
        ("provenance.py", F_PROVENANCE),
        ("engine.py", F_ENGINE),
        ("materials.py", F_MATERIALS),
        ("master_materials_adapter.py", F_MASTER_MATERIALS_ADAPTER),
        ("manufacturing.py", F_MANUFACTURING),
        ("traceability.py", F_TRACEABILITY),
        ("validation_plan.py", F_VALIDATION_PLAN),
        ("scientific_formulation.py", F_SCIENTIFIC_FORMULATION),
        ("architecture_portfolio.py", F_ARCHITECTURE_PORTFOLIO),
        ("artifact_naming.py", F_ARTIFACT_NAMING),
    ] {
        std::fs::write(pipe.join(name), src).map_err(|e| e.to_string())?;
    }
    // literature_cache.py expects discover.py at ../skills/core/formulation-discovery/.
    let disc = app_dir(app, &["runtime", "skills", "core", "formulation-discovery"])?;
    std::fs::write(disc.join("discover.py"), F_DISCOVER).map_err(|e| e.to_string())?;
    Ok(pipe)
}

/// Run the pipeline: materialize, invoke run_cli.py with the request on stdin,
/// return the parsed result JSON. Keeps the session on `status == "ok"` or
/// `"ok_partial_research"` (2026-08-17 correction: a partial research
/// corpus of 10-14 full texts still produces real, saved formula cards —
/// only `"refused"`/`"error"`/`"human_review_required"`/
/// `"research_corpus_incomplete"` remove the session directory).
/// Phase 13 Session 4A: was `DEFERRED_WITH_REASON`. Generates candidate
/// formulas and saves its own session record — not a shared regulated
/// collection, so a valid session (not a specific capability) is the
/// right bar, same as `formulation::run_formulation_optimize`.
#[tauri::command(async)]
pub async fn generate_formulation(
    app: AppHandle,
    token: String,
    request: GenerateRequest,
) -> Result<serde_json::Value, String> {
    crate::authz::current_actor_app(&app, &token)?;
    let pipe = materialize_pipeline(&app)?;
    let cli = pipe.join("run_cli.py");
    let (python, _source) = crate::kernel::python_bin(&app)?;

    let library = data_dir(&app, &["data", "literature"])?; // shared cache + pdfs
    let formulas = data_dir(&app, &["formulas"])?; // flat library of every card
    let sessions = data_dir(&app, &["data", "sessions"])?;
    // FVL-03.002 (single-authority correction): this points at the
    // CANONICAL Material Master `masterdata.rs` owns (`data/master`),
    // read by `master_materials_adapter.py` — deliberately a DIFFERENT
    // directory than `materials.rs`'s own legacy `import_materials`/
    // `list_materials` commands, which still read/write the separate
    // `data/materials.json` for the unrelated Settings -> General
    // CSV-import screen (out of scope here, untouched). Simply has no
    // materials to contribute when the canonical store is empty — never
    // an error (see `engine.py::build_candidate_pool`).
    let materials_root = data_dir(&app, &["data", "master"])?;

    // Python names the session folder (it has date formatting) as
    // YYYY-MM-DD-HHMM-<slug> and reports the path back.
    //
    // `provider`/`model`/`api_key` are still accepted from the frontend
    // (a settings UI carried over from the legacy `/live` flow) but are
    // read and ignored by `run_cli.py` as of the Phase 15 zero-LLM round —
    // the deterministic engine requires no model credential of any kind.
    let payload = serde_json::json!({
        "brief": request.brief,
        "provider": request.provider,
        "model": request.model,
        "api_key": request.api_key,
        "library_dir": library.to_string_lossy(),
        "formulas_dir": formulas.to_string_lossy(),
        "sessions_dir": sessions.to_string_lossy(),
        "materials_dir": materials_root.to_string_lossy(),
        "n": request.n,
    });
    let input_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let mut cmd = crate::workspace::quiet_command(&python);
    cmd.arg(&cli)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch Python: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin on pipeline process")?
        .write_all(input_json.as_bytes())
        .map_err(|e| format!("failed to send request: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("pipeline process error: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    let result: serde_json::Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(_) => {
            let msg = stderr.trim();
            return Err(if msg.is_empty() {
                format!("pipeline produced no result (exit {:?})", out.status.code())
            } else {
                msg.to_string()
            });
        }
    };

    // The session folder is named and reported by Python; a failed or refused
    // run has it removed so only real results are ever listed.
    let session_dir = result
        .get("session_dir")
        .and_then(|s| s.as_str())
        .map(PathBuf::from);
    let status = result.get("status").and_then(|s| s.as_str());
    let ok = matches!(status, Some("ok") | Some("ok_partial_research"));
    if ok {
        Ok(result)
    } else {
        if let Some(dir) = session_dir {
            if dir.starts_with(&sessions) {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        Ok(result) // status: "refused" | "error" | "research_corpus_incomplete" — surfaced to the UI, no session kept
    }
}

/// Read the saved cards of one session directory (sorted v1..vN) — NO model
/// call, ever, opening a past session is read-only. Prefers the structured
/// `cards.json` `pipeline.py::run()` writes (`{version, markdown, formula,
/// violations}` per card, the real generated ingredients/references/
/// violations, not just rendered text); falls back to a markdown-only scan
/// (`version`/`markdown` alone, `formula`/`violations` absent) for sessions
/// written before `cards.json` existed, so old sessions still open instead
/// of erroring, honestly short of their structured data rather than faking it.
fn read_cards(dir: &std::path::Path) -> Vec<serde_json::Value> {
    if let Ok(raw) = std::fs::read_to_string(dir.join("cards.json")) {
        if let Ok(serde_json::Value::Array(cards)) = serde_json::from_str(&raw) {
            if !cards.is_empty() {
                return cards;
            }
        }
    }
    read_cards_from_markdown(dir)
}

fn read_cards_from_markdown(dir: &std::path::Path) -> Vec<serde_json::Value> {
    let mut files: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| {
                        n.ends_with(".md")
                            // current: Formulation_Card_<session>_v1.md
                            && (n.starts_with("Formulation_Card_")
                                // sessions written before the rename
                                || n.starts_with("formulation-card-v"))
                    })
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => return Vec::new(),
    };
    files.sort();
    files
        .iter()
        .filter_map(|p| {
            let stem = p.file_name().and_then(|n| n.to_str())?.trim_end_matches(".md");
            // The version is the trailing "v<N>" segment under either scheme.
            let version = stem
                .rsplit(['_', '-'])
                .next()
                .filter(|s| {
                    s.starts_with('v') && s.len() > 1 && s[1..].chars().all(|c| c.is_ascii_digit())
                })
                .unwrap_or("v?")
                .to_string();
            let md = std::fs::read_to_string(p).ok()?;
            Some(serde_json::json!({ "version": version, "markdown": md }))
        })
        .collect()
}

/// brief.json's own top-level shape is `{brief: {...}, constraints_reasons:
/// [...]}` (written by `pipeline.py::run()`) — every caller wants the inner
/// `brief` object (what the frontend's `SessionDetail.brief`/`SessionSummary.
/// brief` types expect), never the wrapper. Shared by `list_sessions` and
/// `read_session` so this unwrap only lives in one place.
fn read_brief(dir: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(dir.join("brief.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("brief").cloned())
        .unwrap_or(serde_json::Value::Null)
}

/// List saved sessions (successful runs only — failed ones were never kept),
/// newest first. Each entry carries enough for the sidebar without re-running.
#[tauri::command(async)]
pub async fn list_sessions(app: AppHandle, token: String) -> Result<serde_json::Value, String> {
    crate::authz::current_actor_app(&app, &token)?;
    let sessions = data_dir(&app, &["data", "sessions"])?;
    let mut items: Vec<serde_json::Value> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&sessions) {
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            // Ids start with "YYYY-MM-DD-HHMM", which sorts chronologically as
            // text — so the name itself is the sort key, newest first.
            let created: String = id.chars().take(15).collect();
            let brief = read_brief(&path);
            let card_count = read_cards(&path).len();
            if card_count == 0 {
                continue; // not a real result — skip
            }
            items.push(serde_json::json!({
                "id": id,
                "created": created,
                "brief": brief,
                "card_count": card_count,
            }));
        }
    }
    items.sort_by(|a, b| {
        b.get("id")
            .and_then(|v| v.as_str())
            .cmp(&a.get("id").and_then(|v| v.as_str()))
    });
    Ok(serde_json::Value::Array(items))
}

/// Open one session read-only: return its brief + saved cards. No LLM call.
#[tauri::command(async)]
pub async fn read_session(
    app: AppHandle,
    token: String,
    id: String,
) -> Result<serde_json::Value, String> {
    crate::authz::current_actor_app(&app, &token)?;
    // Guard against path traversal: the id must be a single path component.
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("invalid session id".into());
    }
    let dir = data_dir(&app, &["data", "sessions"])?.join(&id);
    if !dir.is_dir() {
        return Err(format!("session not found: {id}"));
    }
    Ok(serde_json::json!({
        "status": "ok",
        "id": id,
        "brief": read_brief(&dir),
        "cards": read_cards(&dir),
        "literature": read_literature(&dir),
        "scientific_formulations": read_scientific_formulations(&dir),
        "read_only": true,
    }))
}

/// FormuLab v1 correction (FVL-03) — the session's real, complete
/// scientific formulations (`{formulations:[...], outcomes:[...]}`) and
/// their session-wide usage summary, read back the same generic
/// `serde_json::Value` passthrough way `read_literature` already reads
/// `papers.json`. `null`/absent fields (never an error) for a session
/// written before this correction existed.
fn read_scientific_formulations(dir: &std::path::Path) -> serde_json::Value {
    let extraction = std::fs::read_to_string(dir.join("literature").join("scientific_formulations.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({"formulations": [], "outcomes": []}));
    let summary = std::fs::read_to_string(dir.join("literature").join("scientific_formulation_summary.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    serde_json::json!({
        "formulations": extraction.get("formulations").cloned().unwrap_or(serde_json::Value::Array(Vec::new())),
        "outcomes": extraction.get("outcomes").cloned().unwrap_or(serde_json::Value::Array(Vec::new())),
        "summary": summary,
    })
}

/// Phase 14 Session 4: the session's real research corpus —
/// `literature_cache.gather()` already writes `literature/papers.json`
/// (every field per document: source_db/title/year/authors/venue/doi/
/// is_oa/oa_url/cited_by/concepts/pdf_file/fulltext/unique_source_count/
/// provenance_sources) for every session that reached literature
/// retrieval — this just reads it back verbatim, the same generic
/// `serde_json::Value` passthrough `read_cards`/`read_brief` already use.
/// Empty array (never an error) for a session written before this field
/// existed, or one whose literature step failed/was skipped.
fn read_literature(dir: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(dir.join("literature").join("papers.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or(serde_json::Value::Array(Vec::new()))
}

/// Delete one saved session.
#[tauri::command(async)]
pub async fn delete_session(app: AppHandle, token: String, id: String) -> Result<(), String> {
    crate::authz::current_actor_app(&app, &token)?;
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("invalid session id".into());
    }
    let dir = data_dir(&app, &["data", "sessions"])?.join(&id);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real bug this fix addresses: `read_session`'s Formula tab showed
    /// 0 ingredients on every reopened session because `read_cards` only
    /// ever scanned markdown files (`{version, markdown}`), discarding the
    /// structured `formula`/`violations` `pipeline.py::run()` actually
    /// produces. `cards.json` (added alongside this test) is what fixes it.
    #[test]
    fn read_cards_prefers_structured_cards_json_over_markdown_scan() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        let cards = serde_json::json!([
            {
                "version": "v1",
                "markdown": "# Formulation Card: Test",
                "formula": {
                    "name": "Test Formula",
                    "ingredients": [
                        {"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                        {"inci": "Decyl Glucoside", "function": "Surfactant", "weight_pct": "12.0"},
                    ],
                },
                "violations": [],
            }
        ]);
        std::fs::write(tmp.join("cards.json"), serde_json::to_string(&cards).unwrap()).unwrap();

        let result = read_cards(&tmp);
        assert_eq!(result.len(), 1);
        let ingredients = result[0]["formula"]["ingredients"].as_array().unwrap();
        assert_eq!(ingredients.len(), 2, "real ingredients must survive a reopen, not be dropped");
        assert_eq!(result[0]["violations"].as_array().unwrap().len(), 0);

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// FormuLab v1 (FVL-02) — `read_cards` is a generic `serde_json::Value`
    /// passthrough with no fixed struct/enum for the version set, so a
    /// session with the new 3-7 alternative count must round-trip exactly
    /// as-is: proven directly here with a real 7-card `cards.json`, not
    /// just asserted from the (accurate) claim that the code has no
    /// `V1`/`V2`/`V3`-only branch.
    #[test]
    fn read_cards_round_trips_all_seven_alternatives() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        let cards: Vec<serde_json::Value> = (1..=7)
            .map(|i| {
                serde_json::json!({
                    "version": format!("v{i}"),
                    "markdown": format!("# Formulation Card: V{i}"),
                    "formula": {"name": format!("Version {i}"), "ingredients": [
                        {"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                    ]},
                    "violations": [],
                })
            })
            .collect();
        std::fs::write(tmp.join("cards.json"), serde_json::to_string(&cards).unwrap()).unwrap();

        let result = read_cards(&tmp);
        assert_eq!(result.len(), 7, "all 7 alternatives must survive a reopen — none dropped, none fabricated");
        for (i, c) in result.iter().enumerate() {
            assert_eq!(c["version"], format!("v{}", i + 1));
        }

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// Phase 14 Session 3 added `strategy`/`status`/`evidence_links`/`score`/
    /// `concentration_alignment` fields to NEW cards.json entries — this
    /// proves an OLDER session's cards.json (Session 1/2 shape, none of
    /// those keys present) still reads through `read_cards` completely
    /// unchanged: `read_cards` is a generic `serde_json::Value` passthrough,
    /// never a fixed struct, so no Rust code needed to change for this.
    #[test]
    fn read_cards_tolerates_a_pre_session_3_card_missing_strategy_fields() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        let cards = serde_json::json!([
            {
                "version": "v1",
                "markdown": "# Formulation Card: Legacy",
                "formula": {"name": "Legacy Formula", "ingredients": [
                    {"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                ]},
                "violations": [],
            }
        ]);
        std::fs::write(tmp.join("cards.json"), serde_json::to_string(&cards).unwrap()).unwrap();

        let result = read_cards(&tmp);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["formula"]["name"], "Legacy Formula");
        assert!(result[0].get("strategy").is_none(), "no strategy field on a pre-Session-3 card — must not be fabricated");
        assert!(result[0].get("status").is_none());

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// Sessions written before `cards.json` existed must still open — short
    /// of structured `formula`/`violations` data (honestly absent, per this
    /// codebase's no-fabrication rule), never an error.
    #[test]
    fn read_cards_falls_back_to_markdown_scan_when_cards_json_is_absent() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(
            tmp.join("Formulation_Card_2026-01-01-0000-test_v1.md"),
            "# Formulation Card: Legacy",
        )
        .unwrap();

        let result = read_cards(&tmp);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["version"], "v1");
        assert!(result[0].get("formula").is_none(), "legacy sessions have no structured formula — must not fabricate one");

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// The other real bug this fix addresses: `read_session` returned
    /// brief.json's whole `{brief, constraints_reasons}` wrapper instead of
    /// the inner `brief` object, so the Original Request banner always
    /// showed "unavailable" even though the exact request was on disk.
    #[test]
    fn read_brief_unwraps_the_inner_brief_object() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        let on_disk = serde_json::json!({
            "brief": {"target": "A sulfate-free anti-dandruff shampoo.", "category": "hairCare"},
            "constraints_reasons": ["some reason"],
        });
        std::fs::write(tmp.join("brief.json"), serde_json::to_string(&on_disk).unwrap()).unwrap();

        let brief = read_brief(&tmp);
        assert_eq!(brief["target"], "A sulfate-free anti-dandruff shampoo.");
        assert_eq!(brief["category"], "hairCare");
        assert!(brief.get("constraints_reasons").is_none(), "must not leak the wrapper's sibling key");

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn read_brief_is_null_when_brief_json_is_missing() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        assert!(read_brief(&tmp).is_null());
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// Phase 14 Session 4: the Evidence & Sources tab's real research
    /// corpus comes from `literature/papers.json` — `literature_cache.
    /// gather()` already writes this for every session; `read_literature`
    /// just passes it through.
    #[test]
    fn read_literature_returns_the_real_research_corpus() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        let lit = tmp.join("literature");
        std::fs::create_dir_all(&lit).unwrap();
        let papers = serde_json::json!([
            {"source_db": "openalex", "title": "A real paper", "year": 2021, "doi": "10.1/x",
             "is_oa": true, "pdf_file": "x.md", "unique_source_count": 2,
             "provenance_sources": ["openalex", "crossref"]},
        ]);
        std::fs::write(lit.join("papers.json"), serde_json::to_string(&papers).unwrap()).unwrap();

        let result = read_literature(&tmp);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["title"], "A real paper");
        assert_eq!(arr[0]["unique_source_count"], 2);

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// A session written before this field existed (or whose literature
    /// step never ran) must not error — an empty corpus, never a crash.
    #[test]
    fn read_literature_is_an_empty_array_when_papers_json_is_missing() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        let result = read_literature(&tmp);
        assert_eq!(result.as_array().unwrap().len(), 0);
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// FormuLab v1 correction (FVL-03) — the real, extracted scientific
    /// formulations and their session-wide usage summary round-trip
    /// through `read_scientific_formulations`.
    #[test]
    fn read_scientific_formulations_returns_the_real_extraction_and_summary() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        let lit = tmp.join("literature");
        std::fs::create_dir_all(&lit).unwrap();
        let extraction = serde_json::json!({
            "formulations": [{"id": "cp1:F1", "source_formulation_id": "F1", "ingredients": []}],
            "outcomes": [{"source_formulation_id": "F1", "metric": "pH", "value": 5.5}],
        });
        std::fs::write(lit.join("scientific_formulations.json"), serde_json::to_string(&extraction).unwrap()).unwrap();
        let summary = serde_json::json!({"extracted_count": 1, "with_outcomes_count": 1});
        std::fs::write(lit.join("scientific_formulation_summary.json"), serde_json::to_string(&summary).unwrap()).unwrap();

        let result = read_scientific_formulations(&tmp);
        assert_eq!(result["formulations"].as_array().unwrap().len(), 1);
        assert_eq!(result["formulations"][0]["source_formulation_id"], "F1");
        assert_eq!(result["outcomes"].as_array().unwrap().len(), 1);
        assert_eq!(result["summary"]["extracted_count"], 1);

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// A pre-correction session (no scientific-formulation files at all)
    /// must not error — empty arrays and a null summary, never a crash.
    #[test]
    fn read_scientific_formulations_degrades_safely_when_absent() {
        let tmp = std::env::temp_dir().join(format!("formulab-test-{}", uuid_like()));
        std::fs::create_dir_all(&tmp).unwrap();
        let result = read_scientific_formulations(&tmp);
        assert_eq!(result["formulations"].as_array().unwrap().len(), 0);
        assert_eq!(result["outcomes"].as_array().unwrap().len(), 0);
        assert!(result["summary"].is_null());
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// A tiny process-unique suffix so parallel `cargo test` runs never
    /// collide on the same temp directory name — this module has no other
    /// dependency worth pulling in a real UUID crate for.
    fn uuid_like() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        format!("{nanos}-{:?}", std::thread::current().id())
    }
}
