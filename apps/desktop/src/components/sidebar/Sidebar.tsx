import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Beaker,
  Boxes,
  CheckCircle2,
  FileBarChart2,
  FileCheck2,
  FlaskConical,
  FlaskRound,
  FolderKanban,
  FolderTree,
  Home,
  NotebookPen,
  PanelLeft,
  Plus,
  Scale,
  Settings,
  Sparkles,
  Table2,
  Trash2,
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
import logo from "@/assets/logo.webp";

/** Dragging the divider below this pointer x collapses the sidebar; dragging
 *  back past it re-expands. Sits below SIDEBAR_MIN so there is a clear "snap". */
const COLLAPSE_BELOW = 140;

/**
 * App navigation plus the list of saved formulations. The list is read from the
 * project folder (app data), not from any agent runtime — opening one shows its
 * stored cards without re-running a model.
 */
export function Sidebar() {
  const { t } = useTranslation(["nav", "settings"]);
  const navigate = useNavigate();
  const location = useLocation();
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

  const isMac = navigator.userAgent.includes("Mac");
  const overlayTitlebar = useOverlayTitlebar();

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

            <nav className="flex flex-col px-3">
              <NavRow
                icon={<Plus size={16} />}
                label={t("items.new")}
                onClick={() => navigate("/live")}
              />

              <div className="px-2 pb-0.5 pt-3 text-xs font-medium uppercase tracking-wider text-muted">
                {t("sections.workspaces")}
              </div>
              <NavRow icon={<Home size={16} />} label={t("workspacesNav.home")} onClick={() => navigate("/home")} />
              <NavRow icon={<FolderKanban size={16} />} label={t("workspacesNav.projects")} onClick={() => navigate("/projects")} />
              <NavRow icon={<Table2 size={16} />} label={t("workspacesNav.formulation")} onClick={() => navigate("/formulation")} />
              <NavRow icon={<Beaker size={16} />} label={t("workspacesNav.laboratory")} onClick={() => navigate("/laboratory")} />
              <NavRow icon={<FlaskRound size={16} />} label={t("workspacesNav.stability")} onClick={() => navigate("/stability")} />
              <NavRow icon={<Sparkles size={16} />} label={t("workspacesNav.optimization")} onClick={() => navigate("/optimization")} />
              <NavRow icon={<Scale size={16} />} label={t("workspacesNav.regulatory")} onClick={() => navigate("/regulatory")} />
              <NavRow icon={<FileCheck2 size={16} />} label={t("workspacesNav.dossiers")} onClick={() => navigate("/dossiers")} />
              <NavRow icon={<CheckCircle2 size={16} />} label={t("workspacesNav.approval")} onClick={() => navigate("/approval")} />
              <NavRow icon={<FileBarChart2 size={16} />} label={t("workspacesNav.reports")} onClick={() => navigate("/reports")} />
              <NavRow icon={<Boxes size={16} />} label={t("workspacesNav.administration")} onClick={() => navigate("/administration")} />

              <div className="px-2 pb-0.5 pt-3 text-xs font-medium uppercase tracking-wider text-muted">
                {t("sections.tools")}
              </div>
              <NavRow
                icon={<NotebookPen size={16} />}
                label={t("items.notebooks")}
                onClick={() => navigate("/notebooks")}
              />
              <NavRow
                icon={<FolderTree size={16} />}
                label={t("items.files")}
                onClick={() => navigate("/files")}
              />
              <NavRow
                icon={<FlaskConical size={16} />}
                label={t("items.runs")}
                onClick={() => navigate("/runs")}
              />
            </nav>

            <div className="mt-4 flex-1 overflow-y-auto px-3 pb-2">
              <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted">
                {t("history.heading")}
              </div>
              {formulations.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted">{t("history.empty")}</div>
              ) : (
                formulations.map((s) => {
                  const to = `/live/${s.id}`;
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
                          if (location.pathname === to) navigate("/live");
                        }}
                        aria-label={t("history.deleteAria", { title })}
                        className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted hover:bg-border hover:text-error group-hover:block"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })
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

function NavRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-input px-2 py-1 text-[13px] text-text hover:bg-surface-2"
    >
      <span className="text-muted">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
