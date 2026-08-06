import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useOnboardingStore } from "@/lib/help/onboardingStore";
import { useTourStore } from "@/lib/help/tourStore";
import { TOURS } from "@/lib/help/tours";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

/**
 * First-use onboarding — a small dismissible, non-modal card (mounted once
 * in `AppShell`, same global placement as `HelpButton`), never blocking the
 * rest of the app. Shows exactly once per local profile
 * (`formulab.onboarding.dismissed.v1`, see `onboardingStore.ts`); picking a
 * tour or explicitly dismissing both count as "seen" and never show it
 * again. Launching a tour reuses `useTourStore.startTour` — the exact same
 * entry point `HelpPanel`'s "Start tour" button uses — so there is only
 * ever one way a tour begins.
 */
export function OnboardingPrompt() {
  const { t: tRaw } = useTranslation("help");
  const t = tRaw as SimpleT;
  const dismissed = useOnboardingStore((s) => s.dismissed);
  const dismiss = useOnboardingStore((s) => s.dismiss);
  const startTour = useTourStore((s) => s.startTour);

  if (dismissed) return null;

  return (
    <div
      role="dialog"
      aria-label={t("ui.onboarding.title")}
      className="fixed bottom-4 left-4 z-40 w-[300px] rounded-card border border-border bg-surface p-3.5 shadow-card"
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h2 className="text-[12.5px] font-medium text-text">{t("ui.onboarding.title")}</h2>
        <button aria-label={t("ui.close")} onClick={dismiss} className="text-muted hover:text-text">
          <X size={13} />
        </button>
      </div>
      <p className="mb-2.5 text-[11.5px] text-muted">{t("ui.onboarding.body")}</p>
      <div className="flex flex-wrap gap-1.5">
        {TOURS.map((tour) => (
          <button
            key={tour.id}
            onClick={() => {
              dismiss();
              startTour(tour.id);
            }}
            className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
          >
            {t(tour.titleKey)}
          </button>
        ))}
      </div>
      <button onClick={dismiss} className="mt-2 text-[11px] text-muted hover:text-text hover:underline">
        {t("ui.onboarding.skip")}
      </button>
    </div>
  );
}
