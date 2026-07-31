import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { getTour } from "@/lib/help/tours";
import { useTourStore } from "@/lib/help/tourStore";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

/** How long a step waits for its target to appear before giving up and
 *  auto-advancing — short enough that a genuinely missing target doesn't
 *  strand the user, long enough to cover a route navigation or an async
 *  workspace load actually finishing. */
const TARGET_WAIT_TIMEOUT_MS = 800;
const TARGET_POLL_INTERVAL_MS = 50;

/**
 * The single, global guided-tour overlay — mounted once in `AppShell` (same
 * "mounted for every route" placement as `HelpPanel`/`HelpButton`), driven
 * entirely by `useTourStore`. Reads only `TOURS`/DOM element positions;
 * never touches project data, never calls a masterdata/bridge function —
 * it is a pure read-only spotlight over whatever the real page already
 * rendered.
 *
 * A step's target is found by polling `document.querySelector` for its
 * `data-tour` attribute rather than assuming it is already mounted: the
 * tour may need to navigate to its own route first (see the route effect
 * below), and even after that, a target can be gated behind a workspace's
 * own async load or the user's current tab/section (e.g. DoePanel's
 * "design" section only renders once a study is selected). If the target
 * still hasn't appeared after `TARGET_WAIT_TIMEOUT_MS`, the step
 * auto-advances rather than leaving the tour stuck pointing at nothing —
 * `TOURS`' own `notApproval` step deliberately has no target at all
 * (an informational step, not a fallback for a missing one).
 */
export function TourOverlay() {
  const { t: tRaw } = useTranslation("help");
  const t = tRaw as SimpleT;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeTourId = useTourStore((s) => s.activeTourId);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const next = useTourStore((s) => s.next);
  const back = useTourStore((s) => s.back);
  const skip = useTourStore((s) => s.skip);
  const finish = useTourStore((s) => s.finish);

  const tour = activeTourId ? getTour(activeTourId) : undefined;
  const step = tour?.steps[stepIndex];

  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const advancedForMissingRef = useRef(false);

  // Navigate to the tour's own route once, when the tour starts — "Start
  // tour" can be triggered from Help on a different route (or from the
  // onboarding prompt on Home), and a tour's targets only exist on its own
  // route. Re-runs only when the active tour changes, never per step.
  useEffect(() => {
    if (!tour) return;
    const onRoute = pathname === tour.route || pathname.startsWith(`${tour.route}/`);
    if (!onRoute) navigate(tour.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id]);

  useEffect(() => {
    setRect(null);
    advancedForMissingRef.current = false;
    if (!tour || !step?.target) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + TARGET_WAIT_TIMEOUT_MS;
    const selector = `[data-tour="${step.target}"]`;

    const poll = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
      if (el) {
        setRect(el.getBoundingClientRect());
        return;
      }
      if (Date.now() >= deadline) {
        if (!advancedForMissingRef.current) {
          advancedForMissingRef.current = true;
          next(tour.steps.length);
        }
        return;
      }
      timer = setTimeout(poll, TARGET_POLL_INTERVAL_MS);
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id, stepIndex, step?.target]);

  // Keep the spotlight aligned with its target across resize/scroll —
  // never a one-shot measurement that goes stale the moment the page moves.
  useEffect(() => {
    if (!step?.target) return;
    const selector = `[data-tour="${step.target}"]`;
    const reposition = () => {
      const el = document.querySelector(selector);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [step?.target]);

  useEffect(() => {
    if (!tour) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id, stepIndex, skip]);

  if (!tour || !step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === tour.steps.length - 1;
  const title = t(step.titleKey);

  return (
    <>
      <div className="fixed inset-0 z-[60]" role="presentation" onClick={() => skip()} />
      {rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[61] rounded-md transition-all duration-150"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgba(15, 15, 15, 0.55)",
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby="tour-step-body"
        tabIndex={-1}
        className="fixed z-[62] w-[300px] rounded-card border border-border bg-surface p-3.5 shadow-pop outline-none"
        style={cardPosition(rect)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <h2 className="text-[13px] font-medium text-text">{title}</h2>
          <button aria-label={t("ui.close")} onClick={() => skip()} className="text-muted hover:text-text">
            <X size={13} />
          </button>
        </div>
        <p id="tour-step-body" className="mb-3 text-[12px] text-muted">
          {t(step.bodyKey)}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] text-muted">
            {t("ui.tourProgress", { current: stepIndex + 1, total: tour.steps.length })}
          </span>
          <div className="flex gap-1.5">
            <button onClick={() => skip()} className="rounded-input px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
              {t("ui.tourSkip")}
            </button>
            {!isFirst && (
              <button onClick={() => back()} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                {t("ui.tourBack")}
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : next(tour.steps.length))}
              className="rounded-input bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90"
            >
              {isLast ? t("ui.tourFinish") : t("ui.tourNext")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function cardPosition(rect: DOMRect | null): CSSProperties {
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const margin = 10;
  const cardWidth = 300;
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow > 160 ? rect.bottom + margin : Math.max(margin, rect.top - margin - 180);
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - cardWidth - margin);
  return { top, left };
}
