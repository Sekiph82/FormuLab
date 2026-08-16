// Phase 13 Session 5 — Administration → Users: the account-management
// commands the architecture doc's §13 design (Session 5) calls for. Every
// command here is gated through `authz::authorize_app` against the
// `administrationUsers`/`administrationSecurity` policy areas — per §6's
// matrix, currently administrator-only — so "only the appropriate
// Administrator authority may manage users" is enforced by the exact same
// mechanism every other Phase 13 privileged command uses, not a second
// authorization path invented for this screen. No caller-supplied role/
// user identity is ever trusted for authority: `authz::authorize_app`
// resolves the acting administrator from the authenticated session alone.
//
// Deliberately thin command wrappers over pure logic functions (this
// codebase's established `auth.rs`/`formulations.rs` pattern) so the
// account-management rules are directly unit-testable without a Tauri
// harness.
use rusqlite::Connection;
use tauri::AppHandle;

use crate::auth::{self, SafeUser, MAX_DISPLAY_NAME_LEN};
use crate::authz;
use crate::identity::{self, NewUser, Role, SecurityAuditEvent};

const AREA: &str = "administrationUsers";
const SECURITY_AREA: &str = "administrationSecurity";
const DEFAULT_AUDIT_LIMIT: i64 = 200;

fn trimmed_display_name(display_name: &str) -> Result<String, String> {
    let trimmed = display_name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_DISPLAY_NAME_LEN {
        return Err("display name is required".into());
    }
    Ok(trimmed.to_string())
}

