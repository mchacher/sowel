import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Scroll speed of a name too long for its room, in px per second. */
const SPEED_PX_S = 30;
/** Touch: at rest at the start long enough to read the first words. */
const LOOP_HOLD_START_MS = 2500;
/** Touch: a short pause at the end, then a jump back to the start. */
const LOOP_HOLD_END_MS = 1000;
/** Hover: a beat before it moves, and a pause at the end before the ellipsis. */
const HOVER_HOLD_START_MS = 300;
const HOVER_HOLD_END_MS = 1000;
/** A width change smaller than this is a neighbour's reading, not new room. */
const RESIZE_THRESHOLD_PX = 16;

function matches(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

const prefersReducedMotion = () => matches("(prefers-reduced-motion: reduce)");
/** A touch screen, whatever its width: a narrow desktop window still hovers. */
const isTouch = () => matches("(hover: none), (pointer: coarse)");

/** Whether the text overflows its box as laid out in the fit mode. */
function overflows(box: HTMLElement, lines: 1 | 2): boolean {
  return lines === 1
    ? box.scrollWidth > box.clientWidth + 1
    : box.scrollHeight > box.clientHeight + 1;
}

/**
 * Scroll `inner` across `box` by the overflow: a hold, the travel at
 * SPEED_PX_S, a hold at the end. Null when there is nothing to scroll or no
 * Web Animations API.
 */
function scrollAnimation(
  box: HTMLElement,
  inner: HTMLElement,
  holdStartMs: number,
  holdEndMs: number,
  iterations: number,
): Animation | null {
  if (typeof inner.animate !== "function") return null;
  const distance = inner.offsetWidth - box.clientWidth;
  if (distance <= 0) return null;
  const travel = (distance / SPEED_PX_S) * 1000;
  const total = holdStartMs + travel + holdEndMs;
  return inner.animate(
    [
      { transform: "translateX(0)", offset: 0 },
      { transform: "translateX(0)", offset: holdStartMs / total },
      { transform: `translateX(-${distance}px)`, offset: (holdStartMs + travel) / total },
      { transform: `translateX(-${distance}px)`, offset: 1 },
    ],
    { duration: total, easing: "linear", iterations },
  );
}

/**
 * How a name shows (#1163):
 * - "fit": whole on one line, or wrapped onto `lines` lines; also the state of
 *   any name under `prefers-reduced-motion: reduce`, clamped with an ellipsis;
 * - "loop" (touch screens, a name that still overflows): one line that scrolls
 *   in a loop, at rest at its start for a moment each time, then jumping back;
 * - "ellipsis" (pointer devices, a name that still overflows): one line ending
 *   in « … », which scrolls once while the row is hovered or its link focused.
 */
type Mode = "fit" | "loop" | "ellipsis";

/**
 * A name never cut without a way to read it all (#1163). It shows whole on one
 * line, else wraps onto `lines` lines. Only a name that still overflows moves:
 * on a touch screen it scrolls in a loop, paused while off screen or while the
 * tab is hidden; with a pointer it ends in « … » and scrolls when the row is
 * hovered or its link focused. Under reduced motion it never moves.
 *
 * The text is in the DOM once, so it is read once and stays the accessible
 * name of what wraps it (a link, a button). The decision is taken again on a
 * real width change, once the web font has loaded, and for a new text.
 */
export function MarqueeName({
  text,
  lines = 1,
  className = "",
}: {
  text: string;
  /** Lines the name may take before it scrolls: 1 or 2. */
  lines?: 1 | 2;
  className?: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<Mode>("fit");
  // Pointer devices: the single scroll a hover or a focus asks for.
  const [hovering, setHovering] = useState(false);
  // Bumped to decide again from the fit layout (a new width, the web font).
  const [measure, setMeasure] = useState(0);

  // Decide before paint, from the fit layout, so the row never shows a frame
  // of the other mode. A new text starts over from the fit layout.
  const [measuredText, setMeasuredText] = useState(text);
  if (measuredText !== text) {
    setMeasuredText(text);
    setMode("fit");
    setHovering(false);
  }
  useLayoutEffect(() => {
    if (mode !== "fit") return;
    const box = boxRef.current;
    if (!box || prefersReducedMotion()) return;
    if (overflows(box, lines)) setMode(isTouch() ? "loop" : "ellipsis");
  }, [mode, text, lines, measure]);

  // Decide again, both ways, when the room changes for real (a rotation, a
  // sidebar: not a reading next door going from 9,9° to 10,1°), and once the
  // web font has replaced the fallback it was first measured in.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let alive = true;
    const redecide = () => {
      if (!alive) return;
      setMode("fit");
      setHovering(false);
      setMeasure((m) => m + 1);
    };
    if (typeof document !== "undefined" && document.fonts && document.fonts.status !== "loaded") {
      void document.fonts.ready.then(redecide);
    }
    if (typeof ResizeObserver === "undefined") {
      return () => {
        alive = false;
      };
    }
    let width: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = box.clientWidth;
      if (width !== null && Math.abs(w - width) >= RESIZE_THRESHOLD_PX) redecide();
      if (width === null || Math.abs(w - width) >= RESIZE_THRESHOLD_PX) width = w;
    });
    ro.observe(box);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, []);

  // Touch: the loop, running only while the row is on screen and the tab shown.
  useEffect(() => {
    if (mode !== "loop") return;
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const animation = scrollAnimation(box, inner, LOOP_HOLD_START_MS, LOOP_HOLD_END_MS, Infinity);
    if (!animation) return;
    let onScreen = true;
    const sync = () => {
      if (onScreen && document.visibilityState !== "hidden") animation.play();
      else animation.pause();
    };
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
            sync();
          });
    io?.observe(box);
    document.addEventListener("visibilitychange", sync);
    return () => {
      animation.cancel();
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [mode]);

  // Pointer: hovering the row (the stretched link covers it) or focusing the
  // link starts one scroll; leaving or blurring ends it.
  useEffect(() => {
    if (mode !== "ellipsis") return;
    const box = boxRef.current;
    if (!box) return;
    const target: HTMLElement = box.closest<HTMLElement>("a, button") ?? box;
    const start = () => setHovering(true);
    const stop = () => setHovering(false);
    target.addEventListener("mouseenter", start);
    target.addEventListener("mouseleave", stop);
    target.addEventListener("focusin", start);
    target.addEventListener("focusout", stop);
    return () => {
      target.removeEventListener("mouseenter", start);
      target.removeEventListener("mouseleave", stop);
      target.removeEventListener("focusin", start);
      target.removeEventListener("focusout", stop);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "ellipsis" || !hovering) return;
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const animation = scrollAnimation(box, inner, HOVER_HOLD_START_MS, HOVER_HOLD_END_MS, 1);
    if (!animation) return;
    // At the end, back to the ellipsis until the next hover.
    animation.onfinish = () => setHovering(false);
    return () => animation.cancel();
  }, [mode, hovering]);

  const moving = mode === "loop" || (mode === "ellipsis" && hovering);
  const shape = moving
    ? "block overflow-hidden whitespace-nowrap"
    : mode === "ellipsis" || lines === 1
      ? "block truncate"
      : // `line-clamp-2` brings its own display.
        "line-clamp-2 break-words text-balance";
  return (
    <span
      ref={boxRef}
      data-marquee={mode === "ellipsis" && hovering ? "hover" : mode}
      className={`min-w-0 ${shape} ${className}`}
    >
      <span ref={textRef} className={moving ? "inline-block" : undefined}>
        {text}
      </span>
    </span>
  );
}
