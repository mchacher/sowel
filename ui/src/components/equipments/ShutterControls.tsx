import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, Square, ChevronDown } from "lucide-react";

interface ShutterControlsProps {
  shutterPosition: number | null;
  hasShutterState: boolean;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

export function ShutterControls({
  shutterPosition,
  hasShutterState,
  onExecuteOrder,
}: ShutterControlsProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

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

  return (
    <div
      className="flex items-center gap-2 flex-shrink-0"
      onClick={(e) => e.preventDefault()}
    >
      {shutterPosition !== null && (
        <span className="text-[13px] text-text-secondary tabular-nums text-right">
          {shutterPosition === 0
            ? t("controls.closed")
            : shutterPosition === 100
              ? t("controls.opened")
              : `${shutterPosition}%`}
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
