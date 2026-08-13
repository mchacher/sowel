import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, Timer } from "lucide-react";
import type { RecipeInfo, RecipeInstance, RecipeActionDef, EquipmentWithDetails, RecipeSlotDef } from "../../types";
import { recipeSlotName, recipeSlotOptionLabel } from "../../lib/recipe-i18n";
import { equipmentCandidates } from "../../lib/recipe-slots";
import { equipmentLabelMap, type ZoneOption } from "../../lib/zone-path";
import { durationToMinutes } from "./recipe-slot-helpers";

/**
 * `<option>` list of an equipment dropdown (spec 139). Integrations name every
 * sensor alike ("Température"), so a bare name does not say which room it is
 * in; the zone is appended only to the names that actually repeat in this
 * list, since a compact dropdown truncates whatever it cannot fit.
 */
export function EquipmentOptions({
  equipments,
  zoneChains,
}: {
  equipments: EquipmentWithDetails[];
  zoneChains: Map<string, string[]>;
}) {
  const labels = equipmentLabelMap(equipments, zoneChains);
  return (
    <>
      {equipments.map((eq) => (
        <option key={eq.id} value={eq.id}>
          {labels.get(eq.id) ?? eq.name}
        </option>
      ))}
    </>
  );
}


/** Multi-select renderer for a `select` slot with `list: true`: one toggle chip
 *  per option. Stores the selected option values as a comma-joined string, the
 *  same convention used by equipment-list slots (e.g. "mon,tue,thu,fri"). An
 *  empty value means "nothing selected" — recipes read that as their default. */
export function MultiSelectChips({
  slot,
  value,
  onChange,
  recipe,
  lang,
}: {
  slot: RecipeSlotDef;
  value: string;
  onChange: (value: string) => void;
  recipe: RecipeInfo;
  lang: string;
}) {
  const selected = value.split(",").filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {(slot.options ?? []).map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const next = on
                ? selected.filter((v) => v !== o.value)
                : [...selected, o.value];
              onChange(next.join(","));
            }}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-[6px] border transition-colors duration-150 ${
              on
                ? "bg-primary border-primary text-white"
                : "bg-surface border-border text-text-secondary hover:border-primary"
            }`}
          >
            {recipeSlotOptionLabel(recipe, slot, o.value, lang)}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Mode cycle pill (for recipe actions with type "cycle")
// ============================================================

const MODE_PILL_COLORS: Record<string, { bg: string; text: string }> = {
  eco: { bg: "var(--color-success-light, #dcfce7)", text: "var(--color-success, #16a34a)" },
  comfort: { bg: "var(--color-primary-light)", text: "var(--color-primary)" },
  cocoon: { bg: "var(--color-accent-light)", text: "var(--color-accent)" },
  night: { bg: "#ede9fe", text: "#7c3aed" },
};
const DEFAULT_PILL = { bg: "var(--color-border-light)", text: "var(--color-text-secondary)" };

export function ModeCyclePill({
  instance,
  recipe,
  action,
  lang,
  sendAction,
}: {
  instance: RecipeInstance;
  recipe: RecipeInfo;
  action: RecipeActionDef;
  lang: string;
  sendAction: (instanceId: string, action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);

  const currentValue = instance.state?.[action.stateKey] as string | undefined;
  if (!currentValue || !instance.enabled) return null;

  // Filter options: hide cocoon/night if their temp is not configured
  const availableOptions = action.options.filter((opt) => {
    if (opt.value === "cocoon" && !instance.params.cocoonTemp) return false;
    if (opt.value === "night" && !instance.params.nightTemp) return false;
    return true;
  });
  if (availableOptions.length < 2) return null;

  const currentIndex = availableOptions.findIndex((o) => o.value === currentValue);
  const nextIndex = (currentIndex + 1) % availableOptions.length;
  const nextOption = availableOptions[nextIndex];
  const currentOption = availableOptions[currentIndex >= 0 ? currentIndex : 0];

  const colors = MODE_PILL_COLORS[currentValue] ?? DEFAULT_PILL;

  // Resolve label with i18n
  const i18nPack = lang && recipe.i18n?.[lang];
  const displayLabel = i18nPack
    ? t(`recipes.actions.${action.id}.${currentValue}`, { defaultValue: currentOption.label })
    : currentOption.label;

  const handleClick = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sendAction(instance.id, action.id, { mode: nextOption.value });
    } catch {
      // ignore — state refreshed via WebSocket
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={sending}
      className="inline-flex items-center gap-1 px-2 py-[1.5px] rounded-full text-[10px] leading-tight font-semibold transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default hover:brightness-95 active:scale-95 flex-shrink-0"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      title={t("recipes.actions.cycleTo", { mode: nextOption.label, defaultValue: `Click to switch to ${nextOption.label}` })}
    >
      {displayLabel}
    </button>
  );
}

// ============================================================
// Countdown timer — shows remaining time before auto-off
// ============================================================

export function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => computeRemaining(expiresAt));

  useEffect(() => {
    setRemaining(computeRemaining(expiresAt)); // eslint-disable-line react-hooks/set-state-in-effect -- sync initial remaining before starting interval
    const id = setInterval(() => setRemaining(computeRemaining(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining <= 0) return null;

  return (
    <span className="flex items-center gap-1 text-[11px] font-medium text-accent tabular-nums flex-shrink-0">
      <Timer size={12} strokeWidth={1.5} />
      {formatCountdown(remaining)}
    </span>
  );
}

function computeRemaining(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function formatCountdown(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m${sec > 0 ? String(sec).padStart(2, "0") + "s" : ""}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${String(rm).padStart(2, "0")}`;
}

