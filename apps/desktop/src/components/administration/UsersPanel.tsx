import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, KeyRound, Plus, ShieldCheck, UserCog, UserX, UserCheck as UserCheckIcon } from "lucide-react";
import { ROLES, POLICY_AREAS, POLICY_AREA_LABELS, areasFor, capabilitiesFor, can, type Role } from "@formulab/shared";
import { useTrustedActor } from "@/lib/currentActor";
import {
  changeAdministeredUserRole,
  createAdministeredUser,
  listAdministeredUsers,
  readSecurityAuditHistory,
  resetAdministeredUserPassword,
  setAdministeredUserAccountStatus,
  updateAdministeredUserProfile,
  type SafeUser,
  type SecurityAuditEvent,
} from "@/lib/admin";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;
type MainView = "list" | "capabilities" | "history";

/**
 * Phase 13 Session 5 — Administration → Users. Every mutation here is
 * authorized server-side (`admin.rs`, gated through `authz::authorize`
 * against `administrationUsers`/`administrationSecurity`) — this panel
 * never decides who may do what, it only reflects what the backend already
 * allowed or refused. Hiding it for a non-administrator (below) is UX only,
 * same convention `SettingsPage.tsx`'s System Administration cards already
 * use: the backend is authoritative regardless.
 */
export function UsersPanel() {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;
  const trusted = useTrustedActor();
  const canManageUsers = !trusted || can(trusted.role, "administrationUsers", "view");

  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<MainView>("list");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<SafeUser | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listAdministeredUsers());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Skip the round-trip entirely when the frontend already knows this
    // role can never manage users — `listAdministeredUsers` would simply
    // be refused server-side anyway (§9.3.3), but there's no reason to
    // make the call at all.
    if (canManageUsers) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers]);

  if (!canManageUsers) {
    return <p className="px-6 py-6 text-[12px] text-muted">{t("administration.users.accessRequired")}</p>;
  }

  const selected = users.find((u) => u.userId === selectedId) ?? null;

  const applyRoleChange = async (user: SafeUser, role: string) => {
    setError(null);
    try {
      const updated = await changeAdministeredUserRole(user.userId, role);
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)));
    } catch (e) {
      setError(String(e));
    }
  };

  const applyStatusChange = async (user: SafeUser, active: boolean) => {
    setError(null);
    try {
      const updated = await setAdministeredUserAccountStatus(user.userId, active);
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-medium text-text">{t("administration.users.heading")}</h3>
          <div className="flex-1" />
          <button
            onClick={() => setView(view === "capabilities" ? "list" : "capabilities")}
            className={cn(
              "flex items-center gap-1.5 rounded-input border px-2 py-1 text-[11px]",
              view === "capabilities" ? "border-accent text-accent" : "border-border text-muted hover:text-text",
            )}
          >
            <ShieldCheck size={13} /> {t("administration.users.capabilitiesTab")}
          </button>
          <button
            onClick={() => setView(view === "history" ? "list" : "history")}
            className={cn(
              "flex items-center gap-1.5 rounded-input border px-2 py-1 text-[11px]",
              view === "history" ? "border-accent text-accent" : "border-border text-muted hover:text-text",
            )}
          >
            <History size={13} /> {t("administration.users.historyTab")}
          </button>
          <button
            onClick={() => {
              setView("list");
              setCreating((c) => !c);
            }}
            className="flex items-center gap-1.5 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
          >
            <Plus size={13} /> {t("administration.users.newUser")}
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}

        {view === "capabilities" && <CapabilitiesView t={t} />}
        {view === "history" && <SecurityHistoryView t={t} />}

        {view === "list" && (
          <>
            {creating && (
              <CreateUserForm
                t={t}
                onCreated={(user) => {
                  setUsers((prev) => [user, ...prev]);
                  setCreating(false);
                }}
                onError={setError}
              />
            )}

            {loading ? (
              <p className="text-[11px] text-muted">{t("administration.users.loading")}</p>
            ) : users.length === 0 ? (
              <p className="text-[11px] text-muted">{t("administration.users.none")}</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-1.5 font-medium">{t("administration.users.colUsername")}</th>
                    <th className="py-1.5 font-medium">{t("administration.users.colDisplayName")}</th>
                    <th className="py-1.5 font-medium">{t("administration.users.colRole")}</th>
                    <th className="py-1.5 font-medium">{t("administration.users.colStatus")}</th>
                    <th className="py-1.5 text-right font-medium">{t("administration.users.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.userId} className="border-b border-border-faint">
                      <td className="py-1.5 text-text">{u.username}</td>
                      <td className="py-1.5 text-text">{u.displayName}</td>
                      <td className="py-1.5">
                        <select
                          value={u.role}
                          onChange={(e) => void applyRoleChange(u, e.target.value)}
                          className="rounded-input border border-border bg-surface px-1 py-0.5 text-[11px]"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px]",
                            u.accountStatus === "active" ? "bg-accent/10 text-accent" : "bg-error/10 text-error",
                          )}
                        >
                          {u.accountStatus === "active" ? t("administration.users.statusActive") : t("administration.users.statusDisabled")}
                        </span>
                        {u.mustChangePassword && (
                          <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                            {t("administration.users.mustChangePassword")}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5">
                        <div className="flex flex-wrap justify-end gap-1">
                          <IconButton label={t("administration.users.edit")} onClick={() => setSelectedId(u.userId)}>
                            <UserCog size={12} />
                          </IconButton>
                          {u.accountStatus === "active" ? (
                            <IconButton label={t("administration.users.disable")} onClick={() => setConfirmDisable(u)}>
                              <UserX size={12} />
                            </IconButton>
                          ) : (
                            <IconButton label={t("administration.users.activate")} onClick={() => void applyStatusChange(u, true)}>
                              <UserCheckIcon size={12} />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {selected && (
        <UserDetailPanel
          t={t}
          user={selected}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)))}
          onError={setError}
        />
      )}

      {confirmDisable && (
        <ConfirmDialog
          title={t("administration.users.confirmDisableTitle")}
          body={t("administration.users.confirmDisableBody", { name: confirmDisable.displayName })}
          confirmLabel={t("administration.users.disable")}
          onCancel={() => setConfirmDisable(null)}
          onConfirm={() => {
            void applyStatusChange(confirmDisable, false);
            setConfirmDisable(null);
          }}
        />
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-input border border-border p-1 text-muted hover:bg-surface-2 hover:text-text"
    >
      {children}
    </button>
  );
}

function CreateUserForm({
  t,
  onCreated,
  onError,
}: {
  t: SimpleT;
  onCreated: (user: SafeUser) => void;
  onError: (message: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<Role>("researcher");
  const [department, setDepartment] = useState("");
  const [employeeReference, setEmployeeReference] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError("");
    try {
      const user = await createAdministeredUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        confirmPassword,
        role,
        department: department.trim() || undefined,
        employeeReference: employeeReference.trim() || undefined,
      });
      onCreated(user);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-card border border-accent/40 bg-accent/5 px-3 py-2.5">
      <p className="mb-2 text-[12px] font-medium text-text">{t("administration.users.createTitle")}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label={t("administration.users.fieldUsername")} value={username} onChange={setUsername} />
        <Field label={t("administration.users.fieldDisplayName")} value={displayName} onChange={setDisplayName} />
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">{t("administration.users.fieldRole")}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px] text-text">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <Field label={t("administration.users.fieldPassword")} value={password} onChange={setPassword} type="password" />
        <Field label={t("administration.users.fieldConfirmPassword")} value={confirmPassword} onChange={setConfirmPassword} type="password" />
        <Field label={t("administration.users.fieldDepartment")} value={department} onChange={setDepartment} optional />
        <Field label={t("administration.users.fieldEmployeeReference")} value={employeeReference} onChange={setEmployeeReference} optional />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          disabled={busy || !username.trim() || !displayName.trim() || !password}
          onClick={() => void submit()}
          className="rounded-input border border-accent px-3 py-1.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {t("administration.users.submitCreate")}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-muted">
        {label}
        {optional ? "" : " *"}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px] text-text"
      />
    </label>
  );
}

function UserDetailPanel({
  t,
  user,
  onClose,
  onUpdated,
  onError,
}: {
  t: SimpleT;
  user: SafeUser;
  onClose: () => void;
  onUpdated: (user: SafeUser) => void;
  onError: (message: string) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<SecurityAuditEvent[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    setDisplayName(user.displayName);
    setNewPassword("");
    setConfirmNewPassword("");
    setHistoryLoaded(false);
    setHistory([]);
  }, [user.userId, user.displayName]);

  const saveProfile = async () => {
    setBusy(true);
    onError("");
    try {
      const updated = await updateAdministeredUserProfile({ userId: user.userId, displayName: displayName.trim() });
      onUpdated(updated);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    setBusy(true);
    onError("");
    try {
      await resetAdministeredUserPassword(user.userId, newPassword, confirmNewPassword);
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async () => {
    try {
      setHistory(await readSecurityAuditHistory(user.userId));
      setHistoryLoaded(true);
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <aside className="w-80 shrink-0 overflow-auto border-l border-border px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-medium text-text">{user.username}</h4>
        <button onClick={onClose} className="text-[11px] text-muted hover:text-text">
          {t("administration.users.close")}
        </button>
      </div>

      <section className="mb-4">
        <p className="mb-1.5 text-[11px] font-medium text-muted">{t("administration.users.editTitle")}</p>
        <Field label={t("administration.users.fieldDisplayName")} value={displayName} onChange={setDisplayName} />
        <button
          disabled={busy || !displayName.trim()}
          onClick={() => void saveProfile()}
          className="mt-1.5 rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2 disabled:opacity-40"
        >
          {t("administration.users.saveProfile")}
        </button>
      </section>

      <section className="mb-4">
        <p className="mb-1.5 text-[11px] font-medium text-muted">{t("administration.users.resetPasswordTitle")}</p>
        <div className="space-y-1.5">
          <Field label={t("administration.users.newPassword")} value={newPassword} onChange={setNewPassword} type="password" />
          <Field label={t("administration.users.confirmNewPassword")} value={confirmNewPassword} onChange={setConfirmNewPassword} type="password" />
        </div>
        <p className="mt-1 text-[10px] text-muted">{t("administration.users.resetHint")}</p>
        <button
          disabled={busy || !newPassword}
          onClick={() => void submitReset()}
          className="mt-1.5 flex items-center gap-1.5 rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2 disabled:opacity-40"
        >
          <KeyRound size={12} /> {t("administration.users.resetSubmit")}
        </button>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted">{t("administration.users.historyTab")}</p>
          {!historyLoaded && (
            <button onClick={() => void loadHistory()} className="text-[10px] text-accent hover:underline">
              {t("administration.users.loadHistory")}
            </button>
          )}
        </div>
        {historyLoaded && <AuditEventList t={t} events={history} />}
      </section>
    </aside>
  );
}

function SecurityHistoryView({ t }: { t: SimpleT }) {
  const [events, setEvents] = useState<SecurityAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void readSecurityAuditHistory()
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <p className="mb-2 text-[11px] text-muted">{t("administration.users.historyHint")}</p>
      {loading ? <p className="text-[11px] text-muted">{t("administration.users.loading")}</p> : <AuditEventList t={t} events={events} />}
    </div>
  );
}

function AuditEventList({ t, events }: { t: SimpleT; events: SecurityAuditEvent[] }) {
  if (events.length === 0) {
    return <p className="text-[11px] text-muted">{t("administration.users.historyEmpty")}</p>;
  }
  return (
    <ul className="space-y-1">
      {events.map((e) => (
        <li key={e.id} className="rounded-input border border-border-faint px-2 py-1 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-text">{e.action}</span>
            <span className={cn("rounded px-1 py-0.5", e.outcome === "success" ? "bg-accent/10 text-accent" : "bg-error/10 text-error")}>
              {e.outcome}
            </span>
            <span className="ml-auto text-muted">{e.at}</span>
          </div>
          {e.detail && <div className="mt-0.5 text-muted">{e.detail}</div>}
        </li>
      ))}
    </ul>
  );
}

function CapabilitiesView({ t }: { t: SimpleT }) {
  return (
    <div className="overflow-auto">
      <p className="mb-2 text-[11px] text-muted">{t("administration.users.capabilitiesHint")}</p>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 font-medium">{t("administration.users.colRole")}</th>
            <th className="py-1 font-medium">{t("administration.users.colAreas")}</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((role) => (
            <tr key={role} className="border-b border-border-faint align-top">
              <td className="py-1 pr-2 font-medium text-text">{role}</td>
              <td className="py-1 text-muted">
                {areasFor(role).length === 0
                  ? t("administration.users.noAreas")
                  : areasFor(role)
                      .map((area) => `${POLICY_AREA_LABELS[area]} (${t("administration.users.colCapabilities")}: ${areasForCapabilitiesLabel(role, area)})`)
                      .join("; ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-muted">
        {t("administration.users.capabilitiesAreaCount", { count: POLICY_AREAS.length })}
      </p>
    </div>
  );
}

function areasForCapabilitiesLabel(role: Role, area: (typeof POLICY_AREAS)[number]): string {
  // Rendered straight from rolePolicy.ts's own capabilitiesFor — never a
  // second, hand-maintained capability description.
  return capabilitiesFor(role, area).join(", ");
}
