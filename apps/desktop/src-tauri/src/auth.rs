// Phase 13 Session 2 — Administrator bootstrap, username/password
// login/logout, and authenticated session lifecycle.
//
// This module is the ONLY caller of `identity.rs`'s primitives outside that
// module's own tests. It owns the actual login/bootstrap/lockout POLICY
// (thresholds, durations, the generic public error text) that Session 1
// deliberately left as caller-supplied parameters — see
// `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §16/§17.
//
// Every real decision lives in a plain function taking `&Connection` (or
// `&mut Connection` for bootstrap, which needs a transaction) — never an
// `AppHandle` — so it is directly unit-testable against the same disposable
// temp-database pattern `identity.rs` already uses, with no Tauri test
// harness required. The `#[tauri::command]` wrappers at the bottom of this
// file are intentionally thin: resolve `identity.db`, call the logic
// function, return its result.
//
// The frontend NEVER supplies a role, user id, or approval authority to any
// command here — every function below derives identity and role
// exclusively from the stored `users` row a validated session or a
// successful password check resolves to.
use rusqlite::Connection;
use serde::Serialize;
use tauri::AppHandle;

use crate::identity::{self, User};

// --------------------------------------------------------------- policy ---

/// Consecutive failed attempts before an account is temporarily locked.
/// Session 1 tested the mechanism at this same value; Session 2 makes it
/// the actual application policy (architecture doc §17/§12 of the phase
/// brief). A simple, defensible local-desktop default — not tuned against
/// real usability data yet (see the architecture doc's open decisions).
pub(crate) const LOGIN_LOCKOUT_THRESHOLD: i64 = 5;
/// 15 minutes. Ordinary mistyped-password lockouts are always temporary —
/// this is not an administrator-intervention-required lock.
pub(crate) const LOGIN_LOCKOUT_SECS: i64 = 15 * 60;
/// Absolute session lifetime: 12 hours. A session is invalid past this
/// point no matter how recently it was used.
pub(crate) const SESSION_TTL_SECS: i64 = 12 * 60 * 60;
/// Inactivity timeout: 60 minutes. A session unused for this long is
/// invalid even if its absolute lifetime hasn't elapsed yet.
pub(crate) const SESSION_IDLE_TIMEOUT_SECS: i64 = 60 * 60;
/// The one public error for every login failure shape (unknown username,
/// wrong password, disabled account, locked account) — architecture doc
/// §11/§13. Internal audit/login_attempts rows may record the real reason;
/// this string is the only thing ever returned to the frontend.
pub(crate) const GENERIC_LOGIN_ERROR: &str = "Invalid username or password.";

/// A password this long is never legitimate for a login attempt; rejecting
/// it before touching Argon2 avoids letting an oversized-password login
/// attempt spend disproportionate CPU (Argon2's cost scales with input
/// size) as a cheap denial-of-service lever against the login command.
const MAX_LOGIN_PASSWORD_LEN: usize = 512;
const MIN_NEW_PASSWORD_LEN: usize = 8;
const MAX_NEW_PASSWORD_LEN: usize = 512;
const MAX_DISPLAY_NAME_LEN: usize = 200;

// ------------------------------------------------------------- wire types ---

/// The safe, frontend-facing projection of `identity::User` — never
/// includes `password_hash` or any other secret. This is the shape the new
/// authenticated `UserContext` (frontend) is built from; it is identity/
/// session context, not a permissions array — role-to-capability
/// derivation stays a later session's `rolePolicy.ts` (architecture doc
/// §20/§7).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeUser {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub account_status: String,
    pub must_change_password: bool,
}

impl From<&User> for SafeUser {
    fn from(u: &User) -> Self {
        SafeUser {
            user_id: u.id.clone(),
            username: u.username.clone(),
            display_name: u.display_name.clone(),
            role: u.role.as_str().to_string(),
            account_status: u.status.clone(),
            must_change_password: u.must_change_password,
        }
    }
}

/// Returned by bootstrap and login: the safe user projection plus the raw
/// bearer session token (handed out exactly once — only its hash is ever
/// persisted, see `identity::create_session`). `expires_at` is epoch
/// seconds as a decimal string, matching every other timestamp this module
/// stores (`identity::now_iso`'s convention).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub user: SafeUser,
    pub token: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatusResult {
    pub bootstrap_required: bool,
}

