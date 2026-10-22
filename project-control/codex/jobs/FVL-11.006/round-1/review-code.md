VERDICT: PASS
REVIEWER: Codex (code lens; same execution context)

- `role_policy.rs` now checks the canonical collection count already declared by the masterdata registry, while still asserting every collection has a policy mapping.
- The Rust approval transition tests confirm authorization, lifecycle validity, required justification, and trusted actor identity remain separate checks.
- No authorization implementation, user data, approval records, or runtime binaries were changed.
