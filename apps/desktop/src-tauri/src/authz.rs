// Phase 13 Session 4 — the one reusable Rust authorization path every
// privileged command calls, so the guard logic exists exactly once rather
// than being reimplemented per command:
//
//   session token -> validate_session -> active account -> stored role
//   -> role_policy::can(role, area, capability) -> allow/deny
//
// Fails closed at every step: no token, an unknown/expired/idle-timed-out/
// revoked token, or a disabled account all resolve to "not authenticated"
// the same way `identity::validate_session` already treats them (Session
// 2), which this module never second-guesses or works around. The
// `TrustedActor` this returns is sourced entirely from the `users` row the
// session resolved to — a caller-supplied role, userId, or displayName is
// never read by this module at all, so there is no field here for the
// frontend to spoof (architecture doc §9.1/§9.3).
use rusqlite::Connection;
use tauri::AppHandle;

use crate::identity;

/// The authenticated identity a privileged command may trust for both
/// authorization and attribution — never anything the caller claimed.
#[derive(Debug, Clone)]
pub struct TrustedActor {
    pub user_id: String,
    pub role: String,
    pub display_name: String,
}

/// Resolves the trusted actor from a session token with no area/capability
/// check — "is there a currently valid, active, authenticated user behind
/// this token." Used by commands that need a real identity to attribute an
/// action to (e.g. `append_audit_event`) but authorize the underlying
/// mutation separately, or don't gate on one specific capability.
pub(crate) fn current_actor(conn: &Connection, token: &str) -> Result<TrustedActor, String> {
    let user = identity::validate_session(conn, token, crate::auth::SESSION_IDLE_TIMEOUT_SECS)?
        .ok_or_else(|| "not authenticated: sign in and try again".to_string())?;
    Ok(TrustedActor {
        user_id: user.id,
        role: user.role.as_str().to_string(),
        display_name: user.display_name,
    })
}

/// The full guard. Resolves the trusted actor and checks the canonical
/// policy (`role_policy::can`) grants `capability` on `area` to that
/// actor's *stored* role. A denial is recorded to `security_audit_events`
/// using the trusted actor's own resolved identity (or `None`/`None` when
/// there wasn't even a valid session to resolve) — never anything the
/// caller's payload claimed, so a denial entry can never be forged to
/// implicate a different user. Errors are deliberately generic (never
/// distinguish "no session" from "wrong role" to the caller) to avoid
/// handing a probing script a map of who's authorized for what.
pub(crate) fn authorize(conn: &Connection, token: &str, area: &str, capability: &str) -> Result<TrustedActor, String> {
    let actor = match current_actor(conn, token) {
        Ok(a) => a,
        Err(_) => {
            let _ = identity::record_security_audit_event(
                conn,
                None,
                None,
                "authorization_denied",
                "denied",
                Some(&format!("area={area} capability={capability} reason=no_valid_session")),
            );
            return Err("not authorized".to_string());
        }
    };
    if !crate::role_policy::can(&actor.role, area, capability) {
        let _ = identity::record_security_audit_event(
            conn,
            Some(&actor.user_id),
            Some(&actor.user_id),
            "authorization_denied",
            "denied",
            Some(&format!("role={} area={area} capability={capability}", actor.role)),
        );
        return Err("not authorized".to_string());
    }
    Ok(actor)
}

/// Convenience for the common Tauri-command-boundary case: open
/// `identity.db` from the `AppHandle` and run the full guard.
pub(crate) fn authorize_app(app: &AppHandle, token: &str, area: &str, capability: &str) -> Result<TrustedActor, String> {
    let conn = identity::open_identity_db(app)?;
    authorize(&conn, token, area, capability)
}

/// Like `authorize`, but grants access when the trusted role has ANY one of
/// several capabilities on `area` — for actions (like a masterdata upsert
/// that may insert new rows or update existing ones in the same call) that
/// don't cleanly reduce to a single capability. Denial is audited once,
/// with the joined capability list, not once per capability tried.
pub(crate) fn authorize_any(
    conn: &Connection,
    token: &str,
    area: &str,
    capabilities: &[&str],
) -> Result<TrustedActor, String> {
    let actor = match current_actor(conn, token) {
        Ok(a) => a,
        Err(_) => {
            let _ = identity::record_security_audit_event(
                conn,
                None,
                None,
                "authorization_denied",
                "denied",
                Some(&format!("area={area} capability={} reason=no_valid_session", capabilities.join("|"))),
            );
            return Err("not authorized".to_string());
        }
    };
    if !capabilities.iter().any(|cap| crate::role_policy::can(&actor.role, area, cap)) {
        let _ = identity::record_security_audit_event(
            conn,
            Some(&actor.user_id),
            Some(&actor.user_id),
            "authorization_denied",
            "denied",
            Some(&format!("role={} area={area} capability={}", actor.role, capabilities.join("|"))),
        );
        return Err("not authorized".to_string());
    }
    Ok(actor)
}

pub(crate) fn authorize_any_app(
    app: &AppHandle,
    token: &str,
    area: &str,
    capabilities: &[&str],
) -> Result<TrustedActor, String> {
    let conn = identity::open_identity_db(app)?;
    authorize_any(&conn, token, area, capabilities)
}

