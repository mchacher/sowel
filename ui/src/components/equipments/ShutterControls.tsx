import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, Square, ChevronDown } from "lucide-react";

const SETTLE_DELAY_MS = 2000;

interface ShutterControlsProps {
  shutterPosition: number | null;
  hasShutterState: boolean;
  hasPositionOrder: boolean;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

export function ShutterControls({
  shutterPosition,
  hasShutterState,
  hasPositionOrder,
  onExecuteOrder,
}: ShutterControlsProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const localPosition = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useState(0);

  const displayPosition =
    localPosition.current !== null ? localPosition.current : shutterPosition;

  const handleCommand = async (
    command: "OPEN" | "STOP" | "CLOSE",
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (executing || !hasShutterState) return;
    setExecuting(true);
    try {
      await onExecuteOrder("state", command);
    } finally {
      setExecuting(false);
    }
  };

  const handlePositionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    localPosition.current = Number(e.target.value);
    forceRender((n) => n + 1);
  };

  const handlePositionCommit = async () => {
    const commitValue = localPosition.current;
    if (!hasPositionOrder || commitValue === null) return;
    try {
      await onExecuteOrder("position", commitValue);
    } catch {
      // Ignore
    }
    settleTimer.current = setTimeout(() => {
      localPosition.current = null;
      settleTimer.current = null;
      forceRender((n) => n + 1);
    }, SETTLE_DELAY_MS);
  };

  return (
    <div
      className="flex items-center gap-2 flex-shrink-0"
      onClick={(e) => e.preventDefault()}
    >
      {hasPositionOrder && displayPosition !== null && (
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={0}
            max={100}
            value={displayPosition}
            onChange={handlePositionChange}
            onMouseUp={handlePositionCommit}
            onTouchEnd={handlePositionCommit}
            onClick={(e) => e.stopPropagation()}
            className="w-[60px] accent-primary h-1"
          />
          <span className="text-[11px] text-text-tertiary w-8 text-right tabular-nums">
            {displayPosition}%
          </span>
        </div>
      )}
      {!hasPositionOrder && displayPosition !== null && (
        <span className="text-[13px] text-text-secondary tabular-nums text-right">
          {displayPosition === 0
            ? t("controls.closed")
            : displayPosition === 100
              ? t("controls.opened")
              : `${displayPosition}%`}
        </span>
      )}
      {hasShutterState && (
        <>
          <div className="w-px h-5 bg-border" />
          <button
            onClick={(e) => handleCommand("OPEN", e)}
            disabled={executing}
            className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("controls.open")}
          >
            <ChevronUp size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={(e) => handleCommand("STOP", e)}
            disabled={executing}
            className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("controls.stop")}
          >
            <Square size={10} strokeWidth={2} />
          </button>
          <button
            onClick={(e) => handleCommand("CLOSE", e)}
            disabled={executing}
            className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("controls.close")}
          >
            <ChevronDown size={14} strokeWidth={1.5} />
          </button>
        </>
      )}
    </div>
  );
}
