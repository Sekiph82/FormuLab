import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import logo from "@/assets/logo.webp";

/** Username/password login (Phase 13 Session 2). No sign-up, no social/
 *  email/SMS login, no forgot-password email flow — this is a closed
 *  enterprise account model. Password recovery is administrator-mediated
 *  (a later session's Administration -> Users "reset password" action), so
 *  this screen only ever points at that, never a fake self-service flow. */
export function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const { t } = useTranslation("session");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(username, password);
      // On success the auth gate unmounts this screen — no local state to
      // reset. On failure, clear the password field only (never persist,
      // log, or leave a failed password sitting in memory longer than
      // needed for the one retry the user is about to make).
    } catch {
      setPassword("");
      setError(t("auth.login.genericError"));
      usernameRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg text-text">
      <form onSubmit={submit} className="w-full max-w-[340px] rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <img src={logo} alt="" className="h-6 w-auto" />
          {/* eslint-disable-next-line i18next/no-literal-string -- product brand name, not translated across locales (see AGENTS.md) */}
          <span className="font-serif text-[19px] font-semibold leading-none tracking-tight text-text">
            FormuLab
          </span>
        </div>
        <h1 className="mb-1 text-sm font-medium text-text">{t("auth.login.title")}</h1>
        <p className="mb-5 text-[12px] text-muted">{t("auth.login.subtitle")}</p>

        <label htmlFor="login-username" className="mb-1 block text-[11px] text-muted">
          {t("auth.login.usernameLabel")}
        </label>
        <input
          id="login-username"
          ref={usernameRef}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          disabled={submitting}
          className="mb-3 w-full rounded-input border border-border bg-bg px-2 py-1.5 text-[13px] text-text disabled:opacity-50"
        />

        <label htmlFor="login-password" className="mb-1 block text-[11px] text-muted">
          {t("auth.login.passwordLabel")}
        </label>
        <div className="relative mb-1">
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
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

        {error && (
          <p role="alert" className="mb-3 mt-2 text-[11px] text-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="mt-4 w-full rounded-input bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>

        <p className="mt-4 text-center text-[11px] text-muted">{t("auth.login.passwordRecoveryNotice")}</p>
      </form>
    </div>
  );
}
