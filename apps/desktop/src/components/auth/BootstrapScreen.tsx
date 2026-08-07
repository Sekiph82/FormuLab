import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import logo from "@/assets/logo.webp";

export interface BootstrapInput {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
}

/** First-run Administrator Setup (Phase 13 Session 2). Deliberately has no
 *  role selector anywhere on this screen — the created account is always
 *  Administrator, enforced backend-side (`identity::bootstrap_administrator`),
 *  not just hidden here. */
export function BootstrapScreen({ onComplete }: { onComplete: (input: BootstrapInput) => Promise<void> }) {
  const { t } = useTranslation("session");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onComplete({ username, displayName, password, confirmPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg text-text">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <img src={logo} alt="" className="h-6 w-auto" />
          {/* eslint-disable-next-line i18next/no-literal-string -- product brand name, not translated across locales (see AGENTS.md) */}
          <span className="font-serif text-[19px] font-semibold leading-none tracking-tight text-text">
            FormuLab
          </span>
        </div>
        <h1 className="mb-1 text-sm font-medium text-text">{t("auth.bootstrap.title")}</h1>
        <p className="mb-5 text-[12px] text-muted">{t("auth.bootstrap.subtitle")}</p>

        <label htmlFor="bootstrap-username" className="mb-1 block text-[11px] text-muted">
          {t("auth.bootstrap.usernameLabel")}
        </label>
        <input
          id="bootstrap-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          disabled={submitting}
          className="mb-3 w-full rounded-input border border-border bg-bg px-2 py-1.5 text-[13px] text-text disabled:opacity-50"
        />

        <label htmlFor="bootstrap-display-name" className="mb-1 block text-[11px] text-muted">
          {t("auth.bootstrap.displayNameLabel")}
        </label>
        <input
          id="bootstrap-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          disabled={submitting}
          className="mb-3 w-full rounded-input border border-border bg-bg px-2 py-1.5 text-[13px] text-text disabled:opacity-50"
        />

        <label htmlFor="bootstrap-password" className="mb-1 block text-[11px] text-muted">
          {t("auth.bootstrap.passwordLabel")}
        </label>
        <div className="relative mb-3">
          <input
            id="bootstrap-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={submitting}
            className="w-full rounded-input border border-border bg-bg px-2 py-1.5 pr-8 text-[13px] text-text disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        <label htmlFor="bootstrap-confirm-password" className="mb-1 block text-[11px] text-muted">
          {t("auth.bootstrap.confirmPasswordLabel")}
        </label>
        <input
          id="bootstrap-confirm-password"
          type={showPassword ? "text" : "password"}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          disabled={submitting}
          className="mb-1 w-full rounded-input border border-border bg-bg px-2 py-1.5 text-[13px] text-text disabled:opacity-50"
        />

        {error && (
          <p role="alert" className="mb-1 mt-2 text-[11px] text-error">
            {error}
          </p>
        )}

        <p className="mt-3 rounded-input bg-accent/10 px-2 py-1.5 text-[11px] text-accent">
          {t("auth.bootstrap.roleNotice")}
        </p>

        <button
          type="submit"
          disabled={submitting || !username || !displayName || !password || !confirmPassword}
          className="mt-4 w-full rounded-input bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? t("auth.bootstrap.submitting") : t("auth.bootstrap.submit")}
        </button>
      </form>
    </div>
  );
}
