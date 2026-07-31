import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { useHelpStore } from "@/lib/help/store";

/**
 * The single reusable contextual-help affordance — a small "i" trigger next
 * to a field/label that discloses a localized title+body, with an optional
 * "Learn more" link into an existing `HELP_TOPICS` entry (via
 * `useHelpStore.openTopic`, the same mechanism `HelpPanel`/`HelpCenter`
 * already use — no second help system, no duplicated topic content here).
 *
 * Reuses `@radix-ui/react-popover` (already a repo dependency, already used
 * by `FigureBlock.tsx`'s annotation pins) rather than
 * `@radix-ui/react-tooltip`: a true ARIA tooltip must not contain
 * interactive content, and the optional "Learn more" button is interactive
 * — a popover is the correct primitive once a control can be clicked.
 * Portal-rendered, so the trigger never affects surrounding layout.
 *
 * Does not close on hover-out/blur (an early version did, and lost the
 * "Learn more" click the moment focus moved from the trigger into the
 * content). Opens on hover or focus (both idempotently set `open` to
 * `true`); click is deliberately left to `Popover.Trigger`'s own default
 * toggle rather than given a second, competing handler — an earlier
 * version added `onClick={() => setOpen(true)}` alongside Radix's
 * built-in composed click-to-toggle, and the two fought: hovering opens
 * it, then a click both my handler AND Radix's own toggle fired for,
 * netting closed. Closes via an outside click or clicking the (already
 * open) trigger again — Radix's own controlled-Popover behavior.
 *
 * A real bug caught while testing this component: Radix's
 * `Popover.Content` moves focus back to the trigger on close by default
 * (`onCloseAutoFocus`). Since the trigger opens on `onFocus`, that
 * default created an infinite close-then-reopen loop — every close
 * (Escape, outside click, Learn More) returned focus to the trigger,
 * which re-fired `onFocus`, which reopened it, forever. Fixed by
 * preventing the default close-auto-focus.
 *
 * Escape is handled by a capture-phase `document` listener here, not
 * Radix's `DismissableLayer` default: `DismissableLayer` only wires its
 * own Escape listener when it considers itself `isHighestLayer` (see
 * `@radix-ui/react-dismissable-layer`'s source), and this trigger's
 * "open on hover/focus without moving DOM focus into the content" shape
 * did not reliably satisfy that check in practice — `onEscapeKeyDown`
 * never fired. An `InfoTooltip` is always a leaf-level disclosure, never
 * a modal stacked under another dismissable layer, so there is no real
 * layering conflict to defer to Radix for here.
 */
export function InfoTooltip({
  title,
  body,
  learnMoreTopicId,
  ariaLabel,
}: {
  title: string;
  body: string;
  /** An existing `HELP_TOPICS` id — never free text, never a second copy
   *  of help content. */
  learnMoreTopicId?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation("help");
  const openTopic = useHelpStore((s) => s.openTopic);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? title}
          onMouseEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-muted outline-none hover:text-text focus-visible:ring-1 focus-visible:ring-accent"
        >
          <Info size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 max-w-[260px] rounded-card border border-border bg-surface px-3 py-2 text-[12px] text-text shadow-pop"
        >
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-muted">{body}</p>
          {learnMoreTopicId && (
            <button
              type="button"
              onClick={() => {
                openTopic(learnMoreTopicId);
                setOpen(false);
              }}
              className="mt-1.5 text-accent hover:underline"
            >
              {t("ui.learnMore")}
            </button>
          )}
          <Popover.Arrow className="fill-[var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
