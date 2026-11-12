import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import logo from "@/assets/logo.webp";

/** Shown instead of the app while `mustChangePassword` is set: an
 *  administrator chose this password, so the account stays unusable until
 *  its owner replaces it. The backend enforces the same rule. */
export function ChangePasswordScreen({
  displayName,
  onSubmit,
  onLogout,
}: {
  displayName: string;
  onSubmit: (input: { currentPassword: string; newPassword: string; confirmPassword: string }) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ currentPassword, newPassword, confirmPassword });
    } catch (err) {
      setCurrentPassword("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div key={id}>
      <label htmlFor={id} className="mb-1 block text-[11px] text-muted">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => set(e.target.value)}
        autoComplete={autoComplete}
        disabled={submitting}
        className="mb-3 w-full rounded-input border border-border bg-bg px-2 py-1.5 text-[13px] text-text disabled:opacity-50"
      />
    </div>
  );

  const fields = [
    field("change-current", t("auth.changePassword.currentLabel"), currentPassword, setCurrentPassword, "current-password"),
    field("change-new", t("auth.changePassword.newLabel"), newPassword, setNewPassword, "new-password"),
    field("change-confirm", t("auth.changePassword.confirmLabel"), confirmPassword, setConfirmPassword, "new-password"),
  ];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg text-text">
      <form onSubmit={submit} className="w-full max-w-[340px] rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <img src={logo} alt="" className="h-6 w-auto" />
          {/* eslint-disable-next-line i18next/no-literal-string -- product brand name, not translated across locales (see AGENTS.md) */}
          <span className="font-serif text-[19px] font-semibold leading-none tracking-tight text-text">FormuLab</span>
        </div>
        <h1 className="mb-1 text-sm font-medium text-text">{t("auth.changePassword.title")}</h1>
        <p className="mb-5 text-[12px] text-muted">{t("auth.changePassword.subtitle", { name: displayName })}</p>

        {fields}

        {error && (
          <p role="alert" className="mb-1 mt-1 text-[11px] text-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
          className="mt-3 w-full rounded-input bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? t("auth.changePassword.submitting") : t("auth.changePassword.submit")}
        </button>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="mt-3 w-full text-center text-[11px] text-muted hover:text-text"
        >
          {t("auth.account.logout")}
        </button>
      </form>
    </div>
  );
}
