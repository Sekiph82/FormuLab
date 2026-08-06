// Phase 11 Session 9 — update checker (check-only).
//
// Fetches release metadata from ONE configurable HTTPS endpoint (the
// caller supplies it; this module enforces HTTPS regardless of source),
// validates it structurally, and reports whether a build exists for the
// current platform/architecture — informational only, never downloaded.
// Does not download, verify, or execute an installer; automatic update
// installation and rollback are explicitly Phase 12 scope, not this one.
//
// Version comparison (newer/same/older), ignored-version handling, and
// scheduling all live on the TypeScript side (`apps/desktop/src/lib/update.ts`)
// — this module's job stops at "is this response safe and well-formed,"
// matching this project's existing split (Rust validates/fetches,
// TypeScript decides what to show).
use std::io::Read;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// The one real, currently-used release-metadata source (GitHub's own
/// Releases API) — a caller may override this per-check, but every
/// override is still required to be HTTPS, checked in `fetch_release_metadata_bytes`.
pub const DEFAULT_RELEASE_METADATA_URL: &str =
    "https://api.github.com/repos/Sekiph82/FormuLab/releases/latest";

/// Release metadata is a small JSON document (a tag, a URL, a changelog
/// paragraph, an asset list) — never legitimately large. Bounds both the
/// `Content-Length` pre-check and the actual bytes read, so a
/// misconfigured or malicious endpoint can't make this module buffer an
/// unbounded response.
const MAX_RESPONSE_BYTES: u64 = 1_048_576; // 1 MB
const REQUEST_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseMetadata {
    pub version: String,
    pub url: String,
    pub name: Option<String>,
    pub published_at: Option<String>,
    pub notes: Option<String>,
    /// Whether a release asset name matches this build's OS/architecture
    /// — informational only; the app never downloads or inspects the
    /// asset's actual bytes.
    pub platform_supported: bool,
    pub matched_asset_name: Option<String>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
}

#[derive(Deserialize)]
struct GitHubReleaseResponse {
    tag_name: Option<String>,
    html_url: Option<String>,
    name: Option<String>,
    published_at: Option<String>,
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
    draft: Option<bool>,
    prerelease: Option<bool>,
}

pub(crate) fn is_https_url(url: &str) -> bool {
    url.trim().to_ascii_lowercase().starts_with("https://")
}

/// Bounds a response length (from either a `Content-Length` header or an
/// actually-read buffer) against `MAX_RESPONSE_BYTES` — one check, used
/// twice (pre-flight and post-read) so a response can never slip through
/// on a missing or lying header.
pub(crate) fn enforce_size_limit(len: u64) -> Result<(), String> {
    if len > MAX_RESPONSE_BYTES {
        Err(format!(
            "release metadata response too large ({len} bytes, limit {MAX_RESPONSE_BYTES})"
        ))
    } else {
        Ok(())
    }
}

/// Loose, substring-based platform/architecture keyword sets — good
/// enough to tell a user "there's a build for your platform" from an
/// asset's file name alone, never a guarantee. An unrecognized OS
/// (`os_kw` empty) never claims a match.
fn platform_keywords(os: &str, arch: &str) -> (Vec<&'static str>, Vec<&'static str>) {
    let os_kw: Vec<&'static str> = match os {
        "windows" => vec!["windows", "win64", "win-x64", ".msi", ".exe"],
        "macos" => vec!["macos", "darwin", "mac", ".dmg"],
        "linux" => vec!["linux", ".appimage", ".deb", ".rpm"],
        _ => vec![],
    };
    let arch_kw: Vec<&'static str> = match arch {
        "x86_64" => vec!["x64", "x86_64", "amd64"],
        "aarch64" => vec!["arm64", "aarch64"],
        _ => vec![],
    };
    (os_kw, arch_kw)
}

pub(crate) fn find_platform_asset<'a>(names: &'a [String], os: &str, arch: &str) -> Option<&'a str> {
    let (os_kw, arch_kw) = platform_keywords(os, arch);
    if os_kw.is_empty() {
        return None;
    }
    names.iter().find(|name| {
        let lower = name.to_ascii_lowercase();
        os_kw.iter().any(|k| lower.contains(k)) && (arch_kw.is_empty() || arch_kw.iter().any(|k| lower.contains(k)))
    }).map(|s| s.as_str())
}

