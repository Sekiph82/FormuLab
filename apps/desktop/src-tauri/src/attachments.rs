// Safe attachment storage for laboratory/stability/corrective-action
// evidence (spec §6): trial observations, deviations, process steps, test
// results, stability results, stability failures, corrective actions.
//
// A file the user picked via the native OS dialog (`workspace::pick_file`)
// is COPIED into the formulation's own `attachments/` folder under a
// generated name — never referenced by its original absolute path. This is
// what "do not store arbitrary absolute paths from the renderer" means at
// the storage layer: an `AttachmentReference.location` is always a path
// relative to `data/formulations/<id>/attachments/`, resolved the same way
// `artifact_file::resolve_under` already resolves every other workspace-
// relative path, so a location string can never escape that folder.
//
// The allow-list below is closed: an extension not listed here (an .exe, a
// .dll, a .sh, a .js) is rejected outright, never merely "not previewed".
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::artifact_file::{mime_for, os_open, resolve_under};

const CATEGORY_EXTENSIONS: &[(&str, &[&str])] = &[
    ("image", &["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "tif", "tiff"]),
    ("pdf", &["pdf"]),
    ("spreadsheet", &["xlsx", "xls", "csv", "tsv", "ods"]),
    ("text_document", &["doc", "docx", "txt", "md", "rtf", "odt"]),
];

fn category_for_extension(ext: &str) -> Option<&'static str> {
    let low = ext.to_ascii_lowercase();
    CATEGORY_EXTENSIONS
        .iter()
        .find(|(_, exts)| exts.contains(&low.as_str()))
        .map(|(cat, _)| *cat)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn formulation_root_dir(app: &AppHandle, formulation_id: &str) -> Result<PathBuf, String> {
    Ok(crate::formulation_v2::project_data_dir(app, "data")?
        .join("formulations")
        .join(crate::formulations::safe_id(formulation_id)?))
}

fn attachments_dir(app: &AppHandle, formulation_id: &str) -> Result<PathBuf, String> {
    let dir = formulation_root_dir(app, formulation_id)?.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Copy a user-picked file into the project and return the metadata an
/// `AttachmentReference` needs. Rejects any extension outside the allow-list
/// and anything that isn't a regular, absolute-path file (a picker result
/// really is absolute; a relative string here would mean the caller is
/// feeding through untrusted renderer text instead of a picker result).
#[tauri::command(async)]
pub async fn copy_attachment_into_project(
    app: AppHandle,
    formulation_id: String,
    source_path: String,
) -> Result<serde_json::Value, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_absolute() {
        return Err("attachment source must be an absolute path chosen via the file picker".into());
    }
    let metadata = std::fs::metadata(&source).map_err(|_| "source file not found".to_string())?;
    if !metadata.is_file() {
        return Err("attachment source is not a regular file".into());
    }

    let original_file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("source file has no usable name")?
        .to_string();
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let category = category_for_extension(&ext).ok_or_else(|| {
        format!(
            "\".{ext}\" is not an allow-listed attachment type — only image, PDF, \
             spreadsheet and text-document files may be attached."
        )
    })?;

    let bytes = std::fs::read(&source).map_err(|e| e.to_string())?;
    let checksum = sha256_hex(&bytes);
    let (mime, _is_text) = mime_for(&ext);

    let stored_id = format!("att-{}", crate::workspace::random_hex(16));
    let stored_name = format!("{stored_id}.{ext}");
    let dir = attachments_dir(&app, &formulation_id)?;
    std::fs::write(dir.join(&stored_name), &bytes).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "location": format!("attachments/{stored_name}"),
        "originalFileName": original_file_name,
        "fileCategory": category,
        "mimeType": mime,
        "sizeBytes": bytes.len() as u64,
        "checksumSha256": checksum,
    }))
}

/// Open a stored attachment with the OS default application. `location` is
/// resolved under the formulation's own folder via the same
/// escape-rejecting resolver every other workspace-relative path uses — a
/// location naming a file outside `attachments/` is refused, not silently
/// widened.
#[tauri::command(async)]
pub async fn open_attachment(app: AppHandle, formulation_id: String, location: String) -> Result<(), String> {
    let root = formulation_root_dir(&app, &formulation_id)?;
    let full = resolve_under(&root, &location)?;
    os_open(&full)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_listed_extensions_map_to_a_category() {
        assert_eq!(category_for_extension("PDF"), Some("pdf"));
        assert_eq!(category_for_extension("jpg"), Some("image"));
        assert_eq!(category_for_extension("xlsx"), Some("spreadsheet"));
        assert_eq!(category_for_extension("docx"), Some("text_document"));
    }

    #[test]
    fn unsupported_extensions_are_rejected() {
        for ext in ["exe", "dll", "sh", "js", "bat", "com", "ps1"] {
            assert_eq!(category_for_extension(ext), None, "{ext} must not be allow-listed");
        }
    }

    #[test]
    fn checksum_is_stable_for_the_same_bytes() {
        let a = sha256_hex(b"formulab attachment");
        let b = sha256_hex(b"formulab attachment");
        let c = sha256_hex(b"a different file");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }
}
