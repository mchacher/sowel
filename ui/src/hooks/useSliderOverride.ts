import { useState, useRef, useCallback } from "react";

const DEFAULT_SETTLE_MS = 2000;

/**
 * Manages local slider override during drag → commit → settle cycle.
 *
 * While the user drags, the local value takes precedence over the device value.
 * After commit (mouseUp / touchEnd), the override stays active for `settleMs`
 * to avoid the slider snapping back before the device reports the new value.
 */
export function useSliderOverride(settleMs = DEFAULT_SETTLE_MS) {
  const [localValue, setLocalValue] = useState<number | null>(null);
  const localValueRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  /** Returns the display value: local override if active, otherwise device value. */
  const displayValue = useCallback(
    (deviceValue: number | null): number | null =>
      localValue !== null ? localValue : deviceValue,
    [localValue],
  );

  /** Call on pointerDown / touchStart to mark drag as active. */
  const onStart = useCallback(() => {
    draggingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Call on every slider change event (drag). */
  const onChange = useCallback(
    (newValue: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      localValueRef.current = newValue;
      setLocalValue(newValue);
    },
    [],
  );

  /** Call on mouseUp / touchEnd — sends value then clears after settle delay. */
  const onCommit = useCallback(
    async (sendFn: (value: number) => Promise<void>) => {
      draggingRef.current = false;
      const val = localValueRef.current;
      if (val === null) return;
      try {
        await sendFn(val);
      } catch {
        // Ignore — caller handles errors if needed
      }
      timerRef.current = setTimeout(() => {
        setLocalValue(null);
        localValueRef.current = null;
        timerRef.current = null;
      }, settleMs);
    },
    [settleMs],
  );

  return { displayValue, onStart, onChange, onCommit };
}