/// Pure parse + structural validation — no network, no `AppHandle`,
/// directly unit-testable against fixture JSON bytes.
pub(crate) fn parse_release_metadata(body: &[u8], os: &str, arch: &str) -> Result<ReleaseMetadata, String> {
    enforce_size_limit(body.len() as u64)?;

    let parsed: GitHubReleaseResponse =
        serde_json::from_slice(body).map_err(|e| format!("release metadata was not valid JSON: {e}"))?;

    if parsed.draft.unwrap_or(false) || parsed.prerelease.unwrap_or(false) {
        return Err("latest listed release is a draft or prerelease — skipped".to_string());
    }

    let version = parsed
        .tag_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("release metadata was missing a version tag")?
        .to_string();
    let url = parsed
        .html_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("release metadata was missing a release URL")?
        .to_string();
    if !is_https_url(&url) {
        return Err("release URL was not HTTPS".to_string());
    }

    let asset_names: Vec<String> = parsed.assets.iter().map(|a| a.name.clone()).collect();
    let matched = find_platform_asset(&asset_names, os, arch);

    Ok(ReleaseMetadata {
        version,
        url,
        name: parsed.name.filter(|s| !s.trim().is_empty()),
        published_at: parsed.published_at.filter(|s| !s.trim().is_empty()),
        notes: parsed.body.filter(|s| !s.trim().is_empty()),
        platform_supported: matched.is_some(),
        matched_asset_name: matched.map(|s| s.to_string()),
    })
}

fn fetch_release_metadata_bytes(endpoint: &str) -> Result<Vec<u8>, String> {
    if !is_https_url(endpoint) {
        return Err("the update endpoint must be an HTTPS URL".to_string());
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent("FormuLab update checker")
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("could not create HTTP client: {e}"))?;

    let response = client
        .get(endpoint)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| {
            if e.is_timeout() {
                "timed out contacting the update server — you may be offline".to_string()
            } else if e.is_connect() {
                "could not connect to the update server — you may be offline".to_string()
            } else {
                format!("could not fetch release metadata: {e}")
            }
        })?
        .error_for_status()
        .map_err(|e| format!("update server returned an error: {e}"))?;

    if let Some(len) = response.content_length() {
        enforce_size_limit(len)?;
    }

    let mut buf = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("could not read release metadata response: {e}"))?;
    enforce_size_limit(buf.len() as u64)?;
    Ok(buf)
}

