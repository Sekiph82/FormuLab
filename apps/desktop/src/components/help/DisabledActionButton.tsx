import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useHelpStore } from "@/lib/help/store";
import type { DisabledReason } from "@/lib/help/disabledReason";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The reusable disabled-action explanation pattern. Renders a real
 * `<button disabled>` — never a styled-to-look-disabled enabled button —
 * plus, when `reason` is set, a small always-visible explanation naming
 * why, what's missing, who can do it, and where to read more. Always
 * visible rather than a hover tooltip: a genuinely disabled element is
 * unreliable to hover/focus across browsers, and "why is this greyed out"
 * should not require discovering an interaction.
 *
 * `onClick` is never wired when `reason` is set — the native `disabled`
 * attribute already blocks click/keyboard/Enter/Space activation, and this
 * removes any residual code path that could still fire the handler.
 */
export function DisabledActionButton({
  reason,
  onClick,
  children,
  className,
  wrapperClassName,
  ns = "help",
}: {
  reason: DisabledReason | null | undefined;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  /** Classes for the outer wrapper (button + explanation) — use this, not
   *  `className`, for layout/positioning that must apply even when the
   *  explanation block is present (e.g. `ml-auto` in a flex row). */
  wrapperClassName?: string;
  /** Namespace `reason.messageKey`/`prerequisite` resolve against — most
   *  reasons live in the shared `help` namespace, but a module may pass
   *  its own (e.g. "session") when a message key belongs there instead. */
  ns?: "help" | "session" | "common" | "nav" | "settings";
}) {
  const { t: tRaw } = useTranslation([ns, "help"]);
  const t = tRaw as SimpleT;
  // `t()` with an array of namespaces only searches the FIRST one for an
  // unprefixed key — it does not fall back to the rest of the array. These
  // four strings are this component's own fixed UI chrome and always live
  // in "help" regardless of which `ns` the caller passed for
  // `reason.messageKey`, so they are resolved with an explicit "help:"
  // prefix rather than relying on array fallback that doesn't exist.
  const tHelp: SimpleT = (key, opts) => t(`help:${key}`, opts);
  const openTopic = useHelpStore((s) => s.openTopic);
  const reasonId = useId();
  const disabled = !!reason;

  return (
    <div className={cn("inline-flex flex-col items-start gap-1", wrapperClassName)}>
      <button
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
        aria-describedby={reason ? reasonId : undefined}
        className={cn(className, disabled && "cursor-not-allowed")}
      >
        {children}
      </button>
      {reason && (
        <div id={reasonId} role="note" className="max-w-[280px] text-[11px] text-muted">
          <p>{t(reason.messageKey, reason.messageValues)}</p>
          {reason.requiredRole && <p>{tHelp("ui.requiredRole", { role: reason.requiredRole })}</p>}
          {reason.prerequisite && <p>{tHelp("ui.prerequisiteLabel", { prerequisite: reason.prerequisite })}</p>}
          <p>{reason.resolvable ? tHelp("ui.resolvableYes") : tHelp("ui.resolvableNo")}</p>
          {reason.relatedTopicId && (
            <button type="button" onClick={() => openTopic(reason.relatedTopicId!)} className="text-accent hover:underline">
              {tHelp("ui.learnMore")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
