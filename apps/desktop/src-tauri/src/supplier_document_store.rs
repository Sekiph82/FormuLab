//! Immutable content-addressed storage for admitted supplier PDFs.
//!
//! The SHA-256 is both the blob identity and the only path input. Writes use a
//! same-directory temporary file plus no-clobber hard-link publication. An
//! existing hash path is reused only after its bytes are verified; corrupt or
//! symlinked content is never overwritten.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

const MAX_PDF_BYTES: usize = 100 * 1024 * 1024;
const STORE_RELATIVE_ROOT: &str = "supplier-documents/sha256";

#[allow(dead_code)] // Returned to V01-02 provider code for linking acquisition records to stored blobs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredSupplierPdf {
    pub sha256: String,
    pub byte_size: u64,
    /// Relative to the project `data/` root; it never contains user input.
    pub relative_path: String,
    pub deduplicated: bool,
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_hash(value: &str) -> Result<String, String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("supplier document hash is invalid".into());
    }
    Ok(value.to_ascii_lowercase())
}

fn ensure_store_dir(data_root: &Path, digest: &str) -> Result<(PathBuf, PathBuf), String> {
    let base =
        fs::canonicalize(data_root).map_err(|_| "project data root is unavailable".to_string())?;
    let parent = data_root.join(STORE_RELATIVE_ROOT).join(&digest[..2]);
    fs::create_dir_all(&parent)
        .map_err(|_| "supplier document storage is unavailable".to_string())?;
    let canonical_parent = fs::canonicalize(&parent)
        .map_err(|_| "supplier document storage is unavailable".to_string())?;
    if !canonical_parent.starts_with(&base) {
        return Err("supplier document storage path is unsafe".into());
    }
    let blob = canonical_parent.join(format!("{digest}.pdf"));
    Ok((canonical_parent, blob))
}

fn verify_existing(path: &Path, expected_hash: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "existing supplier document blob is unavailable".to_string())?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() as usize > MAX_PDF_BYTES
    {
        return Err("existing supplier document blob failed integrity checks".into());
    }
    let bytes =
        fs::read(path).map_err(|_| "existing supplier document blob is unavailable".to_string())?;
    if sha256_hex(&bytes) != expected_hash || !bytes.starts_with(b"%PDF-") {
        return Err("existing supplier document blob failed integrity checks".into());
    }
    Ok(())
}

fn random_suffix() -> Result<String, String> {
    let mut bytes = [0_u8; 12];
    getrandom::fill(&mut bytes)
        .map_err(|_| "could not allocate supplier document write".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Store a validated PDF beneath the project's data directory. If
/// `expected_sha256` is supplied, it must match the bytes before any write.
pub(crate) fn store_pdf_bytes(
    data_root: &Path,
    bytes: &[u8],
    expected_sha256: Option<&str>,
) -> Result<StoredSupplierPdf, String> {
    if bytes.is_empty() || bytes.len() > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("supplier document bytes are not an admitted PDF".into());
    }
    let digest = sha256_hex(bytes);
    if let Some(expected) = expected_sha256 {
        if normalize_hash(expected)? != digest {
            return Err("supplier document hash does not match its bytes".into());
        }
    }
    let (parent, destination) = ensure_store_dir(data_root, &digest)?;
    if destination.exists() {
        verify_existing(&destination, &digest)?;
        return Ok(StoredSupplierPdf {
            sha256: digest.clone(),
            byte_size: bytes.len() as u64,
            relative_path: format!("{STORE_RELATIVE_ROOT}/{}/{digest}.pdf", &digest[..2]),
            deduplicated: true,
        });
    }

    let temporary = parent.join(format!(".{digest}.tmp-{}", random_suffix()?));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "supplier document storage is unavailable".to_string())?;
        file.write_all(bytes)
            .map_err(|_| "supplier document storage write failed".to_string())?;
        file.sync_all()
            .map_err(|_| "supplier document storage write failed".to_string())?;
        drop(file);

        match fs::hard_link(&temporary, &destination) {
            Ok(()) => Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                verify_existing(&destination, &digest)?;
                Ok(true)
            }
            Err(_) => Err("supplier document storage publication failed".to_string()),
        }
    })();
    let _ = fs::remove_file(&temporary);
    let deduplicated = result?;
    Ok(StoredSupplierPdf {
        sha256: digest.clone(),
        byte_size: bytes.len() as u64,
        relative_path: format!("{STORE_RELATIVE_ROOT}/{}/{digest}.pdf", &digest[..2]),
        deduplicated,
    })
}

