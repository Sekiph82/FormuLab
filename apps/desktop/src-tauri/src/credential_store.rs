//! OS-backed storage for supplier credentials and user-attended portal sessions.
//!
//! Only opaque references may enter connector records. Secret values are
//! accepted at the native command boundary, written to the operating-system
//! credential store, and never returned to the renderer or included in logs.

use keyring::Entry;
use tauri::AppHandle;
use zeroize::Zeroizing;

use crate::authz;

const KEYRING_SERVICE: &str = "com.formulab.app.connector";
const REFERENCE_PREFIX: &str = "formulab-credential:v1:";
const MAX_SECRET_BYTES: usize = 64 * 1024;

trait CredentialBackend: Send + Sync {
    fn set(&self, reference: &str, secret: &str) -> Result<(), ()>;
    fn get(&self, reference: &str) -> Result<Zeroizing<String>, ()>;
    fn delete(&self, reference: &str) -> Result<(), ()>;
}

struct OsCredentialBackend;

impl CredentialBackend for OsCredentialBackend {
    fn set(&self, reference: &str, secret: &str) -> Result<(), ()> {
        Entry::new(KEYRING_SERVICE, reference)
            .map_err(|_| ())?
            .set_password(secret)
            .map_err(|_| ())
    }

    fn get(&self, reference: &str) -> Result<Zeroizing<String>, ()> {
        let secret = Entry::new(KEYRING_SERVICE, reference)
            .map_err(|_| ())?
            .get_password()
            .map_err(|_| ())?;
        Ok(Zeroizing::new(secret))
    }

    fn delete(&self, reference: &str) -> Result<(), ()> {
        Entry::new(KEYRING_SERVICE, reference)
            .map_err(|_| ())?
            .delete_credential()
            .map_err(|_| ())
    }
}

fn validate_reference(reference: &str) -> Result<(), ()> {
    let suffix = reference.strip_prefix(REFERENCE_PREFIX).ok_or(())?;
    if suffix.len() != 32 || !suffix.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(());
    }
    Ok(())
}

fn new_reference() -> Result<String, ()> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| ())?;
    let mut suffix = String::with_capacity(32);
    for byte in random {
        use std::fmt::Write;
        write!(&mut suffix, "{byte:02x}").map_err(|_| ())?;
    }
    Ok(format!("{REFERENCE_PREFIX}{suffix}"))
}

fn store_with(backend: &dyn CredentialBackend, secret: Zeroizing<String>) -> Result<String, ()> {
    if secret.is_empty() || secret.len() > MAX_SECRET_BYTES {
        return Err(());
    }
    let reference = new_reference()?;
    backend.set(&reference, secret.as_str())?;
    Ok(reference)
}

fn delete_with(backend: &dyn CredentialBackend, reference: &str) -> Result<(), ()> {
    validate_reference(reference)?;
    backend.delete(reference)
}

/// Save a manually entered supplier credential or session token in the OS
/// credential manager. The returned value is an opaque reference only.
#[tauri::command(async)]
pub async fn store_connector_credential(
    app: AppHandle,
    token: String,
    secret: String,
) -> Result<String, String> {
    let secret = Zeroizing::new(secret);
    authz::authorize_app(&app, &token, "dataExchange", "create")?;
    if secret.is_empty() || secret.len() > MAX_SECRET_BYTES {
        return Err("credential must be non-empty and at most 64 KiB".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        store_with(&OsCredentialBackend, secret)
            .map_err(|_| "OS credential storage is unavailable".to_string())
    })
    .await
    .map_err(|_| "OS credential storage is unavailable".to_string())?
}

/// Remove an OS credential by its validated opaque reference. The secret is
/// never loaded into the renderer.
#[tauri::command(async)]
pub async fn delete_connector_credential(
    app: AppHandle,
    token: String,
    credential_ref: String,
) -> Result<(), String> {
    authz::authorize_app(&app, &token, "dataExchange", "create")?;
    validate_reference(&credential_ref)
        .map_err(|_| "credential reference is invalid".to_string())?;
    tauri::async_runtime::spawn_blocking(move || delete_with(&OsCredentialBackend, &credential_ref))
        .await
        .map_err(|_| "OS credential storage is unavailable".to_string())?
        .map_err(|_| "OS credential storage is unavailable".to_string())
}

/// Resolve a previously saved secret for native provider code only. Callers
/// must keep this operation off the async executor and must not serialize,
/// log, persist, or send the returned value to the renderer.
#[allow(dead_code)]
pub(crate) fn read_connector_credential(reference: &str) -> Result<Zeroizing<String>, String> {
    validate_reference(reference).map_err(|_| "credential reference is invalid".to_string())?;
    OsCredentialBackend
        .get(reference)
        .map_err(|_| "OS credential is unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct MemoryBackend(Mutex<HashMap<String, String>>);

    impl CredentialBackend for MemoryBackend {
        fn set(&self, reference: &str, secret: &str) -> Result<(), ()> {
            self.0
                .lock()
                .map_err(|_| ())?
                .insert(reference.into(), secret.into());
            Ok(())
        }

        fn get(&self, reference: &str) -> Result<Zeroizing<String>, ()> {
            self.0
                .lock()
                .map_err(|_| ())?
                .get(reference)
                .cloned()
                .map(Zeroizing::new)
                .ok_or(())
        }

        fn delete(&self, reference: &str) -> Result<(), ()> {
            self.0
                .lock()
                .map_err(|_| ())?
                .remove(reference)
                .map(|_| ())
                .ok_or(())
        }
    }

    #[test]
    fn stores_secret_behind_random_reference_and_never_returns_secret_as_reference() {
        let backend = MemoryBackend::default();
        let reference =
            store_with(&backend, Zeroizing::new("supplier-session".to_string())).unwrap();
        assert!(reference.starts_with(REFERENCE_PREFIX));
        assert_ne!(reference, "supplier-session");
        assert_eq!(
            backend.get(&reference).unwrap().as_str(),
            "supplier-session"
        );
    }

    #[test]
    fn rejects_empty_and_oversized_secrets_before_storage() {
        let backend = MemoryBackend::default();
        assert!(store_with(&backend, Zeroizing::new(String::new())).is_err());
        assert!(store_with(&backend, Zeroizing::new("x".repeat(MAX_SECRET_BYTES + 1))).is_err());
        assert!(backend.0.lock().unwrap().is_empty());
    }

    #[test]
    fn rejects_malformed_or_caller_chosen_keyring_references() {
        assert!(validate_reference("supplier-session").is_err());
        assert!(validate_reference("formulab-credential:v1:../../profile").is_err());
        assert!(validate_reference("formulab-credential:v1:0123").is_err());
    }

    #[test]
    fn deletes_only_the_secret_referenced_by_a_valid_opaque_reference() {
        let backend = MemoryBackend::default();
        let reference = store_with(&backend, Zeroizing::new("secret".to_string())).unwrap();
        delete_with(&backend, &reference).unwrap();
        assert!(backend.get(&reference).is_err());
        assert!(delete_with(&backend, "../../secret").is_err());
    }
}
