import { useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { DataBindingWithValue } from "../../types";
import { formatSensorValue } from "../equipments/sensorUtils";

interface BindingsPickerProps {
  bindings: DataBindingWithValue[];
  visibleAliases: string[] | undefined;
  onUpdate: (aliases: string[]) => void;
  onClose: () => void;
  mobile?: boolean;
}

export function BindingsPicker({ bindings, visibleAliases, onUpdate, onClose, mobile }: BindingsPickerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  // All visible when no filter configured
  const allVisible = !visibleAliases || visibleAliases.length === 0;

  // Ordered list: selected bindings in visibleAliases order, then unchecked
  const { checked, unchecked } = useMemo(() => {
    const bindingMap = new Map(bindings.map((b) => [b.alias, b]));
    if (allVisible) {
      return { checked: bindings, unchecked: [] as DataBindingWithValue[] };
    }
    const selected: DataBindingWithValue[] = [];
    for (const alias of visibleAliases!) {
      const b = bindingMap.get(alias);
      if (b) selected.push(b);
    }
    const rest = bindings.filter((b) => !visibleAliases!.includes(b.alias));
    return { checked: selected, unchecked: rest };
  }, [bindings, visibleAliases, allVisible]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleToggle = (alias: string) => {
    if (allVisible) {
      // Switching from "all" to explicit: keep all except this one
      const all = bindings.map((b) => b.alias);
      onUpdate(all.filter((a) => a !== alias));
    } else {
      const current = [...visibleAliases!];
      const idx = current.indexOf(alias);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(alias);
      }
      // If all are selected, clear the filter (back to "show all")
      if (current.length === bindings.length) {
        onUpdate([]);
      } else {
        onUpdate(current);
      }
    }
  };

  const handleMove = (alias: string, direction: -1 | 1) => {
    const current = allVisible
      ? bindings.map((b) => b.alias)
      : [...visibleAliases!];
    const idx = current.indexOf(alias);
    const target = idx + direction;
    if (target < 0 || target >= current.length) return;
    [current[idx], current[target]] = [current[target], current[idx]];
    onUpdate(current);
  };

  const isChecked = (alias: string) => allVisible || visibleAliases!.includes(alias);

  const renderRow = (b: DataBindingWithValue, canReorder: boolean, index: number, total: number) => (
    <div
      key={b.alias}
      className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-border-light"
    >
      <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
        <input
          type="checkbox"
          checked={isChecked(b.alias)}
          onChange={() => handleToggle(b.alias)}
          className="accent-primary w-3.5 h-3.5 flex-shrink-0"
        />
        <span className="text-[12px] text-text flex-1 truncate">{b.alias}</span>
        <span className="text-[11px] text-text-tertiary tabular-nums flex-shrink-0">
          {formatSensorValue(b.value, b.unit, t)}
        </span>
      </label>
      {canReorder && (
        <div className="flex flex-col flex-shrink-0">
          <button
            onClick={() => handleMove(b.alias, -1)}
            disabled={index === 0}
            className="p-0.5 text-text-tertiary hover:text-text disabled:opacity-20 transition-colors"
          >
            <ChevronUp size={12} strokeWidth={2} />
          </button>
          <button
            onClick={() => handleMove(b.alias, 1)}
            disabled={index === total - 1}
            className="p-0.5 text-text-tertiary hover:text-text disabled:opacity-20 transition-colors"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={ref}
      className={`bg-surface border border-border rounded-[10px] shadow-lg p-3 ${
        mobile
          ? "relative z-50 w-[280px] max-h-[60vh] overflow-y-auto"
          : "absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 w-[260px]"
      }`}
    >
      <h3 className="text-[12px] font-medium text-text-secondary mb-2">{t("dashboard.visibleData")}</h3>
      <div className="flex flex-col gap-0.5">
        {checked.map((b, i) => renderRow(b, checked.length > 1, i, checked.length))}
        {unchecked.length > 0 && checked.length > 0 && (
          <div className="border-t border-border-light my-1" />
        )}
        {unchecked.map((b) => renderRow(b, false, 0, 0))}
      </div>
    </div>
  );
}
