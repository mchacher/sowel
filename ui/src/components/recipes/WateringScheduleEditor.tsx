import { useMemo, useCallback } from "react";
import { Plus, X } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface ScheduleSlot {
  time: string;
  durations: Record<string, number>;
}

interface WateringScheduleEditorProps {
  value: string;
  onChange: (value: string) => void;
  valveIds: string[];
  equipments: EquipmentWithDetails[];
}

const DEFAULT_DURATION = 10;

export function WateringScheduleEditor({
  value,
  onChange,
  valveIds,
  equipments,
}: WateringScheduleEditorProps) {
  const slots = useMemo<ScheduleSlot[]>(() => {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore parse errors
    }
    return [];
  }, [value]);

  const emit = useCallback(
    (next: ScheduleSlot[]) => onChange(JSON.stringify(next)),
    [onChange],
  );

  const valveNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of valveIds) {
      const eq = equipments.find((e) => e.id === id);
      map.set(id, eq?.name ?? id.slice(0, 8));
    }
    return map;
  }, [valveIds, equipments]);

  const addSlot = () => {
    const durations: Record<string, number> = {};
    for (const id of valveIds) durations[id] = DEFAULT_DURATION;
    emit([...slots, { time: "06:00", durations }]);
  };

  const removeSlot = (index: number) => {
    emit(slots.filter((_, i) => i !== index));
  };

  const updateTime = (index: number, time: string) => {
    const next = [...slots];
    next[index] = { ...next[index], time };
    emit(next);
  };

  const updateDuration = (index: number, valveId: string, minutes: number) => {
    const next = [...slots];
    next[index] = {
      ...next[index],
      durations: { ...next[index].durations, [valveId]: minutes },
    };
    emit(next);
  };

  if (valveIds.length === 0) {
    return (
      <p className="text-caption text-text-tertiary py-2">
        Sélectionnez d'abord les vannes ci-dessus
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {slots.map((slot, i) => (
        <div
          key={i}
          className="card p-3"
        >
          {/* Header: badge + time + remove */}
          <div className="flex items-center gap-2.5 mb-2.5">
            <span className="text-micro font-semibold text-primary bg-primary-light px-2 py-0.5 rounded-sm">
              {i + 1}
            </span>
            <input
              type="time"
              value={slot.time}
              onChange={(e) => updateTime(i, e.target.value)}
              className="px-2 py-1 text-body font-semibold tabular-nums rounded-sm outline-none focus:border-primary border border-border bg-surface text-text w-[96px]"
            />
            <button
              type="button"
              onClick={() => removeSlot(i)}
              className="ml-auto p-1 rounded-sm text-text-tertiary hover:text-error hover:bg-error/5 transition-colors"
              title="Supprimer"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>

          {/* Per-valve durations */}
          <div className="space-y-1">
            {valveIds.map((valveId) => (
              <div key={valveId} className="flex items-center gap-2">
                <span className="text-caption text-text-secondary flex-1 truncate">
                  {valveNames.get(valveId)}
                </span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={slot.durations[valveId] ?? DEFAULT_DURATION}
                  onChange={(e) =>
                    updateDuration(
                      i,
                      valveId,
                      Math.max(1, Math.min(120, Number(e.target.value) || 1)),
                    )
                  }
                  className="w-[52px] px-1.5 py-1 text-small tabular-nums text-center rounded-sm outline-none focus:border-primary border border-border bg-surface text-text"
                />
                <span className="text-micro text-text-tertiary w-6">min</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add slot */}
      <button
        type="button"
        onClick={addSlot}
        className="flex items-center justify-center gap-1 w-full py-2 text-caption font-medium text-primary bg-primary-light border border-dashed border-primary/30 rounded-sm hover:bg-primary-light/70 transition-colors cursor-pointer"
      >
        <Plus size={14} strokeWidth={1.5} />
        Ajouter un créneau
      </button>
    </div>
  );
}