fn optional_field(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

// -------------------------------------------------------------- list ---

#[tauri::command(async)]
pub async fn list_administered_users(app: AppHandle, token: String) -> Result<Vec<SafeUser>, String> {
    let conn = identity::open_identity_db(&app)?;
    authz::authorize(&conn, &token, AREA, "view")?;
    let users = identity::list_users(&conn)?;
    Ok(users.iter().map(SafeUser::from).collect())
}

// ------------------------------------------------------------- create ---

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_administered_user_logic(
    conn: &Connection,
    actor: &authz::TrustedActor,
    username: &str,
    display_name: &str,
    password: &str,
    confirm_password: &str,
    role: &str,
    department: Option<String>,
    employee_reference: Option<String>,
) -> Result<SafeUser, String> {
    if password != confirm_password {
        return Err("passwords do not match".into());
    }
    auth::validate_new_password(password)?;
    identity::validate_username(username)?;
    let display_name = trimmed_display_name(display_name)?;
    let role = Role::parse(role)?;
    let password_hash = identity::hash_password(password)?;

    let user = identity::create_user(
        conn,
        NewUser {
            username,
            display_name: &display_name,
            password_hash: &password_hash,
            role,
            department: optional_field(department).as_deref(),
            employee_reference: optional_field(employee_reference).as_deref(),
            created_by: Some(&actor.user_id),
        },
    )?;
    let _ = identity::record_security_audit_event(
        conn,
        Some(&actor.user_id),
        Some(&user.id),
        "admin_user_created",
        "success",
        Some(&format!("username={} role={}", user.username, user.role.as_str())),
    );
    Ok(SafeUser::from(&user))
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub async fn create_administered_user(
    app: AppHandle,
    token: String,
    username: String,
    display_name: String,
    password: String,
    confirm_password: String,
    role: String,
    department: Option<String>,
    employee_reference: Option<String>,
) -> Result<SafeUser, String> {
    let conn = identity::open_identity_db(&app)?;
    let actor = authz::authorize(&conn, &token, AREA, "create")?;
    create_administered_user_logic(
        &conn,
        &actor,
        &username,
        &display_name,
        &password,
        &confirm_password,
        &role,
        department,
        employee_reference,
    )
}

// --------------------------------------------------------- edit metadata ---

pub(crate) fn update_user_profile_logic(
    conn: &Connection,
    actor: &authz::TrustedActor,
    user_id: &str,
    display_name: &str,
    department: Option<String>,
    employee_reference: Option<String>,
) -> Result<SafeUser, String> {
    let display_name = trimmed_display_name(display_name)?;
    let existing = identity::find_user_by_id(conn, user_id)?.ok_or("no such user")?;
    identity::update_user_profile(conn, user_id, &display_name, optional_field(department).as_deref(), optional_field(employee_reference).as_deref())?;
    let _ = identity::record_security_audit_event(
        conn,
        Some(&actor.user_id),
        Some(user_id),
        "admin_user_profile_updated",
        "success",
        Some(&format!("username={}", existing.username)),
    );
    let updated = identity::find_user_by_id(conn, user_id)?.ok_or("user vanished during update")?;
    Ok(SafeUser::from(&updated))
}

#[tauri::command(async)]
pub async fn update_administered_user_profile(
    app: AppHandle,
    token: String,
    user_id: String,
    display_name: String,
    department: Option<String>,
    employee_reference: Option<String>,
) -> Result<SafeUser, String> {
    let conn = identity::open_identity_db(&app)?;
    let actor = authz::authorize(&conn, &token, AREA, "edit")?;
    update_user_profile_logic(&conn, &actor, &user_id, &display_name, department, employee_reference)
}

// --------------------------------------------------------- role change ---

/// Every one of the 12 fixed roles is a valid target — including
/// `administrator` (ordinary admin-created/edited users may hold it;
/// bootstrap's "only the very first administrator" restriction is a
/// bootstrap-specific rule, §5, not a general one). No custom role, no
/// per-user permission, is accepted — `Role::parse` rejects anything else.
///
/// Phase 13 closure session: routes through `identity::update_role_guarded`
/// (an `IMMEDIATE` transaction, not a plain `UPDATE`) so this can never
/// leave the installation with zero active administrators — see that
/// function's own doc comment for the concurrency reasoning. A denial is
/// still audited (`admin_user_role_change_denied`), using the *real*
/// authenticated actor, same as every other authorization denial in this
/// codebase.
pub(crate) fn change_user_role_logic(
    conn: &mut Connection,
    actor: &authz::TrustedActor,
    user_id: &str,
    role: &str,
) -> Result<SafeUser, String> {
    let new_role = Role::parse(role)?;
    let existing = identity::find_user_by_id(conn, user_id)?.ok_or("no such user")?;
    let previous_role = existing.role.as_str().to_string();
    if let Err(e) = identity::update_role_guarded(conn, user_id, new_role) {
        let _ = identity::record_security_audit_event(
            conn,
            Some(&actor.user_id),
            Some(user_id),
            "admin_user_role_change_denied",
            "denied",
            Some(&format!("from={previous_role} to={} reason=last_active_administrator", new_role.as_str())),
        );
        return Err(e);
    }
    let _ = identity::record_security_audit_event(
        conn,
        Some(&actor.user_id),
        Some(user_id),
        "admin_user_role_changed",
        "success",
        Some(&format!("from={previous_role} to={}", new_role.as_str())),
    );
    let updated = identity::find_user_by_id(conn, user_id)?.ok_or("user vanished during update")?;
    Ok(SafeUser::from(&updated))
}

#[tauri::command(async)]
pub async fn change_administered_user_role(
    app: AppHandle,
    token: String,
    user_id: String,
    role: String,
) -> Result<SafeUser, String> {
    let mut conn = identity::open_identity_db(&app)?;
    let actor = authz::authorize(&conn, &token, AREA, "edit")?;
    change_user_role_logic(&mut conn, &actor, &user_id, &role)
}

// ------------------------------------------------------------- status ---

/// Disabling revokes every open session immediately
/// (`identity::update_account_status_guarded`, same session-revocation
/// behavior Session 1's plain `update_account_status` always had) — the
/// same "fresh session validation" mechanism every other Phase 13 role/
/// status change relies on, not a second enforcement path built for this
/// screen. Phase 13 closure session: also guarded against disabling the
/// last active administrator, same `IMMEDIATE`-transaction shape and
/// audit-on-denial pattern as `change_user_role_logic`.
pub(crate) fn set_user_account_status_logic(
    conn: &mut Connection,
    actor: &authz::TrustedActor,
    user_id: &str,
    active: bool,
) -> Result<SafeUser, String> {
    let existing = identity::find_user_by_id(conn, user_id)?.ok_or("no such user")?;
    if let Err(e) = identity::update_account_status_guarded(conn, user_id, active) {
        let _ = identity::record_security_audit_event(
            conn,
            Some(&actor.user_id),
            Some(user_id),
            "admin_user_status_change_denied",
            "denied",
            Some(&format!("username={} requested_active={active} reason=last_active_administrator", existing.username)),
        );
        return Err(e);
    }
    let _ = identity::record_security_audit_event(
        conn,
        Some(&actor.user_id),
        Some(user_id),
        if active { "admin_user_activated" } else { "admin_user_disabled" },
        "success",
        Some(&format!("username={}", existing.username)),
    );
    let updated = identity::find_user_by_id(conn, user_id)?.ok_or("user vanished during update")?;
    Ok(SafeUser::from(&updated))
}

#[tauri::command(async)]
pub async fn set_administered_user_account_status(
    app: AppHandle,
    token: String,
    user_id: String,
    active: bool,
) -> Result<SafeUser, String> {
    let mut conn = identity::open_identity_db(&app)?;
    let actor = authz::authorize(&conn, &token, AREA, "administer")?;
    set_user_account_status_logic(&mut conn, &actor, &user_id, active)
}

// ------------------------------------------------------ password reset ---

/// Administrator-set passwords always force a change on next login —
/// `identity::update_password_hash` sets `must_change_password` itself,
/// unchanged since Session 1 — so this command never needs to duplicate
/// that policy. The new password is validated by the exact same
/// `auth::validate_new_password` bootstrap/self-service password-setting
/// already uses — one password policy, not a second one for this screen.
/// Never returns, logs, or otherwise persists the plaintext or the hash.
pub(crate) fn reset_user_password_logic(
    conn: &Connection,
    actor: &authz::TrustedActor,
    user_id: &str,
    new_password: &str,
    confirm_password: &str,
) -> Result<(), String> {
    if new_password != confirm_password {
        return Err("passwords do not match".into());
    }
    auth::validate_new_password(new_password)?;
    let existing = identity::find_user_by_id(conn, user_id)?.ok_or("no such user")?;
    let new_hash = identity::hash_password(new_password)?;
    identity::update_password_hash(conn, user_id, &new_hash)?;
    let _ = identity::record_security_audit_event(
        conn,
        Some(&actor.user_id),
        Some(user_id),
        "admin_user_password_reset",
        "success",
        Some(&format!("username={}", existing.username)),
    );
    Ok(())
}

#[tauri::command(async)]
pub async fn reset_administered_user_password(
    app: AppHandle,
    token: String,
    user_id: String,
    new_password: String,
    confirm_password: String,
) -> Result<(), String> {
    let conn = identity::open_identity_db(&app)?;
    let actor = authz::authorize(&conn, &token, AREA, "administer")?;
    reset_user_password_logic(&conn, &actor, &user_id, &new_password, &confirm_password)
}

// ----------------------------------------------------- security history ---

#[tauri::command(async)]
pub async fn read_security_audit_history(
    app: AppHandle,
    token: String,
    target_user_id: Option<String>,
) -> Result<Vec<SecurityAuditEvent>, String> {
    let conn = identity::open_identity_db(&app)?;
    authz::authorize(&conn, &token, SECURITY_AREA, "view")?;
    identity::list_security_audit_events(&conn, target_user_id.as_deref(), DEFAULT_AUDIT_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{hash_password, open_at, User};

    fn tmp_conn(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("formulab-admin-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        open_at(&dir.join("identity.db")).unwrap()
    }

    fn actor(user_id: &str, role: &str) -> authz::TrustedActor {
        authz::TrustedActor { user_id: user_id.to_string(), role: role.to_string(), display_name: "Admin Person".to_string() }
    }

    fn seed_user(conn: &Connection, username: &str, role: Role) -> User {
        identity::create_user(
            conn,
            NewUser {
                username,
                display_name: "Seed User",
                password_hash: &hash_password("correct horse battery staple").unwrap(),
                role,
                department: None,
                employee_reference: None,
                created_by: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn create_administered_user_creates_a_real_account_with_the_requested_role() {
        let conn = tmp_conn("create");
        let admin = actor("admin-1", "administrator");
        let created = create_administered_user_logic(
            &conn,
            &admin,
            "new.researcher",
            "New Researcher",
            "correct-password-1",
            "correct-password-1",
            "researcher",
            None,
            None,
        )
        .unwrap();
        assert_eq!(created.role, "researcher");
        assert!(created.must_change_password, "an admin-set password must force a change on first login");
    }

    #[test]
    fn create_administered_user_rejects_an_invented_role() {
        let conn = tmp_conn("create-bad-role");
        let admin = actor("admin-1", "administrator");
        let err = create_administered_user_logic(
            &conn,
            &admin,
            "someone",
            "Someone",
            "correct-password-1",
            "correct-password-1",
            "super_admin",
            None,
            None,
        )
        .unwrap_err();
        assert!(err.contains("not one of the 12 fixed"));
    }

    #[test]
    fn create_administered_user_rejects_mismatched_confirmation() {
        let conn = tmp_conn("create-mismatch");
        let admin = actor("admin-1", "administrator");
        let err = create_administered_user_logic(
            &conn,
            &admin,
            "someone",
            "Someone",
            "correct-password-1",
            "different-password",
            "researcher",
            None,
            None,
        )
        .unwrap_err();
        assert!(err.contains("match"));
    }

    #[test]
    fn change_user_role_logic_updates_the_stored_role_and_audits_from_and_to() {
        let mut conn = tmp_conn("role-change");
        let user = seed_user(&conn, "role.target", Role::Researcher);
        let admin = actor("admin-1", "administrator");
        let updated = change_user_role_logic(&mut conn, &admin, &user.id, "quality_manager").unwrap();
        assert_eq!(updated.role, "quality_manager");
        let detail: String = conn
            .query_row("SELECT detail FROM security_audit_events WHERE action = 'admin_user_role_changed'", [], |r| r.get(0))
            .unwrap();
        assert!(detail.contains("from=researcher"));
        assert!(detail.contains("to=quality_manager"));
    }

    #[test]
    fn set_account_status_disabled_revokes_open_sessions() {
        let mut conn = tmp_conn("disable-revokes");
        let user = seed_user(&conn, "disable.target", Role::Researcher);
        let session = identity::create_session(&conn, &user.id, 3600).unwrap();
        assert!(identity::validate_session(&conn, &session.token, 0).unwrap().is_some());
        let admin = actor("admin-1", "administrator");
        set_user_account_status_logic(&mut conn, &admin, &user.id, false).unwrap();
        assert!(identity::validate_session(&conn, &session.token, 0).unwrap().is_none(), "disabling must revoke the open session immediately");
    }

    #[test]
    fn reset_password_forces_a_change_and_never_stores_the_plaintext() {
        let conn = tmp_conn("reset-password");
        let user = seed_user(&conn, "reset.target", Role::Researcher);
        let admin = actor("admin-1", "administrator");
        reset_user_password_logic(&conn, &admin, &user.id, "brand-new-password-1", "brand-new-password-1").unwrap();
        let stored: String = conn.query_row("SELECT password_hash FROM users WHERE id = ?1", rusqlite::params![user.id], |r| r.get(0)).unwrap();
        assert!(!stored.contains("brand-new-password-1"));
        let refreshed = identity::find_user_by_id(&conn, &user.id).unwrap().unwrap();
        assert!(refreshed.must_change_password);
    }

    #[test]
    fn reset_password_rejects_a_password_shorter_than_the_existing_policy() {
        let conn = tmp_conn("reset-weak");
        let user = seed_user(&conn, "weak.target", Role::Researcher);
        let admin = actor("admin-1", "administrator");
        let err = reset_user_password_logic(&conn, &admin, &user.id, "short", "short").unwrap_err();
        assert!(err.contains("8 characters"));
    }

    #[test]
    fn audit_detail_never_contains_a_password_or_hash() {
        let conn = tmp_conn("audit-no-secrets");
        let user = seed_user(&conn, "audited.target", Role::Researcher);
        let admin = actor("admin-1", "administrator");
        reset_user_password_logic(&conn, &admin, &user.id, "a-secret-password-1", "a-secret-password-1").unwrap();
        let stored_hash: String = conn.query_row("SELECT password_hash FROM users WHERE id = ?1", rusqlite::params![user.id], |r| r.get(0)).unwrap();
        let mut stmt = conn.prepare("SELECT detail FROM security_audit_events").unwrap();
        let details: Vec<Option<String>> = stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        for d in details.into_iter().flatten() {
            assert!(!d.contains(&stored_hash));
            assert!(!d.contains("a-secret-password-1"));
        }
    }

    #[test]
    fn list_users_and_list_security_audit_events_round_trip() {
        let mut conn = tmp_conn("list-round-trip");
        let user = seed_user(&conn, "list.target", Role::Researcher);
        let admin = actor("admin-1", "administrator");
        change_user_role_logic(&mut conn, &admin, &user.id, "quality").unwrap();
        let users = identity::list_users(&conn).unwrap();
        assert!(users.iter().any(|u| u.id == user.id));
        let events = identity::list_security_audit_events(&conn, Some(&user.id), 10).unwrap();
        assert!(events.iter().any(|e| e.action == "admin_user_role_changed"));
        let all_events = identity::list_security_audit_events(&conn, None, 10).unwrap();
        assert!(all_events.len() >= events.len());
    }

    // ------------------------------------------- last-administrator guard ---

    #[test]
    fn the_sole_active_administrator_cannot_be_demoted() {
        let mut conn = tmp_conn("last-admin-demote-denied");
        let sole_admin = seed_user(&conn, "sole.admin", Role::Administrator);
        let admin = actor(&sole_admin.id, "administrator");
        let err = change_user_role_logic(&mut conn, &admin, &sole_admin.id, "researcher").unwrap_err();
        assert!(err.contains("last active administrator"));
        // No partial mutation: the role is still administrator.
        let refreshed = identity::find_user_by_id(&conn, &sole_admin.id).unwrap().unwrap();
        assert_eq!(refreshed.role, Role::Administrator);
    }

    #[test]
    fn the_sole_active_administrator_cannot_be_disabled() {
        let mut conn = tmp_conn("last-admin-disable-denied");
        let sole_admin = seed_user(&conn, "sole.admin", Role::Administrator);
        let admin = actor(&sole_admin.id, "administrator");
        let err = set_user_account_status_logic(&mut conn, &admin, &sole_admin.id, false).unwrap_err();
        assert!(err.contains("last active administrator"));
        let refreshed = identity::find_user_by_id(&conn, &sole_admin.id).unwrap().unwrap();
        assert_eq!(refreshed.status, "active");
    }

    #[test]
    fn with_two_active_administrators_one_may_be_demoted() {
        let mut conn = tmp_conn("two-admins-demote-ok");
        let admin_a = seed_user(&conn, "admin.a", Role::Administrator);
        let _admin_b = seed_user(&conn, "admin.b", Role::Administrator);
        let actor_a = actor(&admin_a.id, "administrator");
        let updated = change_user_role_logic(&mut conn, &actor_a, &admin_a.id, "researcher").unwrap();
        assert_eq!(updated.role, "researcher");
    }

    #[test]
    fn with_two_active_administrators_one_may_be_disabled() {
        let mut conn = tmp_conn("two-admins-disable-ok");
        let admin_a = seed_user(&conn, "admin.a", Role::Administrator);
        let _admin_b = seed_user(&conn, "admin.b", Role::Administrator);
        let actor_a = actor(&admin_a.id, "administrator");
        let updated = set_user_account_status_logic(&mut conn, &actor_a, &admin_a.id, false).unwrap();
        assert_eq!(updated.account_status, "disabled");
    }

    #[test]
    fn a_disabled_administrator_does_not_count_as_a_backup() {
        let mut conn = tmp_conn("disabled-admin-not-a-backup");
        let active_admin = seed_user(&conn, "active.admin", Role::Administrator);
        let disabled_admin = seed_user(&conn, "disabled.admin", Role::Administrator);
        identity::update_account_status(&conn, &disabled_admin.id, false).unwrap();
        let actor_a = actor(&active_admin.id, "administrator");
        // Only one ACTIVE administrator remains (the other is disabled) —
        // demoting/disabling the active one must still be refused.
        let err = change_user_role_logic(&mut conn, &actor_a, &active_admin.id, "researcher").unwrap_err();
        assert!(err.contains("last active administrator"));
        let err2 = set_user_account_status_logic(&mut conn, &actor_a, &active_admin.id, false).unwrap_err();
        assert!(err2.contains("last active administrator"));
    }

    #[test]
    fn denying_a_last_administrator_change_is_audited_without_leaking_secrets() {
        let mut conn = tmp_conn("last-admin-denial-audited");
        let sole_admin = seed_user(&conn, "sole.admin", Role::Administrator);
        let admin = actor(&sole_admin.id, "administrator");
        let _ = change_user_role_logic(&mut conn, &admin, &sole_admin.id, "researcher");
        let detail: String = conn
            .query_row(
                "SELECT detail FROM security_audit_events WHERE action = 'admin_user_role_change_denied'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(detail.contains("reason=last_active_administrator"));
        let stored_hash: String = conn
            .query_row("SELECT password_hash FROM users WHERE id = ?1", rusqlite::params![sole_admin.id], |r| r.get(0))
            .unwrap();
        assert!(!detail.contains(&stored_hash));
    }

    #[test]
    fn a_non_administrator_role_change_is_never_touched_by_the_last_admin_guard() {
        let mut conn = tmp_conn("non-admin-role-change-unaffected");
        let sole_admin = seed_user(&conn, "sole.admin", Role::Administrator);
        let researcher = seed_user(&conn, "plain.researcher", Role::Researcher);
        let admin = actor(&sole_admin.id, "administrator");
        // Changing a non-administrator's role must never be blocked, even
        // though this installation has only one administrator overall.
        let updated = change_user_role_logic(&mut conn, &admin, &researcher.id, "quality").unwrap();
        assert_eq!(updated.role, "quality");
    }
}