/// Convenience mirror of `current_actor` for the `AppHandle` boundary case.
pub(crate) fn current_actor_app(app: &AppHandle, token: &str) -> Result<TrustedActor, String> {
    let conn = identity::open_identity_db(app)?;
    current_actor(&conn, token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{hash_password, open_at, NewUser, Role};

    fn tmp_conn(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("formulab-authz-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        open_at(&dir.join("identity.db")).unwrap()
    }

    fn seed_user_with_session(conn: &Connection, username: &str, role: Role) -> (identity::User, String) {
        let user = identity::create_user(
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
        .unwrap();
        let session = identity::create_session(conn, &user.id, 12 * 60 * 60).unwrap();
        (user, session.token)
    }

    #[test]
    fn an_authorized_role_and_capability_returns_the_trusted_actor() {
        let conn = tmp_conn("allow");
        let (user, token) = seed_user_with_session(&conn, "admin.one", Role::Administrator);
        let actor = authorize(&conn, &token, "systemAdministration", "administer").unwrap();
        assert_eq!(actor.user_id, user.id);
        assert_eq!(actor.role, "administrator");
    }

    #[test]
    fn a_role_lacking_the_capability_is_denied_and_audited_with_the_real_identity() {
        let conn = tmp_conn("deny-role");
        let (user, token) = seed_user_with_session(&conn, "researcher.one", Role::Researcher);
        let err = authorize(&conn, &token, "systemAdministration", "administer").unwrap_err();
        assert_eq!(err, "not authorized");
        let detail: String = conn
            .query_row(
                "SELECT detail FROM security_audit_events WHERE action = 'authorization_denied' ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(detail.contains("role=researcher"));
        let actor_id: Option<String> = conn
            .query_row(
                "SELECT actor_user_id FROM security_audit_events WHERE action = 'authorization_denied' ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(actor_id.as_deref(), Some(user.id.as_str()), "the denial must attribute the REAL authenticated user, never a caller claim");
    }

    #[test]
    fn an_invalid_token_is_denied_and_never_returns_a_trusted_actor() {
        let conn = tmp_conn("deny-invalid-token");
        let err = authorize(&conn, "not-a-real-token", "formulation", "view").unwrap_err();
        assert_eq!(err, "not authorized");
    }

    #[test]
    fn a_revoked_session_is_denied() {
        let conn = tmp_conn("deny-revoked");
        let (_, token) = seed_user_with_session(&conn, "revoked.user", Role::Administrator);
        identity::revoke_session(&conn, &token).unwrap();
        let err = authorize(&conn, &token, "systemAdministration", "administer").unwrap_err();
        assert_eq!(err, "not authorized");
    }

    #[test]
    fn an_expired_session_is_denied() {
        let conn = tmp_conn("deny-expired");
        let (user, token) = seed_user_with_session(&conn, "expired.user", Role::Administrator);
        let past = (identity::now_iso().parse::<i64>().unwrap() - 10).to_string();
        conn.execute(
            "UPDATE authenticated_sessions SET expires_at = ?1 WHERE user_id = ?2",
            rusqlite::params![past, user.id],
        )
        .unwrap();
        let err = authorize(&conn, &token, "systemAdministration", "administer").unwrap_err();
        assert_eq!(err, "not authorized");
    }

    #[test]
    fn a_disabled_account_is_denied_even_with_an_otherwise_valid_token() {
        let conn = tmp_conn("deny-disabled");
        let (user, token) = seed_user_with_session(&conn, "disabled.user", Role::Administrator);
        identity::update_account_status(&conn, &user.id, false).unwrap();
        let err = authorize(&conn, &token, "systemAdministration", "administer").unwrap_err();
        assert_eq!(err, "not authorized");
    }

    #[test]
    fn a_role_change_takes_effect_on_the_very_next_authorization_check() {
        let conn = tmp_conn("role-change-effect");
        let (user, token) = seed_user_with_session(&conn, "promote.me", Role::Researcher);
        assert!(authorize(&conn, &token, "systemAdministration", "administer").is_err());
        identity::update_role(&conn, &user.id, Role::Administrator).unwrap();
        let actor = authorize(&conn, &token, "systemAdministration", "administer").unwrap();
        assert_eq!(actor.role, "administrator", "the same still-valid session must reflect the new role immediately");
    }

    #[test]
    fn current_actor_never_trusts_a_caller_supplied_identity_there_is_no_such_parameter() {
        // Structural: current_actor()/authorize() take only (conn, token,
        // area, capability) — there is no role/userId/displayName parameter
        // anywhere in either signature for a caller to supply in the first
        // place. This test exists as a compile-time-shaped assertion: if a
        // future edit ever adds such a parameter, every call site (and this
        // test's own call shape) breaks loudly rather than silently trusting it.
        let conn = tmp_conn("no-spoofable-param");
        let (_, token) = seed_user_with_session(&conn, "spoof.check", Role::Administrator);
        let actor = current_actor(&conn, &token).unwrap();
        assert_eq!(actor.role, "administrator");
    }
}
