import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SERIES_COLORS } from "./history-utils";

interface SeriesColorPickerProps {
  /** Current effective colour of the series (`#rrggbb`). */
  color: string;
  onChange: (color: string) => void;
  onClose: () => void;
}

/**
 * Palette + free-hue popover, opened by the colour dot of a series pill
 * (spec 145). Follows `IconPicker`'s pattern: absolutely positioned under its
 * anchor, closed by an outside click or Escape.
 */
export function SeriesColorPicker({ color, onChange, onClose }: SeriesColorPickerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-30 top-full left-0 mt-1 w-[176px] p-2.5
        bg-surface border border-border rounded-[10px] shadow-lg"
    >
      <div className="grid grid-cols-4 gap-1.5">
        {SERIES_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onChange(c);
              onClose();
            }}
            title={c}
            className={`w-7 h-7 rounded-full border border-border transition-transform
              hover:scale-110 cursor-pointer ${
                c.toLowerCase() === color.toLowerCase() ? "ring-2 ring-primary/40" : ""
              }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <label className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border-light cursor-pointer">
        {/* `onChange` rather than `onInput`: the OS picker fires continuously
            while the user drags, and each event would rebuild the chart. */}
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 p-0 border border-border rounded-[6px] bg-surface cursor-pointer"
        />
        <span className="text-[11px] text-text-secondary">{t("analyse.customColor")}</span>
      </label>
    </div>
  );
}
