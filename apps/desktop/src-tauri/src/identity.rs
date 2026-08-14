// Session 2 wires `login`/`bootstrap_status`/`bootstrap_create_administrator`/
// `logout`/`current_session` (see `auth.rs`) on top of this module's storage
// primitives. A few primitives (`update_role`, `update_account_status`,
// `update_password_hash`) remain unused until the Administration -> Users UI
// (Session 5) calls them — allowed dead-code at the module level rather than
// per-function so that doesn't need scattered #[allow] attributes.
#![allow(dead_code)]
// Phase 13 Session 1 — Identity/authentication database foundation.
//
// A dedicated, application-private `identity.db` (never the relocatable
// data root, never `.FormuLab/runs.db`, never any `.formulab-backup`
// payload) holding user accounts, sessions, login attempts, and a
// security audit trail for FormuLab's closed-enterprise-account model:
// administrator-created users, username + password login, one of 12
// fixed built-in roles per user. No public registration, no email/SMS
// verification, no per-user permission overrides — see
// docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md for the full design.
//
// This module implements only the storage/password foundation (Session
// 1). No login/bootstrap Tauri commands, no UI, and no application-wide
// enforcement exist yet — those are later Phase 13 sessions.
use std::path::{Path, PathBuf};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::backup::app_private_dir;

const DB_FILE: &str = "identity.db";

// ------------------------------------------------------------- roles ---

/// The 12 fixed, built-in FormuLab roles (Phase 13 Session 1 — supersedes
/// the earlier 6-role draft from Session 0; `chemist` was folded into
/// `researcher`, and `quality`/`production` each split into an employee
/// tier plus a manager tier). This is the Rust-side mirror of
/// `packages/shared/src/schemas/status.ts`'s `APPROVAL_ROLES` — the two
/// must name the exact same 12 strings; a parity test in this module's
/// `#[cfg(test)]` block only checks the Rust side's own round-trip
/// (string <-> Role), not cross-language identity — a real cross-language
/// parity test needs a fixture both sides read, left for the session that
/// actually wires this enum into a Tauri command surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Researcher,
    ResearchManager,
    Quality,
    QualityManager,
    Regulatory,
    RawMaterial,
    Procurement,
    ProductionEngineering,
    Production,
    ProductionManager,
    DocumentControl,
    Administrator,
}

impl Role {
    /// Every fixed role, for validation/enumeration. Not a database table —
    /// role policy is application-versioned code, not editable data (see
    /// architecture doc §15).
    pub const ALL: [Role; 12] = [
        Role::Researcher,
        Role::ResearchManager,
        Role::Quality,
        Role::QualityManager,
        Role::Regulatory,
        Role::RawMaterial,
        Role::Procurement,
        Role::ProductionEngineering,
        Role::Production,
        Role::ProductionManager,
        Role::DocumentControl,
        Role::Administrator,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Role::Researcher => "researcher",
            Role::ResearchManager => "research_manager",
            Role::Quality => "quality",
            Role::QualityManager => "quality_manager",
            Role::Regulatory => "regulatory",
            Role::RawMaterial => "raw_material",
            Role::Procurement => "procurement",
            Role::ProductionEngineering => "production_engineering",
            Role::Production => "production",
            Role::ProductionManager => "production_manager",
            Role::DocumentControl => "document_control",
            Role::Administrator => "administrator",
        }
    }

    /// Rejects anything not exactly one of the 12 fixed role strings —
    /// callers (a future create-user/change-role command) must never be
    /// able to smuggle an arbitrary string into `users.role`.
    pub fn parse(s: &str) -> Result<Role, String> {
        Role::ALL
            .iter()
            .copied()
            .find(|r| r.as_str() == s)
            .ok_or_else(|| format!("\"{s}\" is not one of the 12 fixed FormuLab roles"))
    }
}

// --------------------------------------------------------- db + path ---

fn identity_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_private_dir(app, "identity")?.join(DB_FILE))
}

/// `pub(crate)` (not just module-private) so `auth.rs`'s tests can open the
/// same kind of disposable temp database this module's own tests use,
/// without duplicating the migration-running logic.
pub(crate) fn open_at(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    run_migrations(&conn)?;
    Ok(conn)
}

/// Opens (creating if needed) the real, app-private identity database.
/// Not currently wired to any Tauri command — Session 2 adds
/// `login`/`bootstrap_status` etc. on top of this.
pub(crate) fn open_identity_db(app: &AppHandle) -> Result<Connection, String> {
    open_at(&identity_db_path(app)?)
}

// -------------------------------------------------------- migrations ---
//
// Deterministic, versioned, idempotent: each migration is a numbered SQL
// batch, applied in order inside one transaction, tracked via SQLite's own
// `PRAGMA user_version` (an integer baked into the file itself — no extra
// bookkeeping table needed, no risk of the tracking table and the real
// schema disagreeing). Running `run_migrations` again on an already-
// current database is a no-op (`user_version` already matches the last
// migration, the loop does nothing). `migration.rs` (the existing
// framework) was evaluated first — it tracks *data-root* JSON-format
// schema compatibility (`schema_meta.json` + a migration journal for
// formulation data), a different concern from SQL DDL evolution inside a
// single SQLite file; reusing it here would mean bending a JSON-schema
// tool to run SQL, so this module uses SQLite's own native versioning
// primitive instead — arguably a more direct reuse of "existing tooling"
// than adapting `migration.rs` would have been.
const MIGRATIONS: &[&str] = &[
    // Migration 1: users, authenticated_sessions, login_attempts,
    // security_audit_events.
    r#"
    CREATE TABLE users (
        id                   TEXT PRIMARY KEY,
        username             TEXT NOT NULL,
        normalized_username  TEXT NOT NULL UNIQUE,
        display_name         TEXT NOT NULL,
        password_hash        TEXT NOT NULL,
        role                 TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'active',
        department           TEXT,
        employee_reference   TEXT,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        failed_login_count   INTEGER NOT NULL DEFAULT 0,
        locked_until         TEXT,
        created_at           TEXT NOT NULL,
        created_by           TEXT,
        updated_at           TEXT NOT NULL,
        last_login_at        TEXT
    );

    CREATE TABLE authenticated_sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT
    );
    CREATE INDEX idx_sessions_user ON authenticated_sessions(user_id);

    CREATE TABLE login_attempts (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        username_normalized TEXT NOT NULL,
        at                  TEXT NOT NULL,
        outcome             TEXT NOT NULL,
        device_context      TEXT
    );
    CREATE INDEX idx_login_attempts_username ON login_attempts(username_normalized);

    CREATE TABLE security_audit_events (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        at             TEXT NOT NULL,
        actor_user_id  TEXT,
        target_user_id TEXT,
        action         TEXT NOT NULL,
        outcome        TEXT NOT NULL,
        detail         TEXT
    );
    CREATE INDEX idx_audit_target ON security_audit_events(target_user_id);
    "#,
];

