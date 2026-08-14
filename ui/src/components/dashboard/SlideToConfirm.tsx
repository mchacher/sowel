import { useRef, useState } from "react";
import { ChevronsRight, Check } from "lucide-react";

const KNOB = 50; // px
const PAD = 4; // px inset around the knob

/**
 * Spec 146 — slide-to-confirm control (issue #320). A deliberate horizontal
 * drag of the knob to the end fires `onConfirm`; releasing before the end snaps
 * back and does nothing, so a stray touch cannot actuate. Pointer events unify
 * mouse and touch; `setPointerCapture` keeps the drag tracking off-element.
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
    return Math.max(0, w - KNOB - PAD * 2);
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
      className={`relative h-[58px] rounded-[12px] border overflow-hidden select-none touch-none ${
        done ? "border-success/40" : "border-border"
      } bg-border-light`}
    >
      {/* progress fill */}
      <div
        className={`absolute inset-y-0 left-0 rounded-[12px] ${done ? "bg-success/20" : "bg-warning/15"}`}
        style={{ width: `${KNOB + x}px`, transition }}
      />
      {/* label */}
      <div
        className={`absolute inset-0 flex items-center justify-center gap-2 text-[13px] font-medium pointer-events-none ${
          done ? "text-success" : "text-text-secondary"
        }`}
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
