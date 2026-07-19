import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useUiStore, ZOOM_MAX, ZOOM_MIN } from "@/lib/store";
import { shippedLocales } from "@/i18n/config";
import { useUpdateStore } from "@/lib/update";
import {
  isMacUA,
  isTauri,
  openExternal,
  openWorkspaceBase,
  pickFolder,
  pythonInterpreter,
  setPythonPath,
  setWorkspaceBase,
  workspaceBase,
  type PythonInterpreter,
} from "@/lib/tauri";
import { useSetupStore } from "@/lib/setup";
import { RemoteComputeCard } from "@/components/settings/RemoteComputeCard";
import { ModalCard } from "@/components/settings/ModalCard";
import { DataFlowCard } from "@/components/settings/DataFlowCard";
import { FormulationProviderCard } from "@/components/settings/FormulationProviderCard";
import { MaterialsCard } from "@/components/settings/MaterialsCard";
import { loadProviderConfig } from "@/lib/formulationV2";
import { Row, Section, Switch } from "@/components/settings/Section";
import { resolveSection } from "@/components/settings/sections";
import { inputCls, selectCls } from "@/components/settings/inputCls";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

/**
 * Settings. ONE configuration surface: everything talks to the bundled
 * OpenCode's own config/auth API — no separate "model key" concept.
 */