// ============================================================
// Duration input — numeric field with "min" suffix
// ============================================================

export function DurationInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (durationStr: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  // Convert stored "Xm" to numeric minutes for display
  const minutes = durationToMinutes(value);
  const displayValue = !isNaN(minutes) ? String(minutes) : "";

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        value={displayValue}
        onChange={(e) => {
          const num = e.target.value;
          if (num === "") {
            onChange("");
          } else {
            onChange(`${num}m`);
          }
        }}
        placeholder={placeholder ?? "10"}
        className="flex-1 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
      />
      <span className="text-[12px] text-text-tertiary font-medium">{t("time.min")}</span>
    </div>
  );
}

// ============================================================
// Time input — native time picker for HH:MM
// ============================================================

export function TimeInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (timeStr: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="time"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "08:00"}
      className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
    />
  );
}

// ============================================================
// Single equipment picker with zone-first selection — used for slots
// with constraints.crossZone or includeDescendants
// ============================================================

/**
 * Zone dropdown then equipment dropdown, for a single-equipment slot whose scope
 * is wider than the recipe's own zone (`crossZone` / `includeDescendants`).
 *
 * `equipments` arrives already filtered against the slot's constraints by the
 * caller's `getEquipmentOptions`, so this picker only ever splits that list by
 * zone.
 */
