import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { DataBindingWithValue } from "../../types";
import { formatSensorValue } from "../equipments/sensorUtils";

interface BindingsPickerProps {
  bindings: DataBindingWithValue[];
  visibleAliases: string[] | undefined;
  onUpdate: (aliases: string[]) => void;
  onClose: () => void;
}

export function BindingsPicker({ bindings, visibleAliases, onUpdate, onClose }: BindingsPickerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  // All visible when no filter configured
  const allVisible = !visibleAliases || visibleAliases.length === 0;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const isChecked = (alias: string) => allVisible || visibleAliases!.includes(alias);

  const handleToggle = (alias: string) => {
    if (allVisible) {
      // Switching from "all" to explicit: keep all except this one
      const all = bindings.map((b) => b.alias);
      onUpdate(all.filter((a) => a !== alias));
    } else {
      const current = new Set(visibleAliases!);
      if (current.has(alias)) {
        current.delete(alias);
      } else {
        current.add(alias);
      }
      // If all are selected, clear the filter (back to "show all")
      if (current.size === bindings.length) {
        onUpdate([]);
      } else {
        onUpdate([...current]);
      }
    }
  };

  return (
    <div
      ref={ref}
      className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 bg-surface border border-border rounded-[10px] shadow-lg p-3 w-[240px]"
    >
      <h3 className="text-[12px] font-medium text-text-secondary mb-2">{t("dashboard.visibleData")}</h3>
      <div className="flex flex-col gap-1">
        {bindings.map((b) => (
          <label
            key={b.alias}
            className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-border-light cursor-pointer"
          >
            <input
              type="checkbox"
              checked={isChecked(b.alias)}
              onChange={() => handleToggle(b.alias)}
              className="accent-primary w-3.5 h-3.5"
            />
            <span className="text-[12px] text-text flex-1 truncate">{b.alias}</span>
            <span className="text-[11px] text-text-tertiary tabular-nums">
              {formatSensorValue(b.value, b.unit, t)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
