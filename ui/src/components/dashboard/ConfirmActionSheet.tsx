import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "./BottomSheet";
import { SlideToConfirm } from "./SlideToConfirm";

/**
 * Spec 146 — minimal confirmation sheet for a sensitive action on the mobile
 * dashboard (issue #320, UX variant B). Just the question and a
 * slide-to-confirm; completing the slide actuates and closes the sheet.
 *
 * Presentational since spec 171: a recipe tile guards the same physical gate
 * with no equipment of its own to describe it, so the wording comes from the
 * caller (`gatePrompt` words it for a gate). Since spec 196 it is the touch form
 * of `useGuardedAction`; `ConfirmActionDialog` below is the pointer form.
 */
export function ConfirmActionSheet({
  title,
  subtitle,
  slideLabel,
  confirmedLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  subtitle?: string;
  slideLabel: string;
  confirmedLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const closeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const handleConfirm = () => {
    onConfirm();
    // Keep the confirmed (green) state visible briefly, then dismiss.
    closeTimer.current = window.setTimeout(onClose, 500);
  };

  return (
    <BottomSheet open onClose={onClose} title={title}>
      {/* The slide has to sit in the thumb's arc, not on the phone's chin, and
          the height above the bottom edge is bought with content rather than
          with empty space: cancel is a real button instead of a text link, and
          the stack breathes. Growing the sheet or floating it were both tried
          and both read as a hole in the layout (#858). Cancel is deliberately
          narrower and lighter than the slide: primary action, secondary exit.
          These are dimensions, not decoration — the extraction of spec 171 lost
          them once, which is why a test now pins them. */}
      <div className="flex flex-col gap-6 pt-2 pb-8">
        {subtitle && (
          <p className="text-caption text-text-tertiary text-center -mt-1">{subtitle}</p>
        )}
        <SlideToConfirm
          label={slideLabel}
          confirmedLabel={confirmedLabel}
          onConfirm={handleConfirm}
        />
        <button
          onClick={onClose}
          className="w-[150px] mx-auto mt-4 text-center text-small text-text-secondary border border-border rounded-sm py-2 hover:bg-border-light cursor-pointer"
        >
          {t("common.cancel")}
        </button>
      </div>
    </BottomSheet>
  );
}

/**
 * Spec 196 (slice P) — the same question for a fine pointer: a slide is awkward
 * with a mouse, and the second click is what stops an accidental first one. Two
 * buttons, the action named on the primary one. Enter confirms (the primary
 * button has the focus), Escape and a click outside cancel.
 *
 * A modal dialog for the keyboard too: Tab and Shift+Tab cycle inside it, the
 * focus goes back to what opened it, the subtitle is its description. Escape is
 * handled on the dialog itself, where the focus is: `useGuardedAction` stops the
 * clicks of its portal from reaching the tile, and a key stopped on the way up
 * would never reach a window listener (which stays, for a focus left outside).
 *
 * What opened it must not also confirm it: the second click of a double click
 * and a held Enter (its auto-repeat) are ignored, only a fresh press confirms.
 *
 * Rendered into `document.body`, like the other dialogs: a tile's opacity and
 * stacking must not reach it. Its events still bubble through the React tree,
 * which is why `useGuardedAction` wraps it in an element that stops the clicks.
 */
export function ConfirmActionDialog({
  title,
  subtitle,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  subtitle?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const subtitleId = useId();
  // Read while rendering: the primary button takes the focus at commit.
  const [opener] = useState(() =>
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    },
    [opener],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Nothing behind a modal dialog answers its keys (a sheet's own Escape included).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={subtitle ? subtitleId : undefined}
        // A click on the text keeps the focus in the dialog, so its keys still land here.
        tabIndex={-1}
        className="bg-surface rounded-lg p-5 w-full max-w-sm shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h3 className="text-lead font-semibold text-text">{title}</h3>
        {subtitle && (
          <p id={subtitleId} className="text-caption text-text-tertiary mt-1">
            {subtitle}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-small font-medium text-text-secondary border border-border rounded-sm hover:bg-border-light transition-colors cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            autoFocus
            onKeyDown={(e) => {
              // A held Enter repeats: the press that opened the dialog must not confirm it.
              if (e.key === "Enter" && e.repeat) e.preventDefault();
            }}
            onClick={(e) => {
              // The second click of a double click lands here as well.
              if (e.detail > 1) return;
              onClose();
              onConfirm();
            }}
            className="px-4 py-2 text-small font-medium bg-primary-fill text-white rounded-sm hover:bg-primary-fill-hover transition-colors cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