// -------------------------------------------------------- pure logic ---

pub(crate) fn bootstrap_status_logic(conn: &Connection) -> Result<BootstrapStatusResult, String> {
    Ok(BootstrapStatusResult { bootstrap_required: !identity::any_administrator_exists(conn)? })
}

/// No complexity rules beyond a length floor/ceiling — Session 1/2 never
/// specified a complexity policy, and inventing one here (uppercase/digit/
/// symbol requirements) would be scope creep beyond what was asked. Applies
/// only to *new* passwords being set (bootstrap here; Administration ->
/// Users' admin-set passwords in Session 5) — never to a login attempt's
/// input, which must always be checked against the stored hash regardless
/// of whether it happens to satisfy this policy.
fn validate_new_password(password: &str) -> Result<(), String> {
    let len = password.chars().count();
    if len < MIN_NEW_PASSWORD_LEN {
        return Err(format!("password must be at least {MIN_NEW_PASSWORD_LEN} characters"));
    }
    if len > MAX_NEW_PASSWORD_LEN {
        return Err("password is too long".into());
    }
    Ok(())
}

/// First-run Administrator creation. Never accepts a role parameter — the
/// role is always `Administrator`, enforced by `identity::bootstrap_administrator`
/// itself (§6 of the phase brief: "Never show a role dropdown on bootstrap").
pub(crate) fn bootstrap_create_administrator_logic(
    conn: &mut Connection,
    username: &str,
    display_name: &str,
    password: &str,
    confirm_password: &str,
) -> Result<AuthSession, String> {
    if password != confirm_password {
        return Err("passwords do not match".into());
    }
    validate_new_password(password)?;
    identity::validate_username(username)?;
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > MAX_DISPLAY_NAME_LEN {
        return Err("display name is required".into());
    }
    let password_hash = identity::hash_password(password)?;
    let user = identity::bootstrap_administrator(conn, username, display_name, &password_hash)?;
    identity::record_security_audit_event(
        conn,
        Some(&user.id),
        Some(&user.id),
        "bootstrap_administrator_created",
        "success",
        Some(&format!("username={}", user.username)),
    )?;
    // Chosen UX (documented, architecture doc §5): auto-enter FormuLab
    // rather than bouncing the just-created administrator to a second
    // Login screen for credentials they typed 10 seconds ago.
    let session = identity::create_session(conn, &user.id, SESSION_TTL_SECS)?;
    Ok(AuthSession { user: SafeUser::from(&user), token: session.token, expires_at: session.expires_at })
}

/// The internal (never frontend-visible) reason a login attempt failed —
/// used only for `login_attempts`/`security_audit_events` rows. The public
/// return value is always the identical `GENERIC_LOGIN_ERROR` string
/// regardless of which of these applies.
enum LoginFailure {
    UnknownUsername,
    AccountDisabled,
    AccountLocked,
    InvalidInput,
}

impl LoginFailure {
    fn attempt_outcome(&self) -> &'static str {
        match self {
            LoginFailure::UnknownUsername => "unknown_username",
            LoginFailure::AccountDisabled => "account_disabled",
            LoginFailure::AccountLocked => "account_locked",
            LoginFailure::InvalidInput => "invalid_input",
        }
    }
}