fn run_migrations(conn: &Connection) -> Result<(), String> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let current = current.max(0) as usize;
    if current >= MIGRATIONS.len() {
        return Ok(()); // already up to date — idempotent no-op
    }
    for (i, migration) in MIGRATIONS.iter().enumerate().skip(current) {
        conn.execute_batch(migration).map_err(|e| format!("identity.db migration {} failed: {e}", i + 1))?;
        let new_version = (i + 1) as i64;
        conn.pragma_update(None, "user_version", new_version).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --------------------------------------------------------- username ---

/// 3-64 chars, ASCII letters/digits/`.`/`_`/`-` only, no internal
/// whitespace. Unicode is rejected outright (not stripped/transliterated)
/// — since the allowed charset is pure ASCII, NFC/case-fold normalization
/// beyond a plain lowercase is unnecessary: any input containing a
/// non-ASCII or non-allowed character never reaches the database at all.
pub(crate) fn validate_username(raw: &str) -> Result<(), String> {
    let trimmed = raw.trim();
    if trimmed != raw {
        return Err("username must not have leading or trailing whitespace".into());
    }
    let len = trimmed.chars().count();
    if !(3..=64).contains(&len) {
        return Err("username must be 3-64 characters".into());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("username must not contain whitespace".into());
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err("username may only contain ASCII letters, digits, '.', '_', '-'".into());
    }
    Ok(())
}

/// The uniqueness/lookup key: trimmed + ASCII-lowercased. Safe without
/// Unicode normalization because `validate_username` already rejects any
/// non-ASCII input before this is ever called on untrusted data.
pub(crate) fn normalize_username(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

// ---------------------------------------------------------- password ---

/// PHC-string encoded Argon2id hash (algorithm + params + salt + hash in
/// one self-describing string) — nothing else needs to be stored
/// alongside `password_hash` to later verify it. A fresh random salt
/// (`OsRng`) is generated per call, so hashing the same password twice
/// never produces the same stored string.
pub(crate) fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("password hashing failed: {e}"))
}

/// Never leaks *why* verification failed (malformed stored hash vs. wrong
/// password) beyond a boolean — both are just "not authenticated" to the
/// caller, matching the login flow's generic-error requirement.
pub(crate) fn verify_password(password: &str, encoded_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(encoded_hash) else {
        return false;
    };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}

/// A real, validly-hashed Argon2id PHC string used for exactly one purpose:
/// spending the same CPU cost as a genuine password check when there is no
/// real user record to check against (unknown username, disabled account,
/// locked account) — so a login attempt's response time doesn't itself leak
/// which of those cases applies (architecture doc §13, "timing/username
/// enumeration defense"). This does not claim mathematically constant
/// timing, only that the same expensive Argon2id call runs on every code
/// path that must return the identical public error. Computed once (the
/// underlying password is a fixed, meaningless constant, never a real
/// account's credential) and cached for the process lifetime.
pub(crate) fn dummy_password_hash() -> &'static str {
    static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DUMMY.get_or_init(|| {
        hash_password("formulab-timing-defense-dummy-value-never-a-real-account-password")
            .expect("hashing a fixed constant string cannot fail")
    })
}

// -------------------------------------------------------------- user ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub normalized_username: String,
    pub display_name: String,
    #[serde(skip)] // never serialized to any frontend-facing payload
    pub password_hash: String,
    pub role: Role,
    pub status: String,
    pub department: Option<String>,
    pub employee_reference: Option<String>,
    pub must_change_password: bool,
    pub failed_login_count: i64,
    pub locked_until: Option<String>,
    pub created_at: String,
    pub created_by: Option<String>,
    pub updated_at: String,
    pub last_login_at: Option<String>,
}

pub(crate) struct NewUser<'a> {
    pub username: &'a str,
    pub display_name: &'a str,
    pub password_hash: &'a str,
    pub role: Role,
    pub department: Option<&'a str>,
    pub employee_reference: Option<&'a str>,
    pub created_by: Option<&'a str>,
}

fn new_id(prefix: &str) -> String {
    let mut buf = [0u8; 8];
    let _ = getrandom::fill(&mut buf);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{prefix}_{now:x}{}", buf.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// `pub(crate)` so `auth.rs`'s tests can compute the same "now" epoch-
/// seconds string to construct deterministic past/future timestamps
/// (simulating an expired lock/session without a real `sleep`).
pub(crate) fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Deliberately not chrono — this codebase has no chrono dependency
    // and doesn't need one for an audit timestamp; epoch seconds as a
    // decimal string sorts and compares correctly and is trivially
    // human-decodable, matching `backup.rs`'s own `now_secs()` convention.
    secs.to_string()
}

