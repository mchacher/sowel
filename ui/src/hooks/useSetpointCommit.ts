import { useCallback, useEffect, useRef, useState } from "react";
import type { EquipmentWithDetails } from "../types";
import { useDevices } from "../store/useDevices";
import { setpointCommitDelay } from "../components/equipments/setpoint";

/** How long a sent value may outlive the device's silence (covers a cloud poll). */
export const SETPOINT_SETTLE_MS = 90_000;
/** How long the "not applied" line stays. */
export const SETPOINT_ERROR_MS = 4_000;
/** Below this gap the device is taken to report the value that was sent. */
const ECHO_EPSILON = 0.01;

type Phase = "idle" | "waiting" | "sending" | "settling";

export interface SetpointCommitOptions {
  /** The device's value. */
  value: number | null;
  /** Sends one order. A rejection reverts the display and raises `error`. */
  onCommit: (value: number) => Promise<void>;
  /** Wait after the last tap before sending (see `setpointCommitDelay`). */
  debounceMs: number;
  /** Longest the requested value is kept while the device stays silent. */
  settleMs?: number;
}

export interface SetpointCommit {
  /** What to display: the requested value while it is not confirmed, else the device's. */
  shown: number | null;
  /** True from the first tap until the device reports, the timeout, or an error. */
  pending: boolean;
  /** True for a few seconds after an order failed. */
  error: boolean;
  request: (value: number) => void;
}

/**
 * Spec 196, slice 8a — a setpoint stepper sends ONE order after the last tap.
 *
 * - every tap shows at once and none is lost, even while an order is in flight;
 * - the order leaves `debounceMs` after the last tap, with the last value;
 * - a value requested while an order is in flight leaves right after it;
 * - the requested value stays on screen until the device reports again (which
 *   confirms it or tells the truth), or `settleMs` at most, so a cloud device
 *   that reports on its next poll does not make the value jump back meanwhile;
 * - an error reverts to the device's value and raises `error`;
 * - a value still waiting when the surface unmounts (sheet closed right after
 *   the last tap) is sent at once.
 */
export function useSetpointCommit({
  value,
  onCommit,
  debounceMs,
  settleMs = SETPOINT_SETTLE_MS,
}: SetpointCommitOptions): SetpointCommit {
  const [requested, setRequested] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const requestedRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef(false);
  /** A value sent and not confirmed yet: a tap back to the device's value must still be sent. */
  const outstandingRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const clearTimer = (ref: { current: ReturnType<typeof setTimeout> | null }) => {
    if (ref.current !== null) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const settle = useCallback(() => {
    clearTimer(settleRef);
    phaseRef.current = "idle";
    requestedRef.current = null;
    outstandingRef.current = null;
    if (mountedRef.current) setRequested(null);
  }, []);

  // A report from the device once the order is out: it confirms the value or
  // says what the device actually took. Reports during the wait or the send
  // are older than the order and are ignored.
  useEffect(() => {
    valueRef.current = value;
    if (phaseRef.current === "settling") settle();
  }, [value, settle]);

  const flushRef = useRef<() => void>(() => {});

  const send = useCallback(
    (v: number) => {
      phaseRef.current = "sending";
      outstandingRef.current = v;
      const done = (ok: boolean) => {
        inflightRef.current = null;
        if (!mountedRef.current) return;
        if (queuedRef.current) {
          queuedRef.current = false;
          flushRef.current();
          return;
        }
        if (debounceRef.current !== null) {
          // The user is tapping again: the next send is the timer's.
          phaseRef.current = "waiting";
          return;
        }
        if (!ok) {
          phaseRef.current = "idle";
          requestedRef.current = null;
          outstandingRef.current = null;
          setRequested(null);
          setError(true);
          clearTimer(errorRef);
          errorRef.current = setTimeout(() => {
            errorRef.current = null;
            setError(false);
          }, SETPOINT_ERROR_MS);
          return;
        }
        const current = valueRef.current;
        if (current !== null && Math.abs(current - v) < ECHO_EPSILON) {
          // Already reported while the request was in flight.
          settle();
          return;
        }
        phaseRef.current = "settling";
        clearTimer(settleRef);
        settleRef.current = setTimeout(settle, settleMs);
      };
      inflightRef.current = Promise.resolve()
        .then(() => onCommitRef.current(v))
        .then(
          () => done(true),
          () => done(false),
        );
    },
    [settle, settleMs],
  );

  const flush = useCallback(() => {
    clearTimer(debounceRef);
    const v = requestedRef.current;
    if (v === null) return;
    if (inflightRef.current !== null) {
      queuedRef.current = true;
      return;
    }
    const current = valueRef.current;
    if (outstandingRef.current === null && current !== null && Math.abs(current - v) < ECHO_EPSILON) {
      // Tapped back to where the device already is: nothing to send.
      settle();
      return;
    }
    send(v);
  }, [send, settle]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const request = useCallback(
    (v: number) => {
      requestedRef.current = v;
      setRequested(v);
      setError(false);
      clearTimer(errorRef);
      clearTimer(settleRef);
      clearTimer(debounceRef);
      if (phaseRef.current !== "sending") phaseRef.current = "waiting";
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        flushRef.current();
      }, debounceMs);
    },
    [debounceMs],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer(settleRef);
      clearTimer(errorRef);
      // A value still waiting for its delay is sent now: closing the sheet
      // right after the last tap must not drop it.
      const waiting = debounceRef.current !== null || queuedRef.current;
      clearTimer(debounceRef);
      queuedRef.current = false;
      const v = requestedRef.current;
      if (!waiting || v === null) return;
      const commit = onCommitRef.current;
      const after = inflightRef.current ?? Promise.resolve();
      void after.then(() => commit(v)).catch(() => {
        // Nobody is left to show it; the device keeps its value.
      });
    };
  }, []);

  return { shown: requested ?? value, pending: requested !== null, error, request };
}

/** The commit delay for these equipments, from their devices' integrations. */
export function useSetpointCommitDelay(
  equipment: Pick<EquipmentWithDetails, "orderBindings"> | readonly Pick<EquipmentWithDetails, "orderBindings">[],
): number {
  return useDevices((s) => setpointCommitDelay(equipment, s.devices));
}