pub(crate) fn login_logic(conn: &Connection, username: &str, password: &str) -> Result<AuthSession, String> {
    // Oversized input is rejected before ever touching the database or
    // Argon2 — never distinguished from any other failure to the caller.
    if password.chars().count() > MAX_LOGIN_PASSWORD_LEN {
        return Err(fail_login(conn, &identity::normalize_username(username), None, LoginFailure::InvalidInput));
    }

    let normalized = identity::normalize_username(username);
    let user_opt = if identity::validate_username(username).is_ok() {
        identity::find_user_by_normalized_username(conn, &normalized)?
    } else {
        // Malformed username (too long, disallowed characters, etc.) is
        // handled exactly like "unknown username" — the shape/validity of
        // the username itself is never a distinguishable signal.
        None
    };

    let Some(user) = user_opt else {
        let _ = identity::verify_password(password, identity::dummy_password_hash());
        return Err(fail_login(conn, &normalized, None, LoginFailure::UnknownUsername));
    };

    if user.status != "active" {
        let _ = identity::verify_password(password, identity::dummy_password_hash());
        return Err(fail_login(conn, &normalized, Some(&user.id), LoginFailure::AccountDisabled));
    }

    if identity::is_locked(&user) {
        let _ = identity::verify_password(password, identity::dummy_password_hash());
        return Err(fail_login(conn, &normalized, Some(&user.id), LoginFailure::AccountLocked));
    }

    let ok = identity::verify_password(password, &user.password_hash);
    let pre_count = user.failed_login_count;
    identity::update_login_state(conn, &user.id, ok, LOGIN_LOCKOUT_THRESHOLD, LOGIN_LOCKOUT_SECS)?;
    identity::record_login_attempt(conn, &normalized, if ok { "success" } else { "invalid_password" }, None)?;

    if !ok {
        identity::record_security_audit_event(
            conn,
            None,
            Some(&user.id),
            "login_failure",
            "failure",
            Some("invalid_password"),
        )?;
        if pre_count + 1 >= LOGIN_LOCKOUT_THRESHOLD {
            identity::record_security_audit_event(
                conn,
                None,
                Some(&user.id),
                "login_lockout_triggered",
                "locked",
                None,
            )?;
        }
        return Err(GENERIC_LOGIN_ERROR.to_string());
    }

    identity::record_security_audit_event(conn, Some(&user.id), Some(&user.id), "login_success", "success", None)?;
    let session = identity::create_session(conn, &user.id, SESSION_TTL_SECS)?;
    // Re-read: update_login_state just touched failed_login_count/last_login_at.
    let fresh = identity::find_user_by_id(conn, &user.id)?.ok_or("user vanished immediately after login")?;
    Ok(AuthSession { user: SafeUser::from(&fresh), token: session.token, expires_at: session.expires_at })
}

/// Records the login_attempts + security_audit_events rows for a failed
/// login and returns the one generic public error string. Centralized here
/// so every failure branch above logs consistently and cannot accidentally
/// leak a distinguishing message.
fn fail_login(conn: &Connection, normalized_username: &str, user_id: Option<&str>, reason: LoginFailure) -> String {
    let _ = identity::record_login_attempt(conn, normalized_username, reason.attempt_outcome(), None);
    let _ = identity::record_security_audit_event(
        conn,
        None,
        user_id,
        "login_failure",
        "failure",
        Some(reason.attempt_outcome()),
    );
    GENERIC_LOGIN_ERROR.to_string()
}

pub(crate) fn logout_logic(conn: &Connection, token: &str) -> Result<(), String> {
    // Resolve attribution before revoking (revoking makes the token invalid).
    let user = identity::validate_session(conn, token, SESSION_IDLE_TIMEOUT_SECS)?;
    identity::revoke_session(conn, token)?;
    if let Some(u) = user {
        identity::record_security_audit_event(conn, Some(&u.id), Some(&u.id), "logout", "success", None)?;
    }
    Ok(())
}

/// Startup/route-guard check: resolves the currently authenticated user
/// from a persisted token, or `None` if it's missing/expired/idle-timed-out/
/// revoked/disabled/deleted. Never distinguishes *why* to the caller —
/// every failure shape routes back to Login the same way.
pub(crate) fn current_session_logic(conn: &Connection, token: &str) -> Result<Option<SafeUser>, String> {
    let user = identity::validate_session(conn, token, SESSION_IDLE_TIMEOUT_SECS)?;
    Ok(user.as_ref().map(SafeUser::from))
}

// -------------------------------------------------------- commands ---

#[tauri::command(async)]
pub async fn bootstrap_status(app: AppHandle) -> Result<BootstrapStatusResult, String> {
    let conn = identity::open_identity_db(&app)?;
    bootstrap_status_logic(&conn)
}

#[tauri::command(async)]
pub async fn bootstrap_create_administrator(
    app: AppHandle,
    username: String,
    display_name: String,
    password: String,
    confirm_password: String,
) -> Result<AuthSession, String> {
    let mut conn = identity::open_identity_db(&app)?;
    bootstrap_create_administrator_logic(&mut conn, &username, &display_name, &password, &confirm_password)
}