/// Store bytes received by a native provider adapter in the active project's
/// private data tree. Callers must use a blocking worker for filesystem I/O.
#[allow(dead_code)]
pub(crate) fn store_pdf_for_app(
    app: &AppHandle,
    bytes: &[u8],
    expected_sha256: Option<&str>,
) -> Result<StoredSupplierPdf, String> {
    let data_root = crate::formulation_v2::project_data_dir(app, "data")?;
    store_pdf_bytes(&data_root, bytes, expected_sha256)
}

/// Read a blob only by its validated content identity and verify it again on
/// every read. No renderer-provided path is accepted.
#[allow(dead_code)] // Consumed by document preview/export work after blob acquisition.
pub(crate) fn read_pdf_bytes(data_root: &Path, sha256: &str) -> Result<Vec<u8>, String> {
    let digest = normalize_hash(sha256)?;
    let base =
        fs::canonicalize(data_root).map_err(|_| "project data root is unavailable".to_string())?;
    let parent = data_root.join(STORE_RELATIVE_ROOT).join(&digest[..2]);
    let canonical_parent = fs::canonicalize(&parent)
        .map_err(|_| "supplier document blob is unavailable".to_string())?;
    if !canonical_parent.starts_with(&base) {
        return Err("supplier document storage path is unsafe".into());
    }
    let path = canonical_parent.join(format!("{digest}.pdf"));
    verify_existing(&path, &digest)?;
    let file =
        File::open(path).map_err(|_| "supplier document blob is unavailable".to_string())?;
    let mut bytes = Vec::new();
    file.take((MAX_PDF_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "supplier document blob is unavailable".to_string())?;
    if bytes.len() > MAX_PDF_BYTES || sha256_hex(&bytes) != digest {
        return Err("supplier document blob failed integrity checks".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_data_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "formulab-v01-docstore-{label}-{}-{}",
            std::process::id(),
            random_suffix().unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn pdf(label: &str) -> Vec<u8> {
        format!("%PDF-1.7\n{label}\n%%EOF\n").into_bytes()
    }

    #[test]
    fn stores_by_sha256_and_deduplicates_identical_bytes() {
        let root = temporary_data_root("dedup");
        let bytes = pdf("same source bytes");
        let first = store_pdf_bytes(&root, &bytes, None).unwrap();
        let second =
            store_pdf_bytes(&root, &bytes, Some(&first.sha256.to_ascii_uppercase())).unwrap();
        assert_eq!(first.sha256, sha256_hex(&bytes));
        assert_eq!(first.byte_size, bytes.len() as u64);
        assert!(first.relative_path.ends_with(&format!(
            "{}/{}.pdf",
            &first.sha256[..2],
            first.sha256
        )));
        assert!(!first.deduplicated);
        assert!(second.deduplicated);
        assert_eq!(read_pdf_bytes(&root, &first.sha256).unwrap(), bytes);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn distinct_revisions_keep_distinct_blobs() {
        let root = temporary_data_root("revisions");
        let old = pdf("revision one");
        let new = pdf("revision two");
        let old_blob = store_pdf_bytes(&root, &old, None).unwrap();
        let new_blob = store_pdf_bytes(&root, &new, None).unwrap();
        assert_ne!(old_blob.sha256, new_blob.sha256);
        assert_eq!(read_pdf_bytes(&root, &old_blob.sha256).unwrap(), old);
        assert_eq!(read_pdf_bytes(&root, &new_blob.sha256).unwrap(), new);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_mismatched_hashes_oversize_input_and_non_pdf_bytes() {
        let root = temporary_data_root("reject");
        assert!(store_pdf_bytes(&root, &pdf("wrong hash"), Some(&"0".repeat(64))).is_err());
        assert!(store_pdf_bytes(&root, b"<html>not a PDF</html>", None).is_err());
        assert!(store_pdf_bytes(&root, &vec![b'x'; MAX_PDF_BYTES + 1], None).is_err());
        let store = root.join(STORE_RELATIVE_ROOT);
        assert!(!store.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_to_overwrite_a_corrupt_existing_content_address() {
        let root = temporary_data_root("corrupt");
        let bytes = pdf("verified content");
        let digest = sha256_hex(&bytes);
        let (parent, destination) = ensure_store_dir(&root, &digest).unwrap();
        fs::write(destination, b"corrupt existing bytes").unwrap();
        assert!(store_pdf_bytes(&root, &bytes, Some(&digest)).is_err());
        assert_eq!(
            fs::read(parent.join(format!("{digest}.pdf"))).unwrap(),
            b"corrupt existing bytes"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_invalid_hash_paths_without_touching_the_store() {
        let root = temporary_data_root("invalid-hash");
        assert!(read_pdf_bytes(&root, "../../outside").is_err());
        assert!(!root.join(STORE_RELATIVE_ROOT).exists());
        fs::remove_dir_all(root).unwrap();
    }
}
