import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowLeftRight,
  Beaker,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileBarChart2,
  FileCheck2,
  FilePlus2,
  FlaskConical,
  FlaskRound,
  FolderKanban,
  FolderTree,
  Grid3x3,
  Home,
  LogOut,
  type LucideIcon,
  Microscope,
  NotebookPen,
  PanelLeft,
  Scale,
  Settings,
  Sparkles,
  Table2,
  Tags,
  Trash2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  useOverlayTitlebar,
  useUiStore,
} from "@/lib/store";
import { useUpdateStore } from "@/lib/update";
import { overlayTitlebarStyle } from "@/lib/titlebar";
import {
  listSessions,
  deleteSession as deleteFormulationSession,
  SESSIONS_CHANGED_EVENT,
  type SessionSummary,
} from "@/lib/formulationV2";
import { SETTINGS_SECTIONS, resolveSection } from "@/components/settings/sections";
import { useOptionalAuth } from "@/app/providers/AuthProvider";
import logo from "@/assets/logo.webp";

/** Dragging the divider below this pointer x collapses the sidebar; dragging
 *  back past it re-expands. Sits below SIDEBAR_MIN so there is a clear "snap". */
const COLLAPSE_BELOW = 140;

/** How many recent sessions show before "View all sessions" is needed. */
const SESSIONS_PREVIEW_COUNT = 5;

interface NavChild {
  key: string;
  icon: LucideIcon;
  label: string;
  path: string;
}

/** A single top-level entry: either a direct route (`leaf`) or an accordion
 *  group whose header only toggles expansion — the group's own overview page
 *  (if any) is an ordinary entry in `children`, never merged into the header,
 *  so header vs. row behavior is uniform across every group. */
type NavItem =
  | { type: "leaf"; key: string; icon: LucideIcon; label: string; path: string }
  | { type: "group"; key: string; icon: LucideIcon; label: string; children: NavChild[] };

/**
 * App navigation plus the list of saved formulations. The list is read from the
 * project folder (app data), not from any agent runtime — opening one shows its
 * stored cards without re-running a model.
 */
