import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  FolderOpen,
  Loader2,
  Minus,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import type { McpServer } from "@ai4s/sdk";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useUiStore, ZOOM_MAX, ZOOM_MIN } from "@/lib/store";
import { shippedLocales } from "@/i18n/config";
import { getClient, useRuntimeStore } from "@/lib/runtime";
import { useUpdateStore } from "@/lib/update";
import {
  isMacUA,
  isTauri,
  jupyterStatus,
  openExternal,
  openWorkspaceBase,
  pickFolder,
  pythonInterpreter,
  removeConfigEntry,
  setPythonPath,
  setWorkspaceBase,
  workspaceBase,
  type JupyterStatus,
  type PythonInterpreter,
  getProxySetting,
  type ProxyMode,
  type ProxySetting,
  getMirrorSetting,
  setMirrorSetting,
  type MirrorSetting,
} from "@/lib/tauri";
import { useSetupStore } from "@/lib/setup";
import { RemoteComputeCard } from "@/components/settings/RemoteComputeCard";
import { ModalCard } from "@/components/settings/ModalCard";
import { DataFlowCard } from "@/components/settings/DataFlowCard";
import { FormulationProviderCard } from "@/components/settings/FormulationProviderCard";
import { Row, Section, Switch } from "@/components/settings/Section";
import { resolveSection } from "@/components/settings/sections";
import { inputCls, selectCls } from "@/components/settings/inputCls";
import { SCIENCE_CONNECTORS } from "@/lib/scienceConnectors";
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
  const status = useRuntimeStore((s) => s.status);
  const serverUrl = useRuntimeStore((s) => s.serverUrl);
  const setServerUrl = useRuntimeStore((s) => s.setServerUrl);
  const connect = useRuntimeStore((s) => s.connect);
  const disconnect = useRuntimeStore((s) => s.disconnect);
  const defaultModel = useRuntimeStore((s) => s.defaultModel);
  const connected = status === "ready";
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
  const jupyterBusy = useSetupStore((s) => s.jupyterBusy);
  const enablingConnector = useSetupStore((s) => s.connectorId);
  const setupLine = useSetupStore((s) => s.line);
  const setupGeneration = useSetupStore((s) => s.generation);

  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [jupyter, setJupyter] = useState<JupyterStatus | null>(null);
  // The interpreter local Python kernels resolve to + the manual override input.
  const [pyInfo, setPyInfo] = useState<PythonInterpreter | null>(null);
  const [pyPath, setPyPath] = useState("");
  const [savingPy, setSavingPy] = useState(false);
  // API keys typed for key-requiring connectors, keyed by connector id.
  const [connectorKeys, setConnectorKeys] = useState<Record<string, string>>({});

  // Add-MCP-server form.
  const [mName, setMName] = useState("");
  const [mType, setMType] = useState<"local" | "remote">("local");
  const [mTarget, setMTarget] = useState("");
  const [wsPath, setWsPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);



  // Auxiliary settings data (MCP connectors + Jupyter). The model catalog is no
  // longer loaded here: the formulation pipeline's provider/model/key live in
  // FormulationProviderCard, independent of the runtime.
  const refresh = useCallback(async (): Promise<void> => {
    const client = getClient();
    if (!client) return;
    try {
      const mcp = await client.listMcpServers().catch(() => []);
      setMcpServers(mcp);
      setJupyter(await jupyterStatus());
    } catch {
      /* runtime not ready yet */
    }
  }, []);

  // Re-refresh when a provisioning run finishes (setupGeneration bumps) so a
  // newly-enabled MCP shows up even if setup completed while this page was
  // closed — the flow itself lives in the setup store.
  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh, setupGeneration]);
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

  // Network proxy for the sidecar (follow system / custom / direct).
  const [proxy, setProxy] = useState<ProxySetting | null>(null);
  const [proxyUrlInput, setProxyUrlInput] = useState("");
  const refreshProxy = useCallback(() => {
    void getProxySetting().then((p) => {
      setProxy(p);
      if (p) setProxyUrlInput(p.url);
    });
  }, []);
  useEffect(refreshProxy, [refreshProxy]);

  const applyProxy = (mode: ProxyMode, url: string) =>
    run(t("toast.couldNotSetProxy"), async () => {
      await useRuntimeStore.getState().setProxySetting(mode, url);
      refreshProxy();
      toast.success(t("toast.proxyApplied"));
    });

  /** Mode select: system/none apply immediately; custom just reveals the URL
   *  field — it applies on Save/Enter once a URL is typed. */
  const changeProxyMode = (mode: ProxyMode) => {
    if (!proxy) return;
    if (mode === "custom") {
      setProxy({ ...proxy, mode: "custom" });
      return;
    }
    void applyProxy(mode, "");
  };
  const validProxyUrl = /^(https?|socks5):\/\/\S+:\d+\/?$/i.test(proxyUrlInput.trim());

  // uv download mirrors, used only when provisioning Python tools (Jupyter,
  // science databases). Optional; a blank field clears that mirror.
  const [mirror, setMirror] = useState<MirrorSetting | null>(null);
  const [pypiInput, setPypiInput] = useState("");
  const [pythonInput, setPythonInput] = useState("");
  useEffect(() => {
    void getMirrorSetting().then((m) => {
      setMirror(m);
      if (m) {
        setPypiInput(m.pypi);
        setPythonInput(m.python);
      }
    });
  }, []);
  const validMirror = (u: string) => u.trim() === "" || /^https?:\/\/\S+$/i.test(u.trim());
  const mirrorDirty =
    !!mirror && (pypiInput.trim() !== mirror.pypi || pythonInput.trim() !== mirror.python);
  const applyMirror = () =>
    run(t("toast.couldNotSetMirror"), async () => {
      await setMirrorSetting(pypiInput.trim(), pythonInput.trim());
      setMirror({ pypi: pypiInput.trim(), python: pythonInput.trim() });
      toast.success(t("toast.mirrorSaved"));
    });

  // The one post-change sequence shared by every action in this page.
  const refreshAll = async () => {
    await refresh();
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refreshAll();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };











  const addMcp = () =>
    run(t("toast.couldNotAddMcp"), async () => {
      const name = mName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const target = mTarget.trim();
      if (!name || !target) {
        toast.error(t("toast.mcpFieldsRequired"));
        return;
      }
      await getClient()!.addMcpServer(
        name,
        mType === "local"
          ? { type: "local", command: target.split(/\s+/), enabled: true }
          : { type: "remote", url: target, enabled: true },
      );
      toast.success(t("toast.mcpAdded", { name }));
      setMName("");
      setMTarget("");
    });

  // The provisioning flows themselves live in the setup store so they outlive
  // this page. The connector's API key is dropped from UI state up front — the
  // store already holds the value it needs, so it never lingers here.
  const enableConnector = (id: string) => {
    const key = connectorKeys[id];
    setConnectorKeys((k) => ({ ...k, [id]: "" }));
    void useSetupStore.getState().enableConnector(id, key);
  };

  const removeMcp = (name: string) =>
    run(t("toast.couldNotRemoveMcp"), async () => {
      await removeConfigEntry("mcp", name);
      await useRuntimeStore.getState().connectRetry();
      toast.success(t("toast.mcpRemoved", { name }));
    });



  return (
    <div className="h-full overflow-y-auto">
      {/* Modest top padding: the AppShell titlebar strip already clears 48px. */}
      <div className="mx-auto max-w-2xl px-8 pb-16 pt-4">
        <h1 className="font-serif text-2xl text-text">{t(`nav.${section}`)}</h1>

        {/* ---- Agent runtime ---- */}
        {section === "runtime" && (
        <Section title={t("runtime.title")} hint={t("runtime.hint")}>
          <div className="flex items-center gap-2">
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder={t("runtime.serverUrlPlaceholder")}
              className={inputCls("flex-1 font-mono")}
            />
            {connected ? (
              <button onClick={disconnect} className={btnGhost()}>
                {t("runtime.disconnect")}
              </button>
            ) : (
              <button onClick={connect} className={btnAccent()}>
                {t("runtime.connect")}
              </button>
            )}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connected ? "bg-ok" : status === "error" ? "bg-error" : "bg-muted",
              )}
            />
            <span className="capitalize">{status}</span>
            {connected && defaultModel && (
              <>
                <span className="text-border">·</span>
                <span className="font-mono">{defaultModel}</span>
              </>
            )}
          </div>

          {/* Network proxy: follow system / custom / direct. system and none
              apply on select; custom applies on Save (needs a URL first). */}
          {isTauri && proxy && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-xs text-muted">{t("runtime.proxyLabel")}</span>
                <select
                  value={proxy.mode}
                  onChange={(e) => changeProxyMode(e.target.value as ProxyMode)}
                  disabled={busy}
                  className={selectCls("w-44")}
                >
                  <option value="system">{t("runtime.proxySystem")}</option>
                  <option value="custom">{t("runtime.proxyCustom")}</option>
                  <option value="none">{t("runtime.proxyNone")}</option>
                </select>
                {proxy.mode === "custom" && (
                  <>
                    <input
                      value={proxyUrlInput}
                      onChange={(e) => setProxyUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && validProxyUrl) void applyProxy("custom", proxyUrlInput.trim());
                      }}
                      placeholder={t("runtime.proxyPlaceholder")}
                      className={inputCls("flex-1 font-mono")}
                    />
                    <button
                      className={btnAccent()}
                      onClick={() => void applyProxy("custom", proxyUrlInput.trim())}
                      disabled={busy || !validProxyUrl}
                    >
                      <Check size={13} /> {t("common:actions.save")}
                    </button>
                  </>
                )}
              </div>
              <p className="mt-1.5 pl-28 text-[11px] leading-relaxed text-muted">
                {proxy.mode === "none"
                  ? t("runtime.proxyDirectHint")
                  : proxy.effective
                    ? t("runtime.proxyEffective", { url: proxy.effective })
                    : t("runtime.proxyNoneDetected")}
              </p>
            </div>
          )}

          {/* uv download mirrors: only used when setting up Python tools where
              pypi.org / github.com are slow. Optional; applies on Save. */}
          {isTauri && mirror && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-xs text-muted">{t("runtime.mirrorPypi")}</span>
                <input
                  value={pypiInput}
                  onChange={(e) => setPypiInput(e.target.value)}
                  placeholder={t("runtime.mirrorPypiPlaceholder")}
                  className={inputCls("flex-1 font-mono")}
                />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="w-28 shrink-0 text-xs text-muted">{t("runtime.mirrorPython")}</span>
                <input
                  value={pythonInput}
                  onChange={(e) => setPythonInput(e.target.value)}
                  placeholder={t("runtime.mirrorPythonPlaceholder")}
                  className={inputCls("flex-1 font-mono")}
                />
                <button
                  className={btnAccent()}
                  onClick={() => void applyMirror()}
                  disabled={busy || !mirrorDirty || !validMirror(pypiInput) || !validMirror(pythonInput)}
                >
                  <Check size={13} /> {t("common:actions.save")}
                </button>
              </div>
              <p className="mt-1.5 pl-28 text-[11px] leading-relaxed text-muted">
                {t("runtime.mirrorHint")}
              </p>
            </div>
          )}
        </Section>
        )}

        {/* ---- Models ---- */}
        {/* Provider + model + key for the direct formulation pipeline. */}
        {section === "models" && <FormulationProviderCard />}

        {/* ---- MCP servers ---- */}
        {section === "connectors" && (
        <Section title={t("mcp.title")} hint={t("mcp.hint")} flush>
          {!connected ? (
            <p className="px-4 py-3 text-[13px] text-muted">{t("mcp.connectPrompt")}</p>
          ) : (
            <div>
              {/* Curated open-source science connectors — one-click enable. */}
              {isTauri &&
                SCIENCE_CONNECTORS.filter((c) => !mcpServers.some((s) => s.name === c.id)).map(
                  (c) => {
                    const keyMissing = Boolean(c.apiKeyEnv) && !connectorKeys[c.id]?.trim();
                    return (
                      <div
                        key={c.id}
                        className="border-b border-border bg-surface px-3 py-2.5 text-[13px]"
                      >
                        <div className="flex items-center gap-2.5">
                          <Search size={14} className="shrink-0 text-muted" />
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-text">{c.label}</span>
                            <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted ring-1 ring-border">
                              {c.discipline}
                            </span>
                            <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted ring-1 ring-border">
                              {t("mcp.openSource")}
                            </span>
                            <div className="truncate text-xs text-muted">{c.description}</div>
                            <div className="truncate font-mono text-[11px] text-muted/70">
                              {c.source}
                              {c.installNote ? ` · ${c.installNote}` : ""}
                            </div>
                          </div>
                          <button
                            className={btnAccent("h-8")}
                            onClick={() => void enableConnector(c.id)}
                            disabled={enablingConnector !== null || busy || keyMissing}
                            title={keyMissing ? t("mcp.enterKeyFirstTitle") : undefined}
                          >
                            {enablingConnector === c.id ? (
                              <>
                                <Loader2 size={12} className="animate-spin" /> {t("mcp.settingUp")}
                              </>
                            ) : (
                              t("mcp.enable")
                            )}
                          </button>
                        </div>
                        {c.apiKeyEnv && (
                          <div className="mt-2 flex items-center gap-2 pl-6">
                            <input
                              type="password"
                              value={connectorKeys[c.id] ?? ""}
                              onChange={(e) =>
                                setConnectorKeys((k) => ({ ...k, [c.id]: e.target.value }))
                              }
                              placeholder={`${c.apiKeyEnv} ${t("mcp.freeKeySuffix")}`}
                              className="h-8 min-w-0 flex-1 rounded-input border border-border bg-surface-2 px-2 font-mono text-[12px] text-text placeholder:text-muted/60"
                            />
                            {c.apiKeyUrl && (
                              <a
                                href={c.apiKeyUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-accent hover:underline"
                              >
                                <ExternalLink size={11} /> {t("mcp.getFreeKey")}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              {/* Featured: one-click Jupyter (shown until its MCP entry exists). */}
              {isTauri && !mcpServers.some((s) => s.name === "jupyter") && (
                <div className="flex items-center gap-2.5 border-b border-border bg-surface px-3 py-2.5 text-[13px]">
                  <NotebookPen size={14} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-text">{t("mcp.jupyterLabel")}</span>
                    <span className="ml-2 text-xs text-muted">
                      {t("mcp.jupyterDescription")}
                    </span>
                  </div>
                  <button
                    className={btnAccent("h-8")}
                    onClick={() => void useSetupStore.getState().enableJupyter()}
                    disabled={jupyterBusy || busy}
                  >
                    {jupyterBusy ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> {t("mcp.settingUp")}
                      </>
                    ) : jupyter?.installed ? (
                      t("mcp.enable")
                    ) : (
                      t("mcp.setUpAndEnable")
                    )}
                  </button>
                </div>
              )}
              {/* Live uv output while a provisioning run is in flight — a
                  300 MB download must never look like a frozen spinner. */}
              {(jupyterBusy || enablingConnector !== null) && (
                <div className="flex items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-1.5">
                  <Loader2 size={11} className="shrink-0 animate-spin text-muted" />
                  <span className="truncate font-mono text-[11px] text-muted">
                    {setupLine ?? t("mcp.startingDownload")}
                  </span>
                </div>
              )}
              {mcpServers.map((s, i) => (
                <div
                  key={s.name}
                  className={cn(
                    "flex h-10 items-center gap-2.5 bg-surface px-3 text-[13px]",
                    i > 0 && "border-t border-border",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      s.status === "connected"
                        ? "bg-ok"
                        : s.status === "failed"
                          ? "bg-error"
                          : "bg-muted",
                    )}
                  />
                  <span className="font-medium text-text">{s.name}</span>
                  <span className="text-xs text-muted">
                    {s.config?.type ?? "?"} · {s.status}
                  </span>
                  <span className="max-w-[260px] flex-1 truncate text-right font-mono text-[11px] text-muted/70">
                    {s.config?.type === "local"
                      ? s.config.command.join(" ")
                      : s.config?.type === "remote"
                        ? s.config.url
                        : ""}
                  </span>
                  <button
                    className="shrink-0 text-xs text-muted transition-colors hover:text-error"
                    onClick={() => void removeMcp(s.name)}
                    disabled={busy}
                  >
                    {t("common:actions.remove")}
                  </button>
                </div>
              ))}

              <div
                className={cn(
                  "space-y-2 bg-surface-2/50 p-3",
                  mcpServers.length > 0 && "border-t border-border",
                )}
              >
                <div className="flex gap-2">
                  <input
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    placeholder={t("mcp.namePlaceholder")}
                    className={inputCls("flex-1")}
                  />
                  <select
                    value={mType}
                    onChange={(e) => setMType(e.target.value as "local" | "remote")}
                    className={selectCls("w-[110px]")}
                  >
                    <option value="local">{t("mcp.typeLocal")}</option>
                    <option value="remote">{t("mcp.typeRemote")}</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    value={mTarget}
                    onChange={(e) => setMTarget(e.target.value)}
                    placeholder={
                      mType === "local"
                        ? t("mcp.commandPlaceholder")
                        : t("mcp.urlPlaceholder")
                    }
                    className={inputCls("flex-1 font-mono")}
                  />
                  <button className={btnAccent()} onClick={() => void addMcp()} disabled={busy}>
                    {t("mcp.addServer")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Section>
        )}

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