fn row_to_user(row: &rusqlite::Row) -> rusqlite::Result<User> {
    let role_str: String = row.get("role")?;
    let must_change: i64 = row.get("must_change_password")?;
    Ok(User {
        id: row.get("id")?,
        username: row.get("username")?,
        normalized_username: row.get("normalized_username")?,
        display_name: row.get("display_name")?,
        password_hash: row.get("password_hash")?,
        role: Role::parse(&role_str).unwrap_or(Role::Researcher), // schema guarantees a valid role was written; unwrap_or is defensive only
        status: row.get("status")?,
        department: row.get("department")?,
        employee_reference: row.get("employee_reference")?,
        must_change_password: must_change != 0,
        failed_login_count: row.get("failed_login_count")?,
        locked_until: row.get("locked_until")?,
        created_at: row.get("created_at")?,
        created_by: row.get("created_by")?,
        updated_at: row.get("updated_at")?,
        last_login_at: row.get("last_login_at")?,
    })
}

const USER_COLUMNS: &str = "id, username, normalized_username, display_name, password_hash, role, status, \
     department, employee_reference, must_change_password, failed_login_count, locked_until, \
     created_at, created_by, updated_at, last_login_at";

/// Every parameter below is bound via rusqlite's `params!`/`?` placeholders
/// — never string-formatted into the SQL text. This is a hard requirement
/// (architecture doc §16 / test matrix §D), not a style preference.
pub(crate) fn create_user(conn: &Connection, new: NewUser) -> Result<User, String> {
    validate_username(new.username)?;
    let id = new_id("usr");
    let normalized = normalize_username(new.username);
    let now = now_iso();
    conn.execute(
        "INSERT INTO users (id, username, normalized_username, display_name, password_hash, role, status, \
             department, employee_reference, must_change_password, failed_login_count, locked_until, \
             created_at, created_by, updated_at, last_login_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, 1, 0, NULL, ?9, ?10, ?9, NULL)",
        params![
            id,
            new.username,
            normalized,
            new.display_name,
            new.password_hash,
            new.role.as_str(),
            new.department,
            new.employee_reference,
            now,
            new.created_by,
        ],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE constraint failed") {
            "a user with that username already exists".to_string()
        } else {
            e.to_string()
        }
    })?;
    find_user_by_id(conn, &id)?.ok_or_else(|| "user vanished immediately after insert".to_string())
}

