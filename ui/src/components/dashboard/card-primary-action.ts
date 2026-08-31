import { useRef } from "react";

/** Nested controls own their own clicks: a card action must stay out of their way. */
const CONTROL_SELECTOR = "button, input, select, textarea, a, [role='button'], [role='slider']";

function inControl(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(CONTROL_SELECTOR);
}

/**
 * Handlers turning a whole card into its widget's primary action.
 *
 * Two gestures must NOT trigger it: a click on a nested control, which would
 * fire the action twice, and a slider drag released off its track, whose click
 * event lands on the card because the card is the common ancestor of the
 * pointerdown and the pointerup. Hence the pointerdown bookkeeping — checking
 * the click target alone misses the second case.
 *
 * Extracted from `WidgetCard` (spec 098) when the recipe tile's mobile shell
 * needed the same guard (spec 171). Re-typing it is how the slider bug comes
 * back; there is one copy, and both surfaces spread it.
 */
export function useCardPrimaryAction(onClick?: () => void): {
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
} {
  const startedInControl = useRef(false);

  if (!onClick) return {};

  return {
    onPointerDown: (e: React.PointerEvent) => {
      startedInControl.current = inControl(e.target);
    },
    onClick: (e: React.MouseEvent) => {
      const fromControl = startedInControl.current;
      startedInControl.current = false;
      if (fromControl || inControl(e.target)) return;
      onClick();
    },
  };
}