export function Sidebar() {
  const { t } = useTranslation(["nav", "settings", "session"]);
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  const logout = auth?.logout;
  // In settings the sidebar becomes the settings navigation: "Back to app" on
  // top, one row per section, and NO collapse affordance — a collapsed sidebar
  // would strand the user with no way back.
  const inSettings = location.pathname.startsWith("/settings");
  const activeSection = resolveSection(location.pathname.split("/")[2]);
  const showUpdateBadge = useUpdateStore((s) => s.showBadge);
  const {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    toggleSidebar,
  } = useUiStore();

  // While dragging, the live width lives here; the store (and localStorage)
  // are only written on pointer-up.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = dragWidth !== null;
  const width = dragWidth ?? sidebarWidth;

  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragWidth(sidebarWidth);
  };

  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // The sidebar starts at the window's left edge, so clientX is the width.
    const x = e.clientX;
    if (x < COLLAPSE_BELOW && !inSettings) {
      if (!sidebarCollapsed) setSidebarCollapsed(true);
      return;
    }
    if (sidebarCollapsed) setSidebarCollapsed(false);
    setDragWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, x)));
  };

  const onDividerPointerUp = () => {
    if (!dragging) return;
    setSidebarWidth(dragWidth);
    setDragWidth(null);
  };

  // ---- Saved formulations ----
  const [formulations, setFormulations] = useState<SessionSummary[]>([]);
  const refresh = useCallback(() => {
    void listSessions()
      .then(setFormulations)
      .catch(() => setFormulations([]));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(SESSIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, refresh);
  }, [refresh]);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const isMac = navigator.userAgent.includes("Mac");
  const overlayTitlebar = useOverlayTitlebar();

  // ---- Navigation groups (single source of truth for the sidebar's 10
  // route-bearing top-level entries, including "New Request" — the sole
  // formulation-request creation entry point. Sessions is an 11th,
  // pinned entry rendered separately below since it is pinned data, not
  // a route group). ----
  const navItems: NavItem[] = useMemo(
    () => [
      { type: "leaf", key: "home", icon: Home, label: t("workspacesNav.home"), path: "/home" },
      { type: "leaf", key: "newRequest", icon: FilePlus2, label: t("workspacesNav.newRequest"), path: "/formulation-request" },
      { type: "leaf", key: "projects", icon: FolderKanban, label: t("workspacesNav.projects"), path: "/projects" },
      {
        type: "group",
        key: "formulation",
        icon: Table2,
        label: t("workspacesNav.formulation"),
        children: [
          { key: "formulation", icon: Table2, label: t("workspacesNav.formulation"), path: "/formulation" },
          { key: "optimization", icon: Sparkles, label: t("workspacesNav.optimization"), path: "/optimization" },
          { key: "doe", icon: Grid3x3, label: t("workspacesNav.doe"), path: "/doe" },
          { key: "reverseFormulation", icon: Microscope, label: t("workspacesNav.reverseFormulation"), path: "/reverse-formulation" },
        ],
      },
      {
        type: "group",
        key: "laboratory",
        icon: Beaker,
        label: t("workspacesNav.laboratory"),
        children: [
          { key: "laboratory", icon: Beaker, label: t("workspacesNav.laboratory"), path: "/laboratory" },
          { key: "stability", icon: FlaskRound, label: t("workspacesNav.stability"), path: "/stability" },
        ],
      },
      {
        type: "group",
        key: "regulatory",
        icon: Scale,
        label: t("workspacesNav.regulatory"),
        children: [
          { key: "regulatory", icon: Scale, label: t("workspacesNav.regulatory"), path: "/regulatory" },
          { key: "dossiers", icon: FileCheck2, label: t("workspacesNav.dossiers"), path: "/dossiers" },
          { key: "claimsLabels", icon: Tags, label: t("workspacesNav.claimsLabels"), path: "/claims-labels" },
          { key: "approval", icon: CheckCircle2, label: t("workspacesNav.approval"), path: "/approval" },
        ],
      },
      { type: "leaf", key: "reports", icon: FileBarChart2, label: t("workspacesNav.reports"), path: "/reports" },
      { type: "leaf", key: "dataExchange", icon: ArrowLeftRight, label: t("workspacesNav.dataExchange"), path: "/data-exchange" },
      { type: "leaf", key: "administration", icon: Boxes, label: t("workspacesNav.administration"), path: "/administration" },
      {
        type: "group",
        key: "tools",
        icon: Wrench,
        label: t("sections.tools"),
        children: [
          { key: "notebooks", icon: NotebookPen, label: t("items.notebooks"), path: "/notebooks" },
          { key: "files", icon: FolderTree, label: t("items.files"), path: "/files" },
          { key: "runs", icon: FlaskConical, label: t("items.runs"), path: "/runs" },
        ],
      },
    ],
    [t],
  );

  const activeGroupKey = useMemo(
    () =>
      navItems.find(
        (item): item is Extract<NavItem, { type: "group" }> =>
          item.type === "group" && item.children.some((c) => c.path === location.pathname),
      )?.key,
    [navItems, location.pathname],
  );

  // Accordion: at most one group open at a time. The group holding the
  // active route auto-expands on navigation, closing any other — a manual
  // toggle can still collapse it, but the next navigation re-opens whichever
  // group is then active.
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  useEffect(() => {
    if (activeGroupKey) setExpandedGroup(activeGroupKey);
  }, [activeGroupKey]);
  const toggleGroup = (key: string) =>
    setExpandedGroup((current) => (current === key ? null : key));

  return (
    <div
      className={cn(
        "relative h-full shrink-0 overflow-hidden",
        !dragging && "transition-[width] duration-200 ease-out",
      )}
      style={{ width: sidebarCollapsed && !inSettings ? 0 : width }}
    >
      <aside
        className="sidebar-surface flex h-full flex-col border-r border-border"
        style={{ width }}
      >
        {/* The strip clears the traffic lights and hosts the collapse button just
          right of them — same spot the expand button lands when collapsed. */}
        {overlayTitlebar && (
          <div
            data-tauri-drag-region
            style={overlayTitlebarStyle(true)}
            className="flex shrink-0 items-center"
          >
            {!inSettings && (
              <button
                onClick={toggleSidebar}
                aria-label={t("sidebar.collapse")}
                title={t("sidebar.collapseTitle", { shortcut: "⌘B" })}
                className="rounded p-1 text-text hover:bg-surface-2"
              >
                <PanelLeft size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        )}

        {inSettings && (
          <>
            <div className={cn("px-3 pb-2", overlayTitlebar ? "pt-0" : "pt-3")}>
              <button
                onClick={() => navigate("/live")}
                className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <ArrowLeft size={15} />
                {t("settings:nav.back")}
              </button>
            </div>
            <nav className="flex flex-col gap-0.5 px-3">
              {SETTINGS_SECTIONS.map(({ key, icon: Icon }) => (
                <NavLink
                  key={key}
                  to={`/settings/${key}`}
                  className={cn(
                    "flex items-center gap-2 rounded-input px-2 py-1.5 text-[13px]",
                    activeSection === key
                      ? "bg-surface-2 text-text"
                      : "text-text/90 hover:bg-surface-2",
                  )}
                >
                  <Icon size={15} className={activeSection === key ? "text-text" : "text-muted"} />
                  {t(`settings:nav.${key}`)}
                </NavLink>
              ))}
            </nav>
          </>
        )}

        {!inSettings && (
          <>
            <div className={cn("px-4 pb-3", overlayTitlebar ? "pt-1" : "pt-4")}>
              <div className="flex items-baseline gap-1.5">
                <img src={logo} alt="" className="h-[18px] w-auto self-center" />
                {/* eslint-disable-next-line i18next/no-literal-string -- product brand name, not translated across locales (see AGENTS.md) */}
                <div className="font-serif text-[17px] font-semibold leading-none tracking-tight text-text">
                  FormuLab
                </div>
                <span className="text-[10px] uppercase tracking-widest text-muted">
                  {t("sidebar.betaBadge")}
                </span>
                {!overlayTitlebar && (
                  <button
                    onClick={toggleSidebar}
                    aria-label={t("sidebar.collapse")}
                    title={t("sidebar.collapseTitle", {
                      shortcut: isMac ? "⌘B" : "Ctrl+B",
                    })}
                    className="ml-auto self-center rounded p-1 text-text hover:bg-surface-2"
                  >
                    <PanelLeft size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>

            {/* The only scrolling region: the 10 route-bearing top-level
                entries (Sessions, pinned below, is an 11th — never here).
                "New Request" (in navItems) is the sole formulation-request
                creation entry point — no separate fixed "New" row. */}
            <nav aria-label={t("sections.workspaces")} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-1">
              {navItems.map((item) =>
                item.type === "leaf" ? (
                  <NavLink
                    key={item.key}
                    to={item.path}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-input px-2 py-1 text-[13px]",
                        isActive ? "bg-surface-2 text-text" : "text-text hover:bg-surface-2",
                      )
                    }
                  >
                    <span className="text-muted">
                      <item.icon size={16} />
                    </span>
                    <span>{item.label}</span>
                  </NavLink>
                ) : (
                  <div key={item.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(item.key)}
                      aria-expanded={expandedGroup === item.key}
                      aria-controls={`sidebar-group-${item.key}`}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-input px-2 py-1 text-[13px]",
                        activeGroupKey === item.key ? "text-text" : "text-text/90",
                        "hover:bg-surface-2",
                      )}
                    >
                      <span className="text-muted">
                        <item.icon size={16} />
                      </span>
                      <span className="flex-1 text-left">{item.label}</span>
                      {expandedGroup === item.key ? (
                        <ChevronDown size={14} className="text-muted" />
                      ) : (
                        <ChevronRight size={14} className="text-muted" />
                      )}
                    </button>
                    {expandedGroup === item.key && (
                      <div id={`sidebar-group-${item.key}`} className="ml-2 flex flex-col border-l border-border pl-2">
                        {item.children.map((child) => (
                          <NavLink
                            key={child.key}
                            to={child.path}
                            className={({ isActive }) =>
                              cn(
                                "flex items-center gap-2 rounded-input px-2 py-1 text-[13px]",
                                isActive ? "bg-surface-2 text-text" : "text-text/90 hover:bg-surface-2",
                              )
                            }
                          >
                            <span className="text-muted">
                              <child.icon size={15} />
                            </span>
                            <span>{child.label}</span>
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )}
            </nav>

            {/* Sessions: the 10th top-level entry, pinned above Settings so
                it never scrolls out of view with the groups above. Shows at
                most the latest 5, newest first, always in its own bounded
                scroll area (not just once expanded) so Settings can never be
                pushed out of the viewport regardless of row count. */}
            <div className="shrink-0 border-t border-border px-3 pb-2 pt-2">
              <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted">
                {t("history.heading")}
              </div>
              {formulations.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted">{t("history.empty")}</div>
              ) : (
                <>
                  <div className="flex max-h-64 flex-col overflow-y-auto">
                    {(showAllSessions ? formulations : formulations.slice(0, SESSIONS_PREVIEW_COUNT)).map((s) => {
                      const to = `/formulation-result/${s.id}`;
                      const title = s.brief?.target ?? s.id;
                      return (
                        <div key={s.id} className="group relative">
                          <NavLink
                            to={to}
                            className={cn(
                              "flex items-center gap-2 rounded-input py-1 pl-2 pr-8 text-[13px] hover:bg-surface-2",
                              location.pathname === to ? "bg-surface-2 text-text" : "text-text/90",
                            )}
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
                            <span className="flex-1 truncate">{title}</span>
                            {s.card_count > 1 && (
                              <span className="shrink-0 text-[10px] tabular-nums text-muted">
                                {s.card_count}
                              </span>
                            )}
                          </NavLink>
                          <button
                            onClick={async () => {
                              await deleteFormulationSession(s.id).catch(() => {});
                              refresh();
                              if (location.pathname === to) navigate("/formulation-request");
                            }}
                            aria-label={t("history.deleteAria", { title })}
                            className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted hover:bg-border hover:text-error group-hover:block"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {formulations.length > SESSIONS_PREVIEW_COUNT && (
                    <button
                      onClick={() => setShowAllSessions((v) => !v)}
                      className="mt-0.5 w-full rounded-input px-2 py-1 text-left text-[12px] text-muted hover:bg-surface-2 hover:text-text"
                    >
                      {showAllSessions ? t("history.showFewer") : t("history.viewAll")}
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="border-t border-border px-3 py-3">
              <button
                className="relative flex items-center gap-2 rounded-input px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-text"
                onClick={() => navigate("/settings")}
                aria-label={t("sidebar.settings")}
              >
                <Settings size={15} />
                <span>{t("sidebar.settings")}</span>
                {showUpdateBadge && (
                  <span
                    aria-hidden="true"
                    className="ml-auto h-2 w-2 rounded-full bg-error shadow-[0_0_0_2px_var(--color-surface)]"
                  />
                )}
              </button>
              {user && (
                <div className="mt-1 flex items-center gap-2 px-2 py-1">
                  <span
                    className="min-w-0 flex-1 truncate text-[12px] text-muted"
                    title={t("session:auth.account.signedInAs", { name: user.displayName })}
                  >
                    {user.displayName}
                  </span>
                  <button
                    onClick={() => void logout?.()}
                    aria-label={t("session:auth.account.logout")}
                    title={t("session:auth.account.logout")}
                    className="shrink-0 rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {/* Drag divider: resize within [SIDEBAR_MIN, SIDEBAR_MAX]; dragging far
          left snaps the sidebar closed. Kept mounted while collapsed so an
          in-flight drag (pointer capture) can re-open it. */}
      <div
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerUp}
        className={cn(
          "group absolute inset-y-0 right-0 z-10 w-[5px] cursor-col-resize",
          sidebarCollapsed && !dragging && "pointer-events-none",
        )}
      >
        <div
          className={cn(
            "absolute inset-y-0 right-0 w-[2px] transition-colors",
            dragging ? "bg-accent/60" : "bg-transparent group-hover:bg-accent/40",
          )}
        />
      </div>
    </div>
  );
}
