import { createElement, useCallback, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../types";
import {
  ConfirmActionDialog,
  ConfirmActionSheet,
} from "../components/dashboard/ConfirmActionSheet";
import {
  gateNeedsConfirm,
  gatePrompt,
  type ConfirmPrompt,
} from "../components/dashboard/gate-confirm";

/**
 * Touch first: the slide. A mouse or a trackpad gets the dialog instead
 * (spec 196, portail-desktop), whatever the window width — an iPad in a PWA is
 * touch at desktop widths, a narrow browser window is a mouse at phone widths.
 */
export function prefersSlide(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

interface Pending {
  prompt: ConfirmPrompt;
  run: () => void;
  slide: boolean;
}

/** The confirmation is portaled, but React still bubbles its events to the caller's tile or row. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Spec 196 (slice P) — one gate, one answer, on every surface.
 *
 * When the admin turned on « Confirmation avant action » for a gate (spec 146),
 * every UI path where one tap or click actuates it goes through `guardGate`: the
 * dashboard tiles at every width, the detail sheet, the Maison row, the
 * equipment list and page, the timed controls. It asks first — the slide sheet
 * on a touch screen, a two-button dialog with a pointer — and runs the order
 * only once confirmed. An unguarded gate runs it straight away. Modes, recipes'
 * automations and the guest page do not come through here (portail-mode).
 *
 * `guard` is the same thing for a caller that decides on its own whether to ask
 * (the recipe tile reads the gate its recipe drives, spec 171).
 *
 * The prompt is taken when the press happens: it names what that press asked for.
 * Render `element` next to the control, outside any clickable ancestor if
 * possible; its events are stopped from bubbling either way.
 */
export function useGuardedAction(): {
  guard: (needsConfirm: boolean, prompt: () => ConfirmPrompt, run: () => void) => void;
  guardGate: (
    equipment: EquipmentWithDetails,
    value: string | null,
    run: () => void,
    zoneName?: string,
  ) => void;
  element: ReactNode;
} {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);

  const guard = useCallback(
    (needsConfirm: boolean, prompt: () => ConfirmPrompt, run: () => void) => {
      if (!needsConfirm) {
        run();
        return;
      }
      setPending({ prompt: prompt(), run, slide: prefersSlide() });
    },
    [],
  );

  const guardGate = useCallback(
    (equipment: EquipmentWithDetails, value: string | null, run: () => void, zoneName?: string) =>
      guard(gateNeedsConfirm(equipment), () => gatePrompt(equipment, value, t, zoneName), run),
    [guard, t],
  );

  const close = useCallback(() => setPending(null), []);

  let element: ReactNode = null;
  if (pending) {
    const { prompt, run, slide } = pending;
    const inner = slide
      ? createElement(ConfirmActionSheet, {
          title: prompt.title,
          subtitle: prompt.subtitle,
          slideLabel: prompt.slideLabel,
          confirmedLabel: prompt.confirmedLabel,
          onConfirm: run,
          onClose: close,
        })
      : createElement(ConfirmActionDialog, {
          title: prompt.title,
          subtitle: prompt.subtitle,
          confirmLabel: prompt.confirmLabel,
          onConfirm: run,
          onClose: close,
        });
    element = createElement(
      "div",
      {
        className: "contents",
        onClick: stop,
        onPointerDown: stop,
        onKeyDown: stop,
      },
      inner,
    );
  }

  return { guard, guardGate, element };
}
