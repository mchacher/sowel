import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Flame, Loader2 } from "lucide-react";
import type { PilotWireMode } from "../../lib/heater-contract";
import { heaterModeKey } from "../equipments/heaterMode";

interface HeaterModeMenuProps {
  /** Modes at least one heater of the zone can take (spec 218), contract order. */
  modes: readonly PilotWireMode[];
  /** The mode every heater reports, marked in the menu; null when mixed or unknown. */
  common: PilotWireMode | null;
  loading: boolean;
  disabled: boolean;
  onSelect: (mode: PilotWireMode) => void;
  /** `bar`: the Maison command bar button; `tile`: the zone widget's small square. */
  variant: "bar" | "tile";
}

const MENU_WIDTH = 200;
/** Title row + padding, then one row per mode: enough to decide where the menu fits. */
const MENU_CHROME = 40;
const MENU_ROW = 36;

/**
 * Spec 218 — a flame button opening the modes every heater of a zone can be
 * put in. The menu is portalled: the zone widget card clips its overflow.
 */
export function HeaterModeMenu({
  modes,
  common,
  loading,
  disabled,
  onSelect,
  variant,
}: HeaterModeMenuProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setAnchor(null);
    if (refocus) buttonRef.current?.focus();
  };

  // Keyboard: focus enters the menu on open; arrows move between the modes.
  useLayoutEffect(() => {
    if (anchor) menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAnchor(null);
        buttonRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []),
      ];
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    };
    // The menu is placed once from the button: a resize or scroll closes it.
    const onMove = () => setAnchor(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [anchor]);

  if (modes.length === 0) return null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));
    // Opens upward when it would not fit below (a bottom-row tile, the bar above the tab bar).
    const height = MENU_CHROME + modes.length * MENU_ROW;
    const below = rect.bottom + 4;
    const top =
      below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - 4 - height);
    setAnchor({ top, left });
  };

  const title = t("zones.commands.allHeaters");
  const buttonClass =
    variant === "bar"
      ? "hit-44 inline-flex items-center justify-center gap-0.5 px-2 h-[34px] rounded-sm text-text-secondary hover:bg-heat/8 hover:text-heat"
      : "inline-flex items-center justify-center gap-0.5 px-1.5 h-7 rounded-sm border border-border bg-surface text-text-secondary hover:border-heat/40 hover:text-heat hover:bg-heat/5";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={toggle}
        disabled={disabled}
        className={`${buttonClass} transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          anchor ? "bg-heat/8 text-heat" : ""
        }`}
      >
        {loading ? (
          <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
        ) : (
          <Flame size={variant === "bar" ? 16 : 14} strokeWidth={1.5} />
        )}
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {anchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                close(false);
              }}
            />
            <div
              ref={menuRef}
              role="menu"
              aria-label={title}
              style={{ top: anchor.top, left: anchor.left, width: MENU_WIDTH }}
              className="fixed z-50 bg-surface border border-border rounded-md shadow-lg py-1 text-small"
            >
              <div className="px-3 pt-1 pb-1.5 text-caption text-text-tertiary">{title}</div>
              {modes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    close(true);
                    onSelect(mode);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-text hover:bg-border-light cursor-pointer"
                >
                  <span>{t(heaterModeKey(mode))}</span>
                  {mode === common && (
                    <Check size={14} strokeWidth={1.5} className="text-primary" />
                  )}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
