import {
  Lightbulb,
  LightbulbOff,
  ChevronUp,
  ChevronDown,
  Square,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

export type ZoneOrder =
  | "allLightsOn"
  | "allLightsOff"
  | "allShuttersOpen"
  | "allShuttersStop"
  | "allShuttersClose";

type Category = "light" | "light-off" | "shutter";

interface ZoneCommandsProps {
  hasLights: boolean;
  hasShutters: boolean;
  /** False if at least one shutter in the zone can't really stop
   *  mid-travel (e.g. a Bubendorff shutter) — hides the bulk Stop
   *  button entirely rather than letting it silently fail for that
   *  one shutter while working for the rest. Defaults to true. */
  hasStoppableShutters?: boolean;
  loading: ZoneOrder | null;
  onCommand: (order: ZoneOrder) => void;
}

const CATEGORY_HOVER: Record<Category, string> = {
  light: "hover:bg-active/8 hover:text-active-ink",
  "light-off": "hover:bg-border-light hover:text-text",
  shutter: "hover:bg-primary/8 hover:text-primary",
};

interface ZCmdsBtnProps {
  cat: Category;
  title: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ZCmdsBtn({ cat, title, loading, disabled, onClick, children }: ZCmdsBtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`hit-44 inline-flex items-center justify-center w-9 h-[34px] rounded-sm text-text-secondary transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${CATEGORY_HOVER[cat]}`}
    >
      {loading ? (
        <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
      ) : (
        children
      )}
    </button>
  );
}

export function ZoneCommands({
  hasLights,
  hasShutters,
  hasStoppableShutters = true,
  loading,
  onCommand,
}: ZoneCommandsProps) {
  const { t } = useTranslation();
  const busy = loading !== null;

  if (!hasLights && !hasShutters) return null;

  return (
    <div
      role="toolbar"
      aria-label={t("zones.commands.toolbarLabel", { defaultValue: "Commandes globales" })}
      className="hit-group inline-flex items-center gap-px bg-surface rounded-sm px-1.5 py-1 shadow-lg"
    >
      {hasLights && (
        <>
          <ZCmdsBtn
            cat="light"
            title={t("zones.commands.allLightsOn")}
            loading={loading === "allLightsOn"}
            disabled={busy}
            onClick={() => onCommand("allLightsOn")}
          >
            <Lightbulb size={16} strokeWidth={1.5} />
          </ZCmdsBtn>
          <ZCmdsBtn
            cat="light-off"
            title={t("zones.commands.allLightsOff")}
            loading={loading === "allLightsOff"}
            disabled={busy}
            onClick={() => onCommand("allLightsOff")}
          >
            <LightbulbOff size={16} strokeWidth={1.5} />
          </ZCmdsBtn>
        </>
      )}

      {hasLights && hasShutters && (
        <span className="w-px h-4 bg-border mx-1 flex-shrink-0" aria-hidden="true" />
      )}

      {hasShutters && (
        <>
          <ZCmdsBtn
            cat="shutter"
            title={t("zones.commands.allShuttersOpen")}
            loading={loading === "allShuttersOpen"}
            disabled={busy}
            onClick={() => onCommand("allShuttersOpen")}
          >
            <ChevronUp size={16} strokeWidth={2} />
          </ZCmdsBtn>
          {hasStoppableShutters && (
            <ZCmdsBtn
              cat="shutter"
              title={t("zones.commands.allShuttersStop", { defaultValue: "Stop" })}
              loading={loading === "allShuttersStop"}
              disabled={busy}
              onClick={() => onCommand("allShuttersStop")}
            >
              <Square size={14} strokeWidth={1.5} fill="currentColor" />
            </ZCmdsBtn>
          )}
          <ZCmdsBtn
            cat="shutter"
            title={t("zones.commands.allShuttersClose")}
            loading={loading === "allShuttersClose"}
            disabled={busy}
            onClick={() => onCommand("allShuttersClose")}
          >
            <ChevronDown size={16} strokeWidth={2} />
          </ZCmdsBtn>
        </>
      )}
    </div>
  );
}
