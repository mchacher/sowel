import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Scroll speed of a name too long for its room, in px per second. */
const SPEED_PX_S = 30;
/** Still at the start before it moves, and at the end before it comes back. */
const HOLD_START_MS = 1200;
const HOLD_END_MS = 1000;
/** The return to the start, quicker than the read. */
const RETURN_MS = 500;
/** A width change smaller than this is a neighbour's reading, not new room. */
const RESIZE_THRESHOLD_PX = 16;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Whether the text overflows its box as laid out in the fit mode. */
function overflows(box: HTMLElement, lines: 1 | 2): boolean {
  return lines === 1
    ? box.scrollWidth > box.clientWidth + 1
    : box.scrollHeight > box.clientHeight + 1;
}

/**
 * A name that is never cut (#1163). It shows whole on one line, or wraps onto
 * `lines` lines; only when it still overflows does it scroll, slowly and once,
 * then come back to its start and stay there. No ellipsis, except under
 * `prefers-reduced-motion: reduce`, where it keeps the plain clamp.
 *
 * The text is in the DOM once, so it is read once and stays the accessible
 * name of whatever wraps it (a link, a button). Only rows that overflow do any
 * work beyond one measurement; the width is watched so a rotation re-decides.
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
  const [scrolls, setScrolls] = useState(false);
  // Bumped to decide again from the fit layout (a new width, the web font).
  const [measure, setMeasure] = useState(0);
  // The text whose scroll has run to its end: it never runs again.
  const played = useRef<string | null>(null);

  // Decide before paint, from the fit layout, so the row never shows a frame
  // of the other mode. A new text starts over from the fit layout.
  const [measuredText, setMeasuredText] = useState(text);
  if (measuredText !== text) {
    setMeasuredText(text);
    setScrolls(false);
  }
  useLayoutEffect(() => {
    if (scrolls) return;
    const box = boxRef.current;
    if (!box || prefersReducedMotion()) return;
    if (overflows(box, lines)) setScrolls(true);
  }, [scrolls, text, lines, measure]);

  // Decide again, both ways, when the room changes for real (a rotation, a
  // sidebar: not a reading next door going from 9,9° to 10,1°), and once the
  // web font has replaced the fallback it was first measured in.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let alive = true;
    const redecide = () => {
      if (!alive) return;
      setScrolls(false);
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

  // Once per text: hold, travel to the end, hold, return. A run cut short (the
  // room changed under it) may start over; a finished one stays at the start.
  useEffect(() => {
    if (!scrolls || played.current === text) return;
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner || typeof inner.animate !== "function") return;
    const distance = inner.offsetWidth - box.clientWidth;
    if (distance <= 0) return;
    const travel = (distance / SPEED_PX_S) * 1000;
    const total = HOLD_START_MS + travel + HOLD_END_MS + RETURN_MS;
    const at = (ms: number) => ms / total;
    const animation = inner.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: at(HOLD_START_MS) },
        { transform: `translateX(-${distance}px)`, offset: at(HOLD_START_MS + travel) },
        {
          transform: `translateX(-${distance}px)`,
          offset: at(HOLD_START_MS + travel + HOLD_END_MS),
        },
        { transform: "translateX(0)", offset: 1 },
      ],
      { duration: total, easing: "linear" },
    );
    animation.onfinish = () => {
      played.current = text;
    };
    return () => animation.cancel();
  }, [scrolls, text]);

  // `line-clamp-2` brings its own display; `truncate` needs a block box.
  const fit = lines === 2 ? "line-clamp-2 break-words text-balance" : "block truncate";
  return (
    <span
      ref={boxRef}
      data-marquee={scrolls ? "scroll" : "fit"}
      className={`min-w-0 ${scrolls ? "block overflow-hidden whitespace-nowrap" : fit} ${className}`}
    >
      <span ref={textRef} className={scrolls ? "inline-block" : undefined}>
        {text}
      </span>
    </span>
  );
}
