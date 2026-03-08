import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ICON_MAP, ICON_CATEGORIES } from "./widget-icons";

interface IconPickerProps {
  currentIcon?: string;
  onSelect: (iconName: string) => void;
  onClose: () => void;
}

export function IconPicker({ currentIcon, onSelect, onClose }: IconPickerProps) {
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

  return (
    <div
      ref={ref}
      className="absolute z-20 top-full left-0 mt-1 bg-surface border border-border rounded-[10px] shadow-lg p-3 w-[280px]"
    >
      <h3 className="text-[12px] font-medium text-text-secondary mb-2">{t("dashboard.chooseIcon")}</h3>
      {ICON_CATEGORIES.map((cat) => (
        <div key={cat.label} className="mb-2">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
            {cat.label}
          </p>
          <div className="flex flex-wrap gap-1">
            {cat.icons.map((name) => {
              const Icon = ICON_MAP[name];
              if (!Icon) return null;
              return (
                <button
                  key={name}
                  onClick={() => {
                    onSelect(name);
                    onClose();
                  }}
                  title={name}
                  className={`w-8 h-8 flex items-center justify-center rounded-[5px] transition-colors cursor-pointer ${
                    currentIcon === name
                      ? "bg-primary-light text-primary"
                      : "text-text-secondary hover:bg-border-light hover:text-text"
                  }`}
                >
                  <Icon size={16} strokeWidth={1.5} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