export function SingleEquipmentZonePicker({
  value,
  onChange,
  equipments,
  zones,
}: {
  value: string;
  onChange: (value: string) => void;
  equipments: EquipmentWithDetails[];
  zones: ZoneOption[];
}) {
  const { t } = useTranslation();

  const selectedEq = value ? equipments.find((e) => e.id === value) : undefined;
  const [pickerZoneId, setPickerZoneId] = useState<string>(selectedEq?.zoneId ?? "");

  // Zones that have at least one equipment to offer.
  const zonesWithOptions = useMemo(
    () => zones.filter((z) => equipmentCandidates(equipments, z.id).length > 0),
    [zones, equipments],
  );

  const pickerOptions = useMemo(
    () => equipmentCandidates(equipments, pickerZoneId),
    [pickerZoneId, equipments],
  );

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={pickerZoneId}
        onChange={(e) => {
          const zid = e.target.value;
          setPickerZoneId(zid);
          const candidates = equipmentCandidates(equipments, zid);
          // A zone holding a single candidate has already made the choice —
          // opening a one-entry dropdown would only confirm it.
          if (candidates.length === 1) onChange(candidates[0].id);
          // Otherwise clear the equipment if it no longer belongs to the zone.
          else if (selectedEq && selectedEq.zoneId !== zid) onChange("");
        }}
        className="flex-1 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
      >
        <option value="">Zone…</option>
        {zonesWithOptions.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label}
          </option>
        ))}
      </select>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!pickerZoneId}
        className="flex-1 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text disabled:opacity-40"
      >
        <option value="">{t("common.select")}</option>
        {pickerOptions.map((eq) => (
          <option key={eq.id} value={eq.id}>
            {eq.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================================
// Equipment list picker — zone + equipment + add button
// ============================================================

export function EquipmentListPicker({
  slot,
  value,
  onChange,
  equipments,
  zones,
  recipe,
  lang,
  labelClassName,
}: {
  slot: RecipeSlotDef;
  value: string;
  onChange: (value: string) => void;
  equipments: EquipmentWithDetails[];
  zones: ZoneOption[];
  recipe: RecipeInfo;
  lang: string;
  labelClassName?: string;
}) {
  const { t } = useTranslation();
  const [pickerZoneId, setPickerZoneId] = useState("");

  const selectedIds = useMemo(() => value.split(",").filter(Boolean), [value]);
  const constraint = slot.constraints?.equipmentType;

  // Zones that still have something to offer: matching and not already picked.
  const zonesWithOptions = useMemo(
    () =>
      zones.filter(
        (z) => equipmentCandidates(equipments, z.id, { constraint, excludeIds: selectedIds }).length > 0,
      ),
    [zones, equipments, selectedIds, constraint],
  );

  const pickerOptions = useMemo(
    () => equipmentCandidates(equipments, pickerZoneId, { constraint, excludeIds: selectedIds }),
    [pickerZoneId, equipments, selectedIds, constraint],
  );

  const handleRemove = (eqId: string) => {
    const next = selectedIds.filter((id) => id !== eqId);
    onChange(next.join(","));
  };

  return (
    <div className="mb-1.5">
      <label className={labelClassName ?? "block text-[10px] tracking-wider mb-0.5 text-text-tertiary"}>
        {recipeSlotName(recipe, slot, lang)}
      </label>

      {/* Selected items — zone then equipment, the reading order of the two
          dropdowns underneath, so a chip lines up with the row that made it. */}
      {selectedIds.map((id) => {
        const eq = equipments.find((e) => e.id === id);
        const zone = eq ? zones.find((z) => z.id === eq.zoneId) : null;
        return (
          <div key={id} className="flex items-center gap-2 px-2 py-1 mb-1 text-[13px] bg-surface border border-border rounded-[6px]">
            {zone && <span className="min-w-0 text-[11px] text-text-tertiary truncate">{zone.label}</span>}
            <span className="flex-1 min-w-0 text-text truncate">{eq?.name ?? id}</span>
            <button type="button" onClick={() => handleRemove(id)} className="p-0.5 text-text-tertiary hover:text-error transition-colors">
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}

      {/* Add row: zone + equipment + button */}
      {zonesWithOptions.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select
            value={pickerZoneId}
            onChange={(e) => {
              const zid = e.target.value;
              const candidates = equipmentCandidates(equipments, zid, { constraint, excludeIds: selectedIds });
              // One candidate left in that zone: add it and drop back to the
              // zone dropdown, exactly where picking it by hand would land.
              if (candidates.length === 1) {
                onChange([...selectedIds, candidates[0].id].join(","));
                setPickerZoneId("");
              } else {
                setPickerZoneId(zid);
              }
            }}
            className="flex-1 px-2 py-1 text-[13px] bg-surface border border-border rounded-[6px] text-text"
          >
            <option value="">Zone…</option>
            {zonesWithOptions.map((z) => (
              <option key={z.id} value={z.id}>{z.label}</option>
            ))}
          </select>
          <select
            value=""
            onChange={(e) => {
              const eqId = e.target.value;
              if (eqId) {
                const next = [...selectedIds, eqId];
                onChange(next.join(","));
                const remaining = pickerOptions.filter((eq) => eq.id !== eqId);
                if (remaining.length === 0) setPickerZoneId("");
              }
            }}
            disabled={!pickerZoneId}
            className="flex-1 px-2 py-1 text-[13px] bg-surface border border-border rounded-[6px] text-text disabled:opacity-40"
          >
            <option value="">{t("common.select")}</option>
            {pickerOptions.map((eq) => (
              <option key={eq.id} value={eq.id}>{eq.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}


/**
 * Checkbox list of an equipment-list slot (spec 139). Real markup here, so the
 * zone rides as secondary text instead of being glued into the name — and only
 * for the names that repeat in this list.
 */
export function EquipmentCheckboxList({
  equipments,
  zoneChains,
  value,
  onChange,
}: {
  equipments: EquipmentWithDetails[];
  zoneChains: Map<string, string[]>;
  value: string;
  onChange: (value: string) => void;
}) {
  const labels = equipmentLabelMap(equipments, zoneChains);
  const selected = value.split(",").filter(Boolean);

  return (
    <div className="space-y-1">
      {equipments.map((eq) => {
        const checked = selected.includes(eq.id);
        const label = labels.get(eq.id) ?? eq.name;
        const zone = label === eq.name ? null : label.slice(eq.name.length + 3);
        return (
          <label
            key={eq.id}
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text cursor-pointer hover:bg-border-light/30 transition-colors duration-150"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(
                  (checked ? selected.filter((id) => id !== eq.id) : [...selected, eq.id]).join(","),
                )
              }
              className="accent-primary"
            />
            <span className="truncate">{eq.name}</span>
            {zone && (
              <span className="ml-auto text-[11px] text-text-tertiary truncate">{zone}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
