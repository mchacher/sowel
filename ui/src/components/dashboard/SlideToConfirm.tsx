import { useRef, useState } from "react";
import { ChevronsRight, Check } from "lucide-react";

const KNOB = 50; // px
const PAD = 4; // px inset around the knob
/** Space the knob occupies at either end, label areas have to clear it. */
const KNOB_SPAN = KNOB + PAD * 2; // px

/**
 * Spec 146 — slide-to-confirm control (issue #320). A deliberate horizontal
 * drag of the knob to the end fires `onConfirm`; releasing before the end snaps
 * back and does nothing, so a stray touch cannot actuate. Pointer events unify
 * mouse and touch; `setPointerCapture` keeps the drag tracking off-element.
 *
 * The track is capped rather than filling its parent (#858). Full width, on a
 * 393 px phone, meant a 295 px sweep starting in the bottom-left corner — the
 * point farthest from the thumb of the hand holding the phone, on a control
 * whose entire purpose is to be used one-handed in front of a gate. Capped at
 * 260 px and centred, the knob starts at x=72 instead of x=20 and the sweep is
 * 202 px, tuned by hand on a phone rather than picked from a round number.
 *
 * `maxOffset()` reads the rendered width, so the threshold, the progress fill
 * and the knob all follow the cap without knowing about it.
 */
export function SlideToConfirm({
  label,
  confirmedLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmedLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; max: number } | null>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  const maxOffset = () => {
    const w = trackRef.current?.clientWidth ?? 0;
    return Math.max(0, w - KNOB_SPAN);
  };

  const finish = () => {
    if (done) return;
    setDone(true);
    setDragging(false);
    dragRef.current = null;
    setX(maxOffset());
    onConfirm();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (done || disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX - x, max: maxOffset() };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const nx = Math.max(0, Math.min(drag.max, e.clientX - drag.startX));
    setX(nx);
    // Guard drag.max > 0 so a degenerate (too-narrow) track cannot auto-confirm
    // on the first move.
    if (drag.max > 0 && nx >= drag.max - 1) finish();
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag || done) return;
    dragRef.current = null;
    setDragging(false);
    if (x < drag.max - 1) setX(0); // snap back
  };

  const transition = dragging ? "none" : "left .2s, width .2s";

  return (
    <div
      ref={trackRef}
      className={`relative mx-auto w-full max-w-[260px] h-[58px] rounded-[12px] border overflow-hidden select-none touch-none ${
        done ? "border-success/40" : "border-border"
      } bg-border-light`}
    >
      {/* progress fill */}
      <div
        className={`absolute inset-y-0 left-0 rounded-[12px] ${done ? "bg-success/20" : "bg-warning/15"}`}
        style={{ width: `${KNOB + x}px`, transition }}
      />
      {/* Label, in whichever half the knob is not occupying: to its right at
          rest, to its left once the slide is done. On a capped track a label
          centred across the whole width would start under the knob. */}
      <div
        className={`absolute inset-y-0 flex items-center justify-center gap-2 px-2 text-[13px] font-medium whitespace-nowrap pointer-events-none ${
          done ? "text-success" : "text-text-secondary"
        }`}
        style={done ? { left: 0, right: `${KNOB_SPAN}px` } : { left: `${KNOB_SPAN}px`, right: 0 }}
      >
        {done ? confirmedLabel : label}
        {!done && <ChevronsRight size={16} strokeWidth={2} className="text-warning" />}
      </div>
      {/* knob */}
      <div
        role="button"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`absolute top-[4px] h-[50px] w-[50px] rounded-[9px] flex items-center justify-center text-white shadow-md z-[2] ${
          done ? "bg-success cursor-default" : "bg-warning cursor-grab active:cursor-grabbing"
        }`}
        style={{ left: `${PAD + x}px`, transition }}
      >
        {done ? (
          <Check size={20} strokeWidth={2.4} />
        ) : (
          <ChevronsRight size={20} strokeWidth={2} />
        )}
      </div>
    </div>
  );
}