/// Checks `endpoint` for the latest published release. Never downloads or
/// executes anything beyond this one metadata document.
#[tauri::command(async)]
pub async fn check_for_update(endpoint: String) -> Result<ReleaseMetadata, String> {
    let endpoint = if endpoint.trim().is_empty() {
        DEFAULT_RELEASE_METADATA_URL.to_string()
    } else {
        endpoint
    };
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fetch_release_metadata_bytes(&endpoint)?;
        parse_release_metadata(&bytes, std::env::consts::OS, std::env::consts::ARCH)
    })
    .await
    .map_err(|e| format!("update check task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release_json() -> String {
        r##"{
  "tag_name": "v0.5.0",
  "html_url": "https://github.com/Sekiph82/FormuLab/releases/tag/v0.5.0",
  "name": "FormuLab v0.5.0",
  "published_at": "2026-08-06T10:00:00Z",
  "body": "Changelog: fixed things",
  "assets": [{"name": "FormuLab_0.5.0_x64-setup.exe"}, {"name": "FormuLab_0.5.0_amd64.deb"}],
  "draft": false,
  "prerelease": false
}"##
            .to_string()
    }

    #[test]
    fn is_https_url_accepts_only_https() {
        assert!(is_https_url("https://example.com/releases.json"));
        assert!(is_https_url("HTTPS://Example.com"));
        assert!(!is_https_url("http://example.com/releases.json"));
        assert!(!is_https_url("ftp://example.com"));
        assert!(!is_https_url(""));
    }

    #[test]
    fn enforce_size_limit_rejects_only_over_the_cap() {
        assert!(enforce_size_limit(MAX_RESPONSE_BYTES).is_ok());
        assert!(enforce_size_limit(MAX_RESPONSE_BYTES + 1).is_err());
    }

    #[test]
    fn find_platform_asset_matches_os_and_arch_by_filename() {
        let names = vec!["FormuLab_0.5.0_x64-setup.exe".to_string(), "FormuLab_0.5.0_amd64.deb".to_string()];
        assert_eq!(find_platform_asset(&names, "windows", "x86_64"), Some("FormuLab_0.5.0_x64-setup.exe"));
        assert_eq!(find_platform_asset(&names, "linux", "x86_64"), Some("FormuLab_0.5.0_amd64.deb"));
        assert_eq!(find_platform_asset(&names, "macos", "x86_64"), None);
    }

    #[test]
    fn find_platform_asset_never_claims_a_match_for_an_unknown_os() {
        let names = vec!["FormuLab_0.5.0_x64-setup.exe".to_string()];
        assert_eq!(find_platform_asset(&names, "some-future-os", "x86_64"), None);
    }

    #[test]
    fn parse_release_metadata_accepts_a_well_formed_response() {
        let body = release_json();
        let meta = parse_release_metadata(body.as_bytes(), "windows", "x86_64").unwrap();
        assert_eq!(meta.version, "v0.5.0");
        assert_eq!(meta.url, "https://github.com/Sekiph82/FormuLab/releases/tag/v0.5.0");
        assert!(meta.platform_supported);
        assert_eq!(meta.matched_asset_name.as_deref(), Some("FormuLab_0.5.0_x64-setup.exe"));
        assert!(meta.notes.unwrap().contains("Changelog"));
    }

    #[test]
    fn parse_release_metadata_reports_no_platform_match_honestly() {
        let body = release_json();
        let meta = parse_release_metadata(body.as_bytes(), "macos", "aarch64").unwrap();
        assert!(!meta.platform_supported);
        assert!(meta.matched_asset_name.is_none());
    }

    #[test]
    fn parse_release_metadata_rejects_a_missing_version() {
        let body = r#"{"html_url": "https://example.com/v1", "assets": []}"#;
        let err = parse_release_metadata(body.as_bytes(), "windows", "x86_64").unwrap_err();
        assert!(err.contains("missing a version"), "{err}");
    }

    #[test]
    fn parse_release_metadata_rejects_a_missing_url() {
        let body = r#"{"tag_name": "v1.0.0", "assets": []}"#;
        let err = parse_release_metadata(body.as_bytes(), "windows", "x86_64").unwrap_err();
        assert!(err.contains("missing a release URL"), "{err}");
    }

    #[test]
    fn parse_release_metadata_rejects_a_non_https_release_url() {
        let body = r#"{"tag_name": "v1.0.0", "html_url": "http://example.com/v1", "assets": []}"#;
        let err = parse_release_metadata(body.as_bytes(), "windows", "x86_64").unwrap_err();
        assert!(err.contains("HTTPS"), "{err}");
    }

    #[test]
    fn parse_release_metadata_rejects_malformed_json() {
        let err = parse_release_metadata(b"not json at all", "windows", "x86_64").unwrap_err();
        assert!(err.contains("not valid JSON"), "{err}");
    }

    #[test]
    fn parse_release_metadata_skips_a_draft_or_prerelease() {
        let draft = release_json().replace("\"draft\": false", "\"draft\": true");
        let err = parse_release_metadata(draft.as_bytes(), "windows", "x86_64").unwrap_err();
        assert!(err.contains("draft or prerelease"), "{err}");
    }

    #[test]
    fn parse_release_metadata_rejects_an_oversized_response() {
        let huge = vec![b'a'; (MAX_RESPONSE_BYTES + 10) as usize];
        let err = parse_release_metadata(&huge, "windows", "x86_64").unwrap_err();
        assert!(err.contains("too large"), "{err}");
    }

    #[test]
    fn parse_release_metadata_treats_empty_optional_fields_as_absent() {
        let body = r#"{"tag_name": "v1.0.0", "html_url": "https://example.com/v1", "name": "  ", "body": "", "assets": []}"#;
        let meta = parse_release_metadata(body.as_bytes(), "windows", "x86_64").unwrap();
        assert!(meta.name.is_none());
        assert!(meta.notes.is_none());
    }

    #[test]
    fn fetch_release_metadata_bytes_refuses_a_non_https_endpoint_before_any_request() {
        let err = fetch_release_metadata_bytes("http://example.com/releases.json").unwrap_err();
        assert!(err.contains("HTTPS"), "{err}");
    }
}