#[tauri::command(async)]
pub async fn login(app: AppHandle, username: String, password: String) -> Result<AuthSession, String> {
    let conn = identity::open_identity_db(&app)?;
    login_logic(&conn, &username, &password)
}

#[tauri::command(async)]
pub async fn logout(app: AppHandle, token: String) -> Result<(), String> {
    let conn = identity::open_identity_db(&app)?;
    logout_logic(&conn, &token)
}

#[tauri::command(async)]
pub async fn current_session(app: AppHandle, token: String) -> Result<Option<SafeUser>, String> {
    let conn = identity::open_identity_db(&app)?;
    current_session_logic(&conn, &token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{hash_password, open_at, NewUser, Role};

    fn tmp_conn(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("formulab-auth-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        open_at(&dir.join("identity.db")).unwrap()
    }

    fn bootstrap(conn: &mut Connection, username: &str, password: &str) -> AuthSession {
        bootstrap_create_administrator_logic(conn, username, "Test Administrator", password, password).unwrap()
    }

    fn seed_plain_user(conn: &Connection, username: &str, role: Role, password: &str) -> User {
        identity::create_user(
            conn,
            NewUser {
                username,
                display_name: "Plain User",
                password_hash: &hash_password(password).unwrap(),
                role,
                department: None,
                employee_reference: None,
                created_by: None,
            },
        )
        .unwrap()
    }

    // ------------------------------------------------------- bootstrap ---

    #[test]
    fn fresh_database_reports_bootstrap_required() {
        let conn = tmp_conn("boot-fresh");
        assert!(bootstrap_status_logic(&conn).unwrap().bootstrap_required);
    }

    #[test]
    fn bootstrap_creates_administrator_and_enters_an_authenticated_session() {
        let mut conn = tmp_conn("boot-create");
        let result = bootstrap(&mut conn, "root.admin", "correct-horse-battery");
        assert_eq!(result.user.role, "administrator");
        assert!(!result.token.is_empty());
        assert!(!result.user.must_change_password);
        assert!(!bootstrap_status_logic(&conn).unwrap().bootstrap_required);
    }

    #[test]
    fn bootstrap_password_is_never_returned_and_only_the_hash_is_stored() {
        let mut conn = tmp_conn("boot-no-plaintext");
        bootstrap(&mut conn, "root.admin2", "hunter2-do-not-leak-me");
        let stored: String =
            conn.query_row("SELECT password_hash FROM users", [], |r| r.get(0)).unwrap();
        assert!(!stored.contains("hunter2-do-not-leak-me"));
    }

    #[test]
    fn second_bootstrap_is_rejected_including_a_direct_backend_call() {
        let mut conn = tmp_conn("boot-second");
        bootstrap(&mut conn, "first.admin", "first-password-123");
        let err = bootstrap_create_administrator_logic(
            &mut conn,
            "second.admin",
            "Second Admin",
            "second-password-123",
            "second-password-123",
        )
        .unwrap_err();
        assert!(err.contains("already exists"));
        assert!(!bootstrap_status_logic(&conn).unwrap().bootstrap_required);
    }

    #[test]
    fn bootstrap_rejects_mismatched_confirmation_and_weak_password() {
        let mut conn = tmp_conn("boot-validation");
        let err = bootstrap_create_administrator_logic(&mut conn, "admin", "Admin", "abc12345", "different").unwrap_err();
        assert!(err.contains("match"));
        let err2 = bootstrap_create_administrator_logic(&mut conn, "admin", "Admin", "short", "short").unwrap_err();
        assert!(err2.contains("8 characters"));
        assert!(bootstrap_status_logic(&conn).unwrap().bootstrap_required, "a rejected bootstrap must not create anyone");
    }

    #[test]
    fn no_default_administrator_credentials_ever_work() {
        let conn = tmp_conn("boot-no-default-creds");
        for (u, p) in [("admin", "admin"), ("administrator", "password"), ("admin", "")] {
            let err = login_logic(&conn, u, p).unwrap_err();
            assert_eq!(err, GENERIC_LOGIN_ERROR);
        }
    }

    // ----------------------------------------------------------- login ---

    #[test]
    fn correct_credentials_log_in_successfully() {
        let mut conn = tmp_conn("login-ok");
        bootstrap(&mut conn, "ok.admin", "correct-password-1");
        let result = login_logic(&conn, "ok.admin", "correct-password-1").unwrap();
        assert_eq!(result.user.username, "ok.admin");
        assert!(!result.token.is_empty());
    }

    #[test]
    fn username_case_normalization_works_for_login() {
        let mut conn = tmp_conn("login-case");
        bootstrap(&mut conn, "case.admin", "correct-password-1");
        let result = login_logic(&conn, "Case.Admin", "correct-password-1").unwrap();
        assert_eq!(result.user.username, "case.admin");
    }

    #[test]
    fn wrong_password_and_unknown_username_return_the_identical_public_error() {
        let mut conn = tmp_conn("login-generic-error");
        bootstrap(&mut conn, "known.user", "correct-password-1");
        let wrong_password_err = login_logic(&conn, "known.user", "totally-wrong").unwrap_err();
        let unknown_user_err = login_logic(&conn, "nobody.here", "whatever").unwrap_err();
        assert_eq!(wrong_password_err, GENERIC_LOGIN_ERROR);
        assert_eq!(unknown_user_err, GENERIC_LOGIN_ERROR);
        assert_eq!(
            wrong_password_err, unknown_user_err,
            "unknown username and wrong password must be indistinguishable to the caller"
        );
    }

    #[test]
    fn disabled_account_cannot_log_in_even_with_the_correct_password() {
        let mut conn = tmp_conn("login-disabled");
        let session = bootstrap(&mut conn, "disable.me", "correct-password-1");
        identity::update_account_status(&conn, &session.user.user_id, false).unwrap();
        let err = login_logic(&conn, "disable.me", "correct-password-1").unwrap_err();
        assert_eq!(err, GENERIC_LOGIN_ERROR);
    }

    #[test]
    fn malformed_login_input_is_rejected_safely_without_panicking() {
        let mut conn = tmp_conn("login-malformed");
        bootstrap(&mut conn, "victim.acct", "correct-password-1");
        let hostiles = ["' OR '1'='1", "admin'--", "", "victim.acct' --"];
        for h in hostiles {
            let err = login_logic(&conn, h, "whatever").unwrap_err();
            assert_eq!(err, GENERIC_LOGIN_ERROR);
        }
        let huge_password = "x".repeat(1_000_000);
        let err = login_logic(&conn, "victim.acct", &huge_password).unwrap_err();
        assert_eq!(err, GENERIC_LOGIN_ERROR);
        // The real account must still be completely intact and able to log in normally.
        assert!(login_logic(&conn, "victim.acct", "correct-password-1").is_ok());
    }

    // --------------------------------------------------------- lockout ---

    #[test]
    fn four_failures_do_not_lock_a_fifth_does_and_success_resets() {
        let mut conn = tmp_conn("lockout-threshold");
        bootstrap(&mut conn, "lockout.user", "correct-password-1");
        for _ in 0..4 {
            login_logic(&conn, "lockout.user", "wrong").unwrap_err();
        }
        // Still unlocked: the correct password works on attempt 5's worth of state.
        assert!(login_logic(&conn, "lockout.user", "correct-password-1").is_ok());

        // Now actually reach the threshold with real failures.
        for _ in 0..LOGIN_LOCKOUT_THRESHOLD {
            login_logic(&conn, "lockout.user", "wrong").unwrap_err();
        }
        let locked_err = login_logic(&conn, "lockout.user", "correct-password-1").unwrap_err();
        assert_eq!(locked_err, GENERIC_LOGIN_ERROR, "even the correct password must be refused while locked");
    }

    #[test]
    fn an_expired_lock_allows_login_attempts_again() {
        let mut conn = tmp_conn("lockout-expiry");
        let session = bootstrap(&mut conn, "expiring.lock", "correct-password-1");
        for _ in 0..LOGIN_LOCKOUT_THRESHOLD {
            login_logic(&conn, "expiring.lock", "wrong").unwrap_err();
        }
        assert!(login_logic(&conn, "expiring.lock", "correct-password-1").is_err(), "must still be locked");
        // Simulate the lock having already expired (no real sleep needed).
        let past = (identity::now_iso().parse::<i64>().unwrap() - 1).to_string();
        conn.execute("UPDATE users SET locked_until = ?1 WHERE id = ?2", rusqlite::params![past, session.user.user_id])
            .unwrap();
        assert!(login_logic(&conn, "expiring.lock", "correct-password-1").is_ok(), "an expired lock must allow login again");
    }

    #[test]
    fn lockout_state_persists_across_a_database_reopen() {
        let dir = std::env::temp_dir().join(format!("formulab-auth-test-lockout-reopen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("identity.db");
        {
            let mut conn = open_at(&path).unwrap();
            bootstrap(&mut conn, "reopen.lock", "correct-password-1");
            for _ in 0..LOGIN_LOCKOUT_THRESHOLD {
                login_logic(&conn, "reopen.lock", "wrong").unwrap_err();
            }
        }
        let conn2 = open_at(&path).unwrap();
        let err = login_logic(&conn2, "reopen.lock", "correct-password-1").unwrap_err();
        assert_eq!(err, GENERIC_LOGIN_ERROR, "lockout must survive a process restart, not just live in memory");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // --------------------------------------------------------- session ---

    #[test]
    fn a_valid_session_is_returned_by_current_session_logic() {
        let mut conn = tmp_conn("session-valid");
        let s = bootstrap(&mut conn, "sess.user", "correct-password-1");
        let current = current_session_logic(&conn, &s.token).unwrap();
        assert_eq!(current.unwrap().username, "sess.user");
    }

    #[test]
    fn an_expired_session_is_rejected_by_current_session_logic() {
        let mut conn = tmp_conn("session-expired");
        let s = bootstrap(&mut conn, "exp.user", "correct-password-1");
        // Force absolute expiry into the past directly (bootstrap always issues a live 12h session).
        let past = (identity::now_iso().parse::<i64>().unwrap() - 10).to_string();
        conn.execute(
            "UPDATE authenticated_sessions SET expires_at = ?1 WHERE user_id = ?2",
            rusqlite::params![past, s.user.user_id],
        )
        .unwrap();
        assert!(current_session_logic(&conn, &s.token).unwrap().is_none());
    }

    #[test]
    fn logout_revokes_the_session_and_it_no_longer_validates() {
        let mut conn = tmp_conn("logout-revokes");
        let s = bootstrap(&mut conn, "logout.user", "correct-password-1");
        assert!(current_session_logic(&conn, &s.token).unwrap().is_some());
        logout_logic(&conn, &s.token).unwrap();
        assert!(current_session_logic(&conn, &s.token).unwrap().is_none());
    }

    #[test]
    fn logging_out_an_unknown_or_already_revoked_token_does_not_error() {
        let mut conn = tmp_conn("logout-idempotent");
        let s = bootstrap(&mut conn, "logout.twice", "correct-password-1");
        logout_logic(&conn, &s.token).unwrap();
        logout_logic(&conn, &s.token).unwrap(); // second logout: still not an error
        logout_logic(&conn, "not-a-real-token-at-all").unwrap();
    }

    #[test]
    fn a_role_change_is_reflected_on_the_very_next_session_check() {
        let mut conn = tmp_conn("session-role-change");
        let s = bootstrap(&mut conn, "role.change", "correct-password-1");
        assert_eq!(current_session_logic(&conn, &s.token).unwrap().unwrap().role, "administrator");
        identity::update_role(&conn, &s.user.user_id, Role::Researcher).unwrap();
        assert_eq!(
            current_session_logic(&conn, &s.token).unwrap().unwrap().role,
            "researcher",
            "the same still-valid session must reflect the new role immediately, not a stale snapshot"
        );
    }

    #[test]
    fn a_malformed_or_garbage_token_validates_to_none_not_an_error() {
        let conn = tmp_conn("session-garbage-token");
        assert!(current_session_logic(&conn, "").unwrap().is_none());
        assert!(current_session_logic(&conn, "' OR '1'='1").unwrap().is_none());
        assert!(current_session_logic(&conn, &"a".repeat(10_000)).unwrap().is_none());
    }

    // ----------------------------------------------------------- audit ---

    #[test]
    fn bootstrap_login_success_login_failure_lockout_and_logout_all_produce_audit_events() {
        let mut conn = tmp_conn("audit-coverage");
        let s = bootstrap(&mut conn, "audit.user", "correct-password-1");
        login_logic(&conn, "audit.user", "correct-password-1").unwrap();
        login_logic(&conn, "audit.user", "wrong").unwrap_err();
        for _ in 0..LOGIN_LOCKOUT_THRESHOLD {
            login_logic(&conn, "audit.user", "wrong").unwrap_err();
        }
        logout_logic(&conn, &s.token).unwrap();

        let mut stmt = conn.prepare("SELECT action FROM security_audit_events").unwrap();
        let actions: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        for expected in [
            "bootstrap_administrator_created",
            "login_success",
            "login_failure",
            "login_lockout_triggered",
            "logout",
        ] {
            assert!(actions.iter().any(|a| a == expected), "expected an audit row with action={expected:?}, got {actions:?}");
        }
    }

    #[test]
    fn no_audit_row_or_login_attempt_row_ever_contains_a_password_hash_or_raw_session_token() {
        let mut conn = tmp_conn("audit-no-secrets");
        let s = bootstrap(&mut conn, "secret.user", "super-secret-password-1");
        login_logic(&conn, "secret.user", "super-secret-password-1").unwrap();
        login_logic(&conn, "secret.user", "wrong-guess").unwrap_err();
        logout_logic(&conn, &s.token).unwrap();

        let stored_hash: String =
            conn.query_row("SELECT password_hash FROM users WHERE id = ?1", rusqlite::params![s.user.user_id], |r| r.get(0)).unwrap();

        let mut audit_stmt = conn.prepare("SELECT detail FROM security_audit_events").unwrap();
        let audit_details: Vec<Option<String>> = audit_stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        for d in audit_details.into_iter().flatten() {
            assert!(!d.contains(&stored_hash));
            assert!(!d.contains(&s.token));
            assert!(!d.contains("super-secret-password-1"));
        }

        let mut attempt_stmt = conn.prepare("SELECT outcome FROM login_attempts").unwrap();
        let outcomes: Vec<String> = attempt_stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        for o in outcomes {
            assert!(!o.contains(&stored_hash));
            assert!(!o.contains(&s.token));
        }
    }

    // -------------------------------------------------------- security ---

    #[test]
    fn sql_injection_shaped_usernames_are_inert_through_the_full_login_path() {
        let mut conn = tmp_conn("login-sqli");
        bootstrap(&mut conn, "victim.real", "correct-password-1");
        for hostile in ["admin'--", "'; DROP TABLE users;--", "' OR '1'='1", "victim.real' OR '1'='1"] {
            let err = login_logic(&conn, hostile, "anything").unwrap_err();
            assert_eq!(err, GENERIC_LOGIN_ERROR);
        }
        let table_exists: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(table_exists, 1, "SQL injection through the login path must not have dropped the users table");
        assert!(login_logic(&conn, "victim.real", "correct-password-1").is_ok(), "the real account must be unaffected");
    }

    #[test]
    fn bootstrap_always_creates_administrator_never_a_caller_chosen_role() {
        // Structural: bootstrap_create_administrator_logic has no role parameter at
        // all — there is no code path through which a caller (frontend or a direct
        // invocation) could request a different role for the first account.
        let mut conn = tmp_conn("boot-role-forced");
        let result = bootstrap(&mut conn, "forced.role", "correct-password-1");
        assert_eq!(result.user.role, "administrator");
    }

    #[test]
    fn a_plain_employee_tier_user_created_directly_cannot_bootstrap_a_second_administrator() {
        // Even a directly-inserted non-bootstrap user existing doesn't open or
        // close bootstrap by itself — only an existing `administrator` role does
        // (identity::any_administrator_exists is keyed on role, not row count).
        let conn = tmp_conn("boot-employee-present");
        seed_plain_user(&conn, "just.a.researcher", Role::Researcher, "whatever-1");
        assert!(bootstrap_status_logic(&conn).unwrap().bootstrap_required);
    }
}