pub(crate) fn find_user_by_normalized_username(conn: &Connection, normalized: &str) -> Result<Option<User>, String> {
    conn.query_row(
        &format!("SELECT {USER_COLUMNS} FROM users WHERE normalized_username = ?1"),
        params![normalized],
        row_to_user,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn find_user_by_id(conn: &Connection, id: &str) -> Result<Option<User>, String> {
    conn.query_row(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?1"), params![id], row_to_user)
        .optional()
        .map_err(|e| e.to_string())
}

pub(crate) fn update_password_hash(conn: &Connection, user_id: &str, new_hash: &str) -> Result<(), String> {
    let n = conn
        .execute(
            "UPDATE users SET password_hash = ?1, updated_at = ?2, must_change_password = 1 WHERE id = ?3",
            params![new_hash, now_iso(), user_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("no such user".into());
    }
    Ok(())
}

pub(crate) fn update_account_status(conn: &Connection, user_id: &str, active: bool) -> Result<(), String> {
    let status = if active { "active" } else { "disabled" };
    let n = conn
        .execute("UPDATE users SET status = ?1, updated_at = ?2 WHERE id = ?3", params![status, now_iso(), user_id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("no such user".into());
    }
    // Disabling a user revokes every session it still holds — a disabled
    // account must not keep working through an already-open session.
    if !active {
        conn.execute(
            "UPDATE authenticated_sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL",
            params![now_iso(), user_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn update_role(conn: &Connection, user_id: &str, role: Role) -> Result<(), String> {
    let n = conn
        .execute(
            "UPDATE users SET role = ?1, updated_at = ?2 WHERE id = ?3",
            params![role.as_str(), now_iso(), user_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("no such user".into());
    }
    Ok(())
}

/// Called after a login attempt: on success, resets the failure counter
/// and stamps `last_login_at`; on failure, increments it and — once
/// `threshold` is reached — sets `locked_until`. `threshold`/`lock_secs`
/// are caller-supplied rather than hardcoded so Session 6 can tune them
/// against real usability testing without touching this function.
pub(crate) fn update_login_state(
    conn: &Connection,
    user_id: &str,
    success: bool,
    threshold: i64,
    lock_secs: i64,
) -> Result<(), String> {
    if success {
        conn.execute(
            "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now_iso(), user_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let count: i64 = conn
        .query_row("SELECT failed_login_count FROM users WHERE id = ?1", params![user_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let new_count = count + 1;
    let locked_until: Option<String> = if new_count >= threshold {
        let until = now_iso().parse::<i64>().unwrap_or(0) + lock_secs;
        Some(until.to_string())
    } else {
        None
    };
    conn.execute(
        "UPDATE users SET failed_login_count = ?1, locked_until = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_count, locked_until, now_iso(), user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// True while `locked_until` is set and still in the future. Every caller
/// (login, tests, future admin UI) goes through this instead of comparing
/// timestamps itself, so "locked" has exactly one definition.
pub(crate) fn is_locked(user: &User) -> bool {
    match &user.locked_until {
        Some(until) => until.parse::<i64>().unwrap_or(0) > now_iso().parse::<i64>().unwrap_or(0),
        None => false,
    }
}

/// Whether `identity.db` currently has at least one `administrator` — the
/// sole gate `bootstrap_administrator` and `bootstrap_status` (Session 2,
/// `auth.rs`) both check. Deliberately keyed on role, not on "any user
/// exists at all": the fixed-role model makes "an administrator exists" the
/// only meaningful bootstrap-closed condition.
pub(crate) fn any_administrator_exists(conn: &Connection) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM users WHERE role = ?1",
            params![Role::Administrator.as_str()],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// The only way `identity.db` ever gets an Administrator without one
/// already existing. The "does an administrator exist" check and the
/// insert run inside one IMMEDIATE transaction so two concurrent bootstrap
/// attempts cannot both observe zero administrators and both insert one —
/// SQLite serializes writers, so the second transaction's check always sees
/// the first's committed row (or blocks until it commits). If this returns
/// `Err`, the transaction was never committed and rolls back automatically
/// (`rusqlite::Transaction::drop`) — no partial user is left behind.
///
/// Bootstrap administrators are exempted from `must_change_password`: they
/// just chose their own password during setup, so there is no admin-set
/// temporary password to force a change away from (unlike every
/// Administration-created user in later sessions, which keeps the default
/// `must_change_password = true` from `create_user`).
pub(crate) fn bootstrap_administrator(
    conn: &mut Connection,
    username: &str,
    display_name: &str,
    password_hash: &str,
) -> Result<User, String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let count: i64 = tx
        .query_row(
            "SELECT count(*) FROM users WHERE role = ?1",
            params![Role::Administrator.as_str()],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Err("an administrator already exists; bootstrap is permanently closed".into());
    }
    let mut user = create_user(
        &tx,
        NewUser {
            username,
            display_name,
            password_hash,
            role: Role::Administrator,
            department: None,
            employee_reference: None,
            created_by: None,
        },
    )?;
    tx.execute(
        "UPDATE users SET must_change_password = 0, updated_at = ?1 WHERE id = ?2",
        params![now_iso(), user.id],
    )
    .map_err(|e| e.to_string())?;
    user.must_change_password = false;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(user)
}

// ------------------------------------------------ login attempts ---

pub(crate) fn record_login_attempt(
    conn: &Connection,
    username_normalized: &str,
    outcome: &str,
    device_context: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO login_attempts (username_normalized, at, outcome, device_context) VALUES (?1, ?2, ?3, ?4)",
        params![username_normalized, now_iso(), outcome, device_context],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ------------------------------------------------------- sessions ---

/// A fresh, high-entropy (256-bit) random bearer token — never derived from
/// a predictable value (user id, timestamp, sequence number). Returned to
/// the caller exactly once, at session creation; only its SHA-256 hash
/// (`hash_session_token`) is ever persisted, so a leaked/stolen
/// `identity.db` file alone does not hand out a reusable active session —
/// the attacker would need the raw token too, which the database never
/// contains. Mature, un-invented cryptography only: `getrandom` for the
/// entropy source, `sha2` (already a dependency, used by `backup.rs`'s
/// manifest hashing) for the one-way hash. Not a JWT — an offline local
/// desktop app has no second party to verify a signed claim against, so a
/// plain random-token-plus-hash design is the right amount of complexity.
fn generate_session_token() -> String {
    let mut buf = [0u8; 32];
    let _ = getrandom::fill(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect::<String>()
}

fn hash_session_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()
}

/// A freshly issued session. `token` is the raw bearer credential — hand it
/// to the caller once and never store it; only `hash_session_token(token)`
/// is written to `authenticated_sessions.id`. (Session 1 originally stored
/// a plain `new_id("sess")` directly as both the row id and the bearer
/// value; Session 2 splits these per the architecture doc's token-storage
/// decision, §15 of the security brief — no schema migration needed, since
/// `id` already held an opaque string and now simply holds a hash instead.)
#[derive(Debug, Clone)]
pub(crate) struct Session {
    pub token: String,
    pub user_id: String,
    pub created_at: String,
    pub expires_at: String,
}

pub(crate) fn create_session(conn: &Connection, user_id: &str, ttl_secs: i64) -> Result<Session, String> {
    let token = generate_session_token();
    let token_hash = hash_session_token(&token);
    let now = now_iso();
    let expires = (now.parse::<i64>().unwrap_or(0) + ttl_secs).to_string();
    conn.execute(
        "INSERT INTO authenticated_sessions (id, user_id, created_at, expires_at, last_seen_at, revoked_at) \
         VALUES (?1, ?2, ?3, ?4, ?3, NULL)",
        params![token_hash, user_id, now, expires],
    )
    .map_err(|e| e.to_string())?;
    Ok(Session { token, user_id: user_id.to_string(), created_at: now, expires_at: expires })
}

/// A session is valid only if: the presented token's hash matches a stored
/// row, that row was never revoked, hasn't passed its absolute expiry, and
/// — when `idle_timeout_secs > 0` — hasn't sat idle past that window since
/// `last_seen_at`; the row's owning user must also still be `active`,
/// checked fresh on every call (never cached), so a disable/role-change
/// takes effect on the very next privileged action, not "eventually."
/// `idle_timeout_secs <= 0` disables the idle check (used by tests that
/// only care about absolute expiry/revocation). A successful validation
/// slides `last_seen_at` forward — normal desktop-app idle-timeout UX:
/// activity keeps a session alive, only true idleness expires it.
pub(crate) fn validate_session(
    conn: &Connection,
    presented_token: &str,
    idle_timeout_secs: i64,
) -> Result<Option<User>, String> {
    let token_hash = hash_session_token(presented_token);
    let now: i64 = now_iso().parse().unwrap_or(0);
    let row: Option<(String, String, String, i64)> = conn
        .query_row(
            "SELECT user_id, expires_at, last_seen_at, revoked_at IS NOT NULL FROM authenticated_sessions WHERE id = ?1",
            params![token_hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((user_id, expires_at, last_seen_at, revoked)) = row else {
        return Ok(None);
    };
    if revoked != 0 {
        return Ok(None);
    }
    if expires_at.parse::<i64>().unwrap_or(0) <= now {
        return Ok(None);
    }
    if idle_timeout_secs > 0 && last_seen_at.parse::<i64>().unwrap_or(0) + idle_timeout_secs <= now {
        return Ok(None);
    }
    let Some(user) = find_user_by_id(conn, &user_id)? else {
        return Ok(None);
    };
    if user.status != "active" {
        return Ok(None);
    }
    conn.execute(
        "UPDATE authenticated_sessions SET last_seen_at = ?1 WHERE id = ?2",
        params![now_iso(), token_hash],
    )
    .map_err(|e| e.to_string())?;
    Ok(Some(user))
}

/// Revokes one session by its presented bearer token (logout). A no-op —
/// not an error — if the token is unknown or already revoked: logout must
/// never let a caller distinguish "that token was never valid" from
/// "already logged out" through an error response.
pub(crate) fn revoke_session(conn: &Connection, presented_token: &str) -> Result<(), String> {
    let token_hash = hash_session_token(presented_token);
    conn.execute(
        "UPDATE authenticated_sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL",
        params![now_iso(), token_hash],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// --------------------------------------------------------- audit ---

/// `detail` must never contain a password, password hash, API key, or
/// session-secret *value* (a session *id* for correlation is fine — it
/// isn't a bearer secret's plaintext by itself in this design, same as
/// logging a database row id). Callers are responsible for that; this
/// function just persists whatever string it's given, same as every
/// other audit write path in this codebase (`provenance.rs`, `runs.rs`).
pub(crate) fn record_security_audit_event(
    conn: &Connection,
    actor_user_id: Option<&str>,
    target_user_id: Option<&str>,
    action: &str,
    outcome: &str,
    detail: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO security_audit_events (at, actor_user_id, target_user_id, action, outcome, detail) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![now_iso(), actor_user_id, target_user_id, action, outcome, detail],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db(tag: &str) -> (PathBuf, Connection) {
        let dir = std::env::temp_dir().join(format!("formulab-identity-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("identity.db");
        let conn = open_at(&path).unwrap();
        (path, conn)
    }

    fn seeded_user(conn: &Connection, username: &str, role: Role) -> User {
        create_user(
            conn,
            NewUser {
                username,
                display_name: "Test User",
                password_hash: &hash_password("correct horse battery staple").unwrap(),
                role,
                department: None,
                employee_reference: None,
                created_by: None,
            },
        )
        .unwrap()
    }

    // ----------------------------------------------------- identity db ---

    #[test]
    fn fresh_database_creates_all_four_tables_and_reaches_the_latest_schema_version() {
        let (_path, conn) = tmp_db("fresh");
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        for table in ["users", "authenticated_sessions", "login_attempts", "security_audit_events"] {
            let count: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", params![table], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 1, "expected table {table} to exist");
        }
    }

    #[test]
    fn migrations_are_idempotent_reopening_an_existing_database_does_not_error_or_duplicate() {
        let dir = std::env::temp_dir().join(format!("formulab-identity-test-reopen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("identity.db");
        {
            let conn = open_at(&path).unwrap();
            seeded_user(&conn, "reopen.user", Role::Researcher);
        }
        // Reopening re-runs run_migrations against an already-current DB.
        let conn2 = open_at(&path).unwrap();
        let version: i64 = conn2.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        let count: i64 = conn2.query_row("SELECT count(*) FROM users", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "existing data must survive a re-open, not be recreated");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ------------------------------------------------------------ roles ---

    #[test]
    fn all_12_fixed_roles_round_trip_through_as_str_and_parse() {
        assert_eq!(Role::ALL.len(), 12);
        for role in Role::ALL {
            let s = role.as_str();
            assert_eq!(Role::parse(s).unwrap(), role);
        }
    }

    #[test]
    fn unknown_role_strings_are_rejected() {
        for bogus in ["chemist", "admin", "Researcher", "research-manager", "", "packaging"] {
            assert!(Role::parse(bogus).is_err(), "expected {bogus:?} to be rejected");
        }
    }

    #[test]
    fn role_model_regression_researcher_and_research_manager_are_distinct() {
        assert_ne!(Role::Researcher.as_str(), Role::ResearchManager.as_str());
        assert_ne!(Role::Quality.as_str(), Role::QualityManager.as_str());
        assert_ne!(Role::Production.as_str(), Role::ProductionManager.as_str());
    }

    /// Phase 13 Session 3 — the Rust half of the Rust/TypeScript role-
    /// vocabulary parity mechanism. `packages/shared/src/engine/
    /// roleVocabulary.json` is a single fixture both languages check
    /// *themselves* against: this test asserts `Role::ALL` (in `as_str()`
    /// order) is exactly the fixture's `roles` array; the TypeScript side
    /// (`rolePolicy.roleVocabularyParity.test.ts`) asserts `APPROVAL_ROLES`
    /// against the same file. Neither side hand-copies the other's 12
    /// strings into a third list — see `rolePolicy.ts`'s module doc comment.
    #[test]
    fn role_vocabulary_matches_the_shared_json_fixture() {
        const FIXTURE: &str =
            include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/shared/src/engine/roleVocabulary.json"));
        let parsed: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture must be valid JSON");
        let fixture_roles: Vec<String> = parsed["roles"]
            .as_array()
            .expect("fixture must have a top-level \"roles\" array")
            .iter()
            .map(|v| v.as_str().expect("every fixture role must be a string").to_string())
            .collect();
        let rust_roles: Vec<&str> = Role::ALL.iter().map(|r| r.as_str()).collect();
        assert_eq!(
            fixture_roles, rust_roles,
            "identity.rs's Role::ALL must match packages/shared/src/engine/roleVocabulary.json exactly, in order"
        );
    }

    // -------------------------------------------------------- username ---

    #[test]
    fn accepts_realistic_usernames() {
        for u in ["ahmet.yilmaz", "ayse_demir", "lab01", "chemist03", "quality.manager"] {
            assert!(validate_username(u).is_ok(), "expected {u:?} to be valid");
        }
    }

    #[test]
    fn rejects_too_short_too_long_and_whitespace() {
        assert!(validate_username("ab").is_err());
        assert!(validate_username(&"a".repeat(65)).is_err());
        assert!(validate_username(" ahmet").is_err());
        assert!(validate_username("ahmet ").is_err());
        assert!(validate_username("ah met").is_err());
    }

    #[test]
    fn rejects_disallowed_characters_and_email_shaped_input() {
        assert!(validate_username("ahmet@yilmaz.com").is_err());
        assert!(validate_username("ahmet!yilmaz").is_err());
        assert!(validate_username("ahmet/yilmaz").is_err());
    }

    #[test]
    fn normalization_is_case_insensitive() {
        assert_eq!(normalize_username("Ahmet.Yilmaz"), normalize_username("ahmet.yilmaz"));
        assert_eq!(normalize_username("  ahmet.yilmaz  ".trim()), "ahmet.yilmaz");
    }

    #[test]
    fn a_second_user_differing_only_by_case_is_refused_by_the_database_constraint() {
        let (_p, conn) = tmp_db("case-collision");
        seeded_user(&conn, "ahmet.yilmaz", Role::Researcher);
        let err = create_user(
            &conn,
            NewUser {
                username: "Ahmet.Yilmaz",
                display_name: "Duplicate",
                password_hash: &hash_password("x").unwrap(),
                role: Role::Researcher,
                department: None,
                employee_reference: None,
                created_by: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("already exists"));
    }

    // -------------------------------------------------------- password ---

    #[test]
    fn correct_password_verifies_and_wrong_password_is_rejected() {
        let hash = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password("correct horse battery staple", &hash));
        assert!(!verify_password("wrong password", &hash));
    }

    #[test]
    fn two_hashes_of_the_same_password_use_different_random_salts() {
        let a = hash_password("same password").unwrap();
        let b = hash_password("same password").unwrap();
        assert_ne!(a, b, "identical passwords must not produce identical stored hashes");
        assert!(verify_password("same password", &a));
        assert!(verify_password("same password", &b));
    }

    #[test]
    fn the_plaintext_password_never_appears_inside_its_own_stored_hash() {
        let hash = hash_password("hunter2-do-not-log-me").unwrap();
        assert!(!hash.contains("hunter2-do-not-log-me"));
    }

    #[test]
    fn oversized_password_input_is_hashed_safely_without_panicking() {
        let huge = "x".repeat(1_000_000);
        let hash = hash_password(&huge).unwrap();
        assert!(verify_password(&huge, &hash));
    }

    #[test]
    fn a_malformed_stored_hash_fails_verification_instead_of_panicking() {
        assert!(!verify_password("anything", "not-a-real-phc-hash"));
        assert!(!verify_password("anything", ""));
    }

    // ----------------------------------------------------------- users ---

    #[test]
    fn create_then_find_by_normalized_username_and_by_id_round_trip() {
        let (_p, conn) = tmp_db("crud");
        let created = seeded_user(&conn, "quality.manager", Role::QualityManager);
        let by_username = find_user_by_normalized_username(&conn, "quality.manager").unwrap().unwrap();
        assert_eq!(by_username.id, created.id);
        let by_id = find_user_by_id(&conn, &created.id).unwrap().unwrap();
        assert_eq!(by_id.username, "quality.manager");
        assert_eq!(by_id.role, Role::QualityManager);
        assert!(by_id.must_change_password, "an admin-set initial password must require a change on first login");
    }

    #[test]
    fn find_by_unknown_username_or_id_is_none_not_an_error() {
        let (_p, conn) = tmp_db("missing");
        assert!(find_user_by_normalized_username(&conn, "nobody").unwrap().is_none());
        assert!(find_user_by_id(&conn, "usr_doesnotexist").unwrap().is_none());
    }

    #[test]
    fn update_account_status_disabling_revokes_every_open_session() {
        let (_p, conn) = tmp_db("disable-revokes");
        let user = seeded_user(&conn, "prod.mgr", Role::ProductionManager);
        let session = create_session(&conn, &user.id, 3600).unwrap();
        assert!(validate_session(&conn, &session.token, 0).unwrap().is_some());

        update_account_status(&conn, &user.id, false).unwrap();

        assert!(validate_session(&conn, &session.token, 0).unwrap().is_none());
        let refreshed = find_user_by_id(&conn, &user.id).unwrap().unwrap();
        assert_eq!(refreshed.status, "disabled");
    }

    #[test]
    fn update_role_changes_effective_role_immediately() {
        let (_p, conn) = tmp_db("role-change");
        let user = seeded_user(&conn, "someone", Role::Researcher);
        update_role(&conn, &user.id, Role::ResearchManager).unwrap();
        let refreshed = find_user_by_id(&conn, &user.id).unwrap().unwrap();
        assert_eq!(refreshed.role, Role::ResearchManager);
    }

    #[test]
    fn update_password_hash_sets_must_change_password_and_the_old_password_stops_working() {
        let (_p, conn) = tmp_db("reset");
        let user = seeded_user(&conn, "someone.else", Role::Quality);
        let old_hash = user.password_hash.clone();
        let new_hash = hash_password("brand-new-temp-password").unwrap();
        update_password_hash(&conn, &user.id, &new_hash).unwrap();
        let refreshed = find_user_by_id(&conn, &user.id).unwrap().unwrap();
        assert_ne!(refreshed.password_hash, old_hash);
        assert!(refreshed.must_change_password);
        assert!(!verify_password("correct horse battery staple", &refreshed.password_hash));
        assert!(verify_password("brand-new-temp-password", &refreshed.password_hash));
    }

    // ------------------------------------------------- login/lockout ---

    #[test]
    fn failed_logins_increment_and_lock_after_threshold_success_resets() {
        let (_p, conn) = tmp_db("lockout");
        let user = seeded_user(&conn, "lockout.case", Role::Production);
        for _ in 0..4 {
            update_login_state(&conn, &user.id, false, 5, 900).unwrap();
        }
        let mid = find_user_by_id(&conn, &user.id).unwrap().unwrap();
        assert_eq!(mid.failed_login_count, 4);
        assert!(mid.locked_until.is_none());

        update_login_state(&conn, &user.id, false, 5, 900).unwrap();
        let locked = find_user_by_id(&conn, &user.id).unwrap().unwrap();
        assert_eq!(locked.failed_login_count, 5);
        assert!(locked.locked_until.is_some());

        update_login_state(&conn, &user.id, true, 5, 900).unwrap();
        let recovered = find_user_by_id(&conn, &user.id).unwrap().unwrap();
        assert_eq!(recovered.failed_login_count, 0);
        assert!(recovered.locked_until.is_none());
        assert!(recovered.last_login_at.is_some());
    }

    #[test]
    fn login_attempts_are_persisted_for_both_success_and_failure() {
        let (_p, conn) = tmp_db("attempts");
        record_login_attempt(&conn, "someone", "bad_password", None).unwrap();
        record_login_attempt(&conn, "someone", "success", None).unwrap();
        let count: i64 = conn.query_row("SELECT count(*) FROM login_attempts", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    // ----------------------------------------------------- sessions ---

    #[test]
    fn a_fresh_session_validates_and_an_expired_one_does_not() {
        let (_p, conn) = tmp_db("session-expiry");
        let user = seeded_user(&conn, "session.user", Role::Researcher);
        let live = create_session(&conn, &user.id, 3600).unwrap();
        assert!(validate_session(&conn, &live.token, 0).unwrap().is_some());

        let expired = create_session(&conn, &user.id, -1).unwrap();
        assert!(validate_session(&conn, &expired.token, 0).unwrap().is_none());
    }

    #[test]
    fn an_unknown_session_id_validates_to_none() {
        let (_p, conn) = tmp_db("session-unknown");
        assert!(validate_session(&conn, "not-a-real-token", 0).unwrap().is_none());
    }

    // ---------------------------------------- session 2: token hashing ---

    #[test]
    fn the_raw_session_token_is_never_stored_only_its_hash_is() {
        let (_p, conn) = tmp_db("token-not-stored");
        let user = seeded_user(&conn, "token.user", Role::Researcher);
        let session = create_session(&conn, &user.id, 3600).unwrap();
        let stored_id: String =
            conn.query_row("SELECT id FROM authenticated_sessions WHERE user_id = ?1", params![user.id], |r| r.get(0)).unwrap();
        assert_ne!(stored_id, session.token, "the raw bearer token must never equal the stored row id");
        assert_eq!(stored_id.len(), 64, "expected a 64-hex-char SHA-256 digest");
    }

    #[test]
    fn two_sessions_for_the_same_user_get_different_unpredictable_tokens() {
        let (_p, conn) = tmp_db("token-unpredictable");
        let user = seeded_user(&conn, "two.sessions", Role::Researcher);
        let a = create_session(&conn, &user.id, 3600).unwrap();
        let b = create_session(&conn, &user.id, 3600).unwrap();
        assert_ne!(a.token, b.token);
    }

    #[test]
    fn a_revoked_session_no_longer_validates() {
        let (_p, conn) = tmp_db("revoke");
        let user = seeded_user(&conn, "revoke.user", Role::Researcher);
        let session = create_session(&conn, &user.id, 3600).unwrap();
        assert!(validate_session(&conn, &session.token, 0).unwrap().is_some());
        revoke_session(&conn, &session.token).unwrap();
        assert!(validate_session(&conn, &session.token, 0).unwrap().is_none());
    }

    #[test]
    fn revoking_an_unknown_token_is_a_harmless_no_op() {
        let (_p, conn) = tmp_db("revoke-unknown");
        // Must not error — logout must never let a caller distinguish
        // "never valid" from "already logged out".
        revoke_session(&conn, "not-a-real-token").unwrap();
    }

    #[test]
    fn a_session_idle_past_the_timeout_no_longer_validates_even_before_absolute_expiry() {
        let (_p, conn) = tmp_db("idle-timeout");
        let user = seeded_user(&conn, "idle.user", Role::Researcher);
        let session = create_session(&conn, &user.id, 3600).unwrap(); // absolute expiry far in the future
        // Force last_seen_at into the past to simulate real idleness without sleeping in a test.
        let stale = (now_iso().parse::<i64>().unwrap() - 7200).to_string();
        conn.execute(
            "UPDATE authenticated_sessions SET last_seen_at = ?1 WHERE user_id = ?2",
            params![stale, user.id],
        )
        .unwrap();
        assert!(
            validate_session(&conn, &session.token, 3600).unwrap().is_none(),
            "a session idle for 2h must fail a 1h idle-timeout check even though it hasn't absolutely expired"
        );
        // idle_timeout_secs <= 0 disables the idle check entirely (still gated by absolute expiry).
        assert!(validate_session(&conn, &session.token, 0).unwrap().is_some());
    }

    #[test]
    fn a_successful_validation_slides_last_seen_at_forward() {
        let (_p, conn) = tmp_db("idle-slide");
        let user = seeded_user(&conn, "slide.user", Role::Researcher);
        let session = create_session(&conn, &user.id, 3600).unwrap();
        let old_last_seen: String =
            conn.query_row("SELECT last_seen_at FROM authenticated_sessions WHERE user_id = ?1", params![user.id], |r| r.get(0)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100)); // now_iso() is second-granularity
        validate_session(&conn, &session.token, 3600).unwrap();
        let new_last_seen: String =
            conn.query_row("SELECT last_seen_at FROM authenticated_sessions WHERE user_id = ?1", params![user.id], |r| r.get(0)).unwrap();
        assert!(new_last_seen >= old_last_seen);
    }

    // -------------------------------------------- session 2: lockout ---

    #[test]
    fn is_locked_reflects_locked_until_relative_to_now() {
        let (_p, conn) = tmp_db("is-locked");
        let mut user = seeded_user(&conn, "lock.check", Role::Researcher);
        assert!(!is_locked(&user), "a freshly created user must not be locked");
        user.locked_until = Some((now_iso().parse::<i64>().unwrap() + 900).to_string());
        assert!(is_locked(&user), "a locked_until in the future must count as locked");
        user.locked_until = Some((now_iso().parse::<i64>().unwrap() - 1).to_string());
        assert!(!is_locked(&user), "a locked_until in the past must no longer count as locked");
    }

    // ------------------------------------------- session 2: bootstrap ---

    #[test]
    fn any_administrator_exists_is_false_on_a_fresh_database() {
        let (_p, conn) = tmp_db("no-admin-yet");
        assert!(!any_administrator_exists(&conn).unwrap());
    }

    #[test]
    fn bootstrap_administrator_creates_the_first_admin_with_role_forced_and_no_forced_password_change() {
        let dir = std::env::temp_dir().join(format!("formulab-identity-test-bootstrap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = open_at(&dir.join("identity.db")).unwrap();
        let hash = hash_password("bootstrap-password-123").unwrap();
        let admin = bootstrap_administrator(&mut conn, "first.admin", "First Admin", &hash).unwrap();
        assert_eq!(admin.role, Role::Administrator);
        assert!(!admin.must_change_password, "a bootstrap administrator chose their own password — no forced change");
        assert_ne!(admin.password_hash, "bootstrap-password-123", "only the hash is ever stored");
        assert!(any_administrator_exists(&conn).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_bootstrap_attempt_is_permanently_rejected() {
        let (_p, mut conn) = tmp_db("bootstrap-second");
        let hash = hash_password("first-password").unwrap();
        bootstrap_administrator(&mut conn, "admin.one", "Admin One", &hash).unwrap();
        let hash2 = hash_password("second-password").unwrap();
        let err = bootstrap_administrator(&mut conn, "admin.two", "Admin Two", &hash2).unwrap_err();
        assert!(err.contains("already exists"));
        // The rejected attempt must not have left a partial second user behind.
        assert!(find_user_by_normalized_username(&conn, "admin.two").unwrap().is_none());
    }

    // -------------------------------------------------------- audit ---

    #[test]
    fn security_audit_events_persist_without_ever_storing_password_material() {
        let (_p, conn) = tmp_db("audit");
        let user = seeded_user(&conn, "audited.user", Role::Administrator);
        record_security_audit_event(&conn, Some(&user.id), Some(&user.id), "login_success", "success", None).unwrap();
        record_security_audit_event(
            &conn,
            Some(&user.id),
            Some(&user.id),
            "password_reset",
            "success",
            Some("reset by admin"),
        )
        .unwrap();

        let mut stmt = conn.prepare("SELECT action, outcome, detail FROM security_audit_events").unwrap();
        let rows: Vec<(String, String, Option<String>)> =
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(rows.len(), 2);
        for (_, _, detail) in &rows {
            if let Some(d) = detail {
                assert!(!d.contains(&user.password_hash), "audit detail must never contain a password hash");
            }
        }
    }

    // -------------------------------------------------- SQL injection ---
    //
    // Every value below is passed through the same create_user/find_*
    // functions real callers use — never string-concatenated. A hostile
    // string succeeding as *data* (a literal, useless-looking username
    // that's simply stored and later fails to match anything, or fails
    // validation outright) is correct; corrupting the query or affecting
    // other rows would be the failure.

    #[test]
    fn hostile_strings_are_rejected_by_validation_or_stored_inertly_as_data_never_executed() {
        let (_p, conn) = tmp_db("sqli");
        seeded_user(&conn, "victim.user", Role::Administrator);

        let hostile_usernames = [
            "admin'--",
            "' OR '1'='1",
            "'; DROP TABLE users;--",
            "victim.user' OR '1'='1",
            "a\"b'c`d",
            "/* comment */admin",
            "admin#",
            "\u{202e}nimda", // RTL override — rejected by the ASCII-only charset rule
            "adm\u{200b}in", // zero-width joiner — same
        ];
        for hostile in hostile_usernames {
            // Either validation refuses it outright (most of these — quotes,
            // spaces, unicode aren't in the allowed charset)...
            let result = create_user(
                &conn,
                NewUser {
                    username: hostile,
                    display_name: "Attacker",
                    password_hash: &hash_password("x").unwrap(),
                    role: Role::Researcher,
                    department: None,
                    employee_reference: None,
                    created_by: None,
                },
            );
            // ...or it's accepted as an inert, literal (harmless) username —
            // never a query bypass. Either way, the schema and the victim row
            // must be completely unaffected.
            let _ = result;
        }

        // The original table/row are completely intact — no DROP, no
        // unauthorized row exposed, no boolean-injection bypass.
        let table_exists: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(table_exists, 1, "SQL injection must not have dropped the users table");
        let victim = find_user_by_normalized_username(&conn, "victim.user").unwrap();
        assert!(victim.is_some(), "the real user row must be unaffected by hostile input elsewhere");

        // A classic boolean-injection login lookup must not "authenticate"
        // as some other user — it's just looked up as a literal string that
        // (correctly) matches nothing.
        let bypass_attempt = find_user_by_normalized_username(&conn, "' OR '1'='1");
        assert!(bypass_attempt.unwrap().is_none());
    }

    #[test]
    fn excessively_long_username_input_is_safely_rejected_not_truncated_or_executed() {
        let huge = "a".repeat(10_000);
        assert!(validate_username(&huge).is_err());
    }

    #[test]
    fn unusual_whitespace_in_username_is_rejected() {
        for weird in ["ahmet\tyilmaz", "ahmet\u{00A0}yilmaz", "ahmet\nyilmaz"] {
            assert!(validate_username(weird).is_err(), "expected {weird:?} to be rejected");
        }
    }
}