export function SettingsPage() {
  // Which settings section is on screen — the sidebar is the navigation.
  const section = resolveSection(useParams().section);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const locale = useUiStore((s) => s.locale);
  const setLocale = useUiStore((s) => s.setLocale);
  const zoom = useUiStore((s) => s.zoom);
  const zoomBy = useUiStore((s) => s.zoomBy);
  const resetZoom = useUiStore((s) => s.resetZoom);
  const { t } = useTranslation(["settings", "common"]);
  // Select each field individually. A bare `useRuntimeStore()` subscribed to the
  // WHOLE store, so every unrelated mutation (session events, streaming, idle
  // checks) re-rendered this page — in the packaged WKWebView that repaint storm
  // made the native <select>/<input>/<button> controls flicker and blank out on
  // scroll. These are the only fields the page actually reads.
  const defaultModel = loadProviderConfig().model;
  const updateEnabled = useUpdateStore((s) => s.enabled);
  const setUpdateEnabled = useUpdateStore((s) => s.setEnabled);
  const updateBadgeEnabled = useUpdateStore((s) => s.badgeEnabled);
  const setUpdateBadgeEnabled = useUpdateStore((s) => s.setBadgeEnabled);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateError = useUpdateStore((s) => s.error);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const latestUpdate = useUpdateStore((s) => s.latest);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const showUpdateBadge = useUpdateStore((s) => s.showBadge);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const checkForUpdates = useUpdateStore((s) => s.check);
  const dismissUpdateBadge = useUpdateStore((s) => s.dismissBadge);
  const updateTone =
    hasUpdate || updateStatus === "error" ? "error" : updateStatus === "checking" ? "accent" : "ok";
  const updateLabel = hasUpdate
    ? t("updates.available")
    : updateStatus === "checking"
      ? t("updates.checking")
      : updateStatus === "error"
        ? t("updates.failed")
        : t("updates.upToDate");

  // Long-running uv provisioning lives in a store, not here: navigating away
  // must not discard the "setting up…" state or sever the progress stream.
  const setupGeneration = useSetupStore((s) => s.generation);

  // The interpreter local Python kernels resolve to + the manual override input.
  const [pyInfo, setPyInfo] = useState<PythonInterpreter | null>(null);
  const [pyPath, setPyPath] = useState("");
  const [savingPy, setSavingPy] = useState(false);

  const [wsPath, setWsPath] = useState<string | null>(null);



  useEffect(() => {
    // The BASE folder — the parent every session's dated subfolder is created
    // under. (The per-session active folder shows in the conversation header.)
    void workspaceBase().then(setWsPath);
  }, []);
  const refreshPython = useCallback(() => {
    void pythonInterpreter().then(setPyInfo);
  }, []);
  // Also on setupGeneration: a fresh jupyter-env may now back the local kernel.
  useEffect(refreshPython, [refreshPython, setupGeneration]);

  const savePythonPath = async (path: string) => {
    setSavingPy(true);
    try {
      await setPythonPath(path);
      setPyPath("");
      toast.success(path ? t("toast.interpreterSet") : t("toast.overrideCleared"));
      refreshPython();
    } catch (e) {
      toast.error(`${t("toast.couldNotSetInterpreter")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingPy(false);
    }
  };

  const changeWorkspaceBase = async () => {
    const picked = await pickFolder();
    if (!picked) return;
    try {
      setWsPath(await setWorkspaceBase(picked));
      toast.success(t("toast.folderSet"));
    } catch (err) {
      toast.error(`${t("toast.couldNotSetFolder")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };













  return (
    <div className="h-full overflow-y-auto">
      {/* Modest top padding: the AppShell titlebar strip already clears 48px. */}
      <div className="mx-auto max-w-2xl px-8 pb-16 pt-4">
        <h1 className="font-serif text-2xl text-text">{t(`nav.${section}`)}</h1>

        {/* ---- Models ---- */}
        {/* Provider + model + key for the direct formulation pipeline. */}
        {section === "models" && <FormulationProviderCard />}

        {/* ---- Raw materials (the prices costing uses) ---- */}
        {section === "general" && <MaterialsCard />}

        {/* ---- Workspace ---- */}
        {section === "general" && (
        <Section title={t("workspace.title")} hint={t("workspace.hint")}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                inputCls("flex-1 truncate font-mono leading-9"),
                "select-all bg-surface-2 text-muted",
              )}
            >
              {wsPath ?? t("workspace.unavailable")}
            </span>
            {wsPath && (
              <>
                <button className={btnGhost("gap-1.5")} onClick={() => void changeWorkspaceBase()}>
                  {t("workspace.change")}
                </button>
                <button className={btnGhost("gap-1.5")} onClick={() => void openWorkspaceBase()}>
                  <FolderOpen size={13} /> {t("workspace.reveal")}
                </button>
              </>
            )}
          </div>
        </Section>
        )}

        {/* ---- Local Python kernel ---- */}
        {section === "runtime" && isTauri && (
          <Section title={t("python.title")} hint={t("python.hint")}>
            <div className="flex items-center gap-2 text-[13px]">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  pyInfo?.resolved ? "bg-ok" : "bg-error",
                )}
              />
              {pyInfo?.resolved ? (
                <>
                  <span className="min-w-0 flex-1 select-all truncate font-mono text-[12px] text-text">
                    {pyInfo.resolved}
                  </span>
                  <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted ring-1 ring-border">
                    {pyInfo.source === "manual"
                      ? t("python.sourceManual")
                      : pyInfo.source === "jupyter-env"
                        ? t("python.sourceAppManaged")
                        : t("python.sourceAutoDetected")}
                  </span>
                </>
              ) : (
                <span className="min-w-0 flex-1 text-error">
                  {pyInfo?.error ?? t("python.checking")}
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={pyPath}
                onChange={(e) => setPyPath(e.target.value)}
                placeholder={pyInfo?.configured ?? t("python.pathPlaceholder")}
                className={inputCls("flex-1 font-mono")}
                spellCheck={false}
              />
              <button
                className={btnAccent()}
                onClick={() => void savePythonPath(pyPath.trim())}
                disabled={savingPy || !pyPath.trim()}
              >
                {savingPy ? <Loader2 size={12} className="animate-spin" /> : t("python.useThisPython")}
              </button>
              {pyInfo?.configured && (
                <button
                  className={btnGhost()}
                  onClick={() => void savePythonPath("")}
                  disabled={savingPy}
                >
                  {t("python.clearOverride")}
                </button>
              )}
            </div>
          </Section>
        )}

        {section === "compute" && (
          <>
            <RemoteComputeCard />
            <ModalCard />
          </>
        )}

        {/* ---- Privacy & data flow ---- */}
        {section === "privacy" && <DataFlowCard model={defaultModel} workspace={wsPath} />}

        {/* ---- Appearance ---- */}
        {section === "appearance" && (
        <Section title={t("appearance.title")} flush>
          <div className="divide-y divide-faint">
            <Row title={t("appearance.themeLabel")}
              control={
                <div className="inline-flex shrink-0 rounded-input border border-border bg-surface-2 p-0.5">
                  {/* eslint-disable-next-line i18next/no-literal-string -- internal theme-mode keys, not display text (the visible label is t(`appearance.theme.${mode}`)) */}
                  {(["light", "warm", "dark"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTheme(mode)}
                      className={cn(
                        "rounded-[5px] px-4 py-1.5 text-[13px] transition-colors",
                        theme === mode ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
                      )}
                    >
                      {t(`appearance.theme.${mode}`)}
                    </button>
                  ))}
                </div>
              }
            />
            <Row title={t("language.label")}
              control={
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                  aria-label={t("language.label")}
                  className={selectCls("w-48")}
                >
                  {shippedLocales().map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.nativeName}
                    </option>
                  ))}
                </select>
              }
            />
            {/* Zoom is desktop-only: in a browser the browser's own zoom rules. */}
            {isTauri && (
              <Row
                title={t("appearance.zoom.label")}
                hint={t("appearance.zoom.hint", { mod: isMacUA() ? "⌘" : "Ctrl" })}
                control={
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className={btnGhost("h-8 w-8 justify-center px-0")}
                      onClick={() => zoomBy(-1)}
                      disabled={zoom <= ZOOM_MIN}
                      aria-label={t("appearance.zoom.out")}
                    >
                      <Minus size={13} />
                    </button>
                    <span className="w-11 text-center text-[13px] tabular-nums text-text">
                      {/* eslint-disable-next-line i18next/no-literal-string -- "%" unit glue, not prose */}
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      className={btnGhost("h-8 w-8 justify-center px-0")}
                      onClick={() => zoomBy(1)}
                      disabled={zoom >= ZOOM_MAX}
                      aria-label={t("appearance.zoom.in")}
                    >
                      <Plus size={13} />
                    </button>
                    {zoom !== 1 && (
                      <button className={btnGhost("h-8")} onClick={resetZoom}>
                        {t("appearance.zoom.reset")}
                      </button>
                    )}
                  </div>
                }
              />
            )}
          </div>
        </Section>
        )}

        {/* ---- App updates ---- */}
        {section === "general" && (
        <Section title={t("updates.title")} hint={t("updates.hint")} flush>
          <div className="divide-y divide-faint">
            <Row
              title={
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      updateTone === "error" ? "bg-error" : updateTone === "accent" ? "bg-accent" : "bg-ok",
                    )}
                  />
                  {updateLabel}
                </span>
              }
              hint={[
                t("updates.currentVersion", { version: currentVersion }),
                latestUpdate && t("updates.latestVersion", { version: latestUpdate.version }),
                latestUpdate?.publishedAt &&
                  t("updates.publishedAt", {
                    date: new Date(latestUpdate.publishedAt).toLocaleString(locale),
                  }),
                lastCheckedAt &&
                  t("updates.lastChecked", { date: new Date(lastCheckedAt).toLocaleString(locale) }),
              ]
                .filter(Boolean)
                .join(" · ")}
              control={
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    className={btnGhost("gap-1.5")}
                    onClick={() => void checkForUpdates({ manual: true })}
                    disabled={updateStatus === "checking"}
                  >
                    {updateStatus === "checking" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    {t("updates.checkNow")}
                  </button>
                  {latestUpdate?.url && (
                    <button
                      className={btnGhost("gap-1.5")}
                      onClick={() => void openExternal(latestUpdate.url)}
                    >
                      <ExternalLink size={13} /> {t("updates.openRelease")}
                    </button>
                  )}
                  {showUpdateBadge && (
                    <button className={btnGhost()} onClick={dismissUpdateBadge}>
                      {t("updates.hideBadge")}
                    </button>
                  )}
                </div>
              }
            >
              {updateStatus === "error" && updateError && (
                <div className="mt-2 text-xs text-error">
                  {t("updates.checkFailed", { message: updateError })}
                </div>
              )}
            </Row>
            <Row
              title={t("updates.autoCheck")}
              hint={t("updates.autoCheckHint")}
              control={
                <Switch
                  checked={updateEnabled}
                  onChange={setUpdateEnabled}
                  label={t("updates.autoCheck")}
                />
              }
            />
            <Row
              title={t("updates.showBadge")}
              hint={t("updates.showBadgeHint")}
              control={
                <Switch
                  checked={updateBadgeEnabled}
                  onChange={setUpdateBadgeEnabled}
                  label={t("updates.showBadge")}
                />
              }
            />
            <div className="px-4 py-3 text-xs leading-relaxed text-muted">{t("updates.privacy")}</div>
          </div>
        </Section>
        )}
      </div>
    </div>
  );
}

/* ---- Shared bits: one look for every control on this page ---- */


// Hover/disabled states use background + text COLOR, never `opacity`. The CSS
// `opacity` property promotes an element to its own GPU compositing layer; in
// the packaged macOS WKWebView, hovering one such button (an opacity
// transition) forced a recomposite that mis-repainted the neighbouring
// disabled (`opacity-50`) buttons — they visibly flickered. Alpha backgrounds
// (`bg-accent/90`) are a plain paint, so no layer is promoted and nothing
// flickers.
const btnGhost = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1 rounded-input border border-border bg-surface px-3.5",
    "text-[13px] text-text transition-colors hover:bg-surface-2 disabled:text-muted",
    extra,
  );

const btnAccent = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3.5 text-[13px] font-medium",
    "text-accent-fg transition-colors hover:bg-accent/90 disabled:bg-accent/50",
    extra,
  );
