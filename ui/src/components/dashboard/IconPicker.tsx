import { useRef, useEffect, createElement } from "react";
import { useTranslation } from "react-i18next";
import { CUSTOM_ICON_REGISTRY } from "./widget-icons";

interface IconPickerProps {
  currentIcon?: string;
  /** Equipment type or widget family — used to filter relevant custom icons */
  equipmentType?: string;
  onSelect: (iconName: string) => void;
  onClose: () => void;
  mobile?: boolean;
}

export function IconPicker({ currentIcon, equipmentType, onSelect, onClose, mobile }: IconPickerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Filter custom icons relevant to this equipment type
  const relevantIcons = Object.entries(CUSTOM_ICON_REGISTRY).filter(
    ([, entry]) => !equipmentType || entry.types.includes(equipmentType),
  );

  // Also show all icons if no type filter
  const otherIcons = Object.entries(CUSTOM_ICON_REGISTRY).filter(
    ([, entry]) => equipmentType && !entry.types.includes(equipmentType),
  );

  return (
    <div
      ref={ref}
      className={`bg-surface border border-border rounded-[10px] shadow-lg p-3 ${
        mobile
          ? "relative z-50 w-[300px] max-h-[60vh] overflow-y-auto"
          : "absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 w-[280px]"
      }`}
    >
      <h3 className="text-[12px] font-medium text-text-secondary mb-2">{t("dashboard.chooseIcon")}</h3>

      {/* Relevant custom icons */}
      {relevantIcons.length > 0 && (
        <div className="mb-2">
          <div className="flex flex-wrap gap-1">
            {relevantIcons.map(([key, entry]) => (
              <button
                key={key}
                onClick={() => {
                  onSelect(key);
                  onClose();
                }}
                title={entry.label}
                className={`w-12 h-12 flex items-center justify-center rounded-[6px] transition-colors cursor-pointer ${
                  currentIcon === key
                    ? "bg-primary-light ring-2 ring-primary/30"
                    : "hover:bg-border-light"
                }`}
              >
                <div className="scale-[0.45] origin-center">
                  {createElement(entry.component, entry.previewProps)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Other custom icons */}
      {otherIcons.length > 0 && (
        <div className="mb-1">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
            {t("dashboard.otherIcons")}
          </p>
          <div className="flex flex-wrap gap-1">
            {otherIcons.map(([key, entry]) => (
              <button
                key={key}
                onClick={() => {
                  onSelect(key);
                  onClose();
                }}
                title={entry.label}
                className={`w-12 h-12 flex items-center justify-center rounded-[6px] transition-colors cursor-pointer ${
                  currentIcon === key
                    ? "bg-primary-light ring-2 ring-primary/30"
                    : "hover:bg-border-light"
                }`}
              >
                <div className="scale-[0.45] origin-center">
                  {createElement(entry.component, entry.previewProps)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
