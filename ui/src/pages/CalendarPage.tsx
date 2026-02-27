import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Plus, Trash2, Loader2, Clock, X, Check, Pencil, Power, PowerOff } from "lucide-react";
import { useCalendar } from "../store/useCalendar";
import { useModes } from "../store/useModes";
import type { CalendarSlot, CalendarModeAction } from "../types";
import { useWsSubscription } from "../hooks/useWsSubscription";

export function CalendarPage() {
  useWsSubscription(["calendar", "modes"]);
  const { t } = useTranslation();
  const profiles = useCalendar((s) => s.profiles);
  const activeProfileId = useCalendar((s) => s.activeProfileId);
  const slots = useCalendar((s) => s.slots);
  const loading = useCalendar((s) => s.loading);
  const fetchProfiles = useCalendar((s) => s.fetchProfiles);
  const fetchActive = useCalendar((s) => s.fetchActive);
  const setActiveProfile = useCalendar((s) => s.setActiveProfile);
  const fetchSlots = useCalendar((s) => s.fetchSlots);
  const addSlot = useCalendar((s) => s.addSlot);
  const updateSlot = useCalendar((s) => s.updateSlot);
  const deleteSlot = useCalendar((s) => s.deleteSlot);
  const modes = useModes((s) => s.modes);
  const fetchModes = useModes((s) => s.fetchModes);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  useEffect(() => {
    fetchProfiles();
    fetchActive();
    fetchModes();
  }, [fetchProfiles, fetchActive, fetchModes]);

  // Sync selected profile with active profile
  useEffect(() => {
    if (activeProfileId && !selectedProfileId) {
      setSelectedProfileId(activeProfileId); // eslint-disable-line react-hooks/set-state-in-effect -- sync state from store
    }
  }, [activeProfileId, selectedProfileId]);

  const handleProfileChange = async (profileId: string) => {
    setSelectedProfileId(profileId);
    await fetchSlots(profileId);
  };

  const handleSetActive = async () => {
    if (!selectedProfileId) return;
    await setActiveProfile(selectedProfileId);
  };

  const handleAddSlot = async (data: { days: number[]; time: string; modeActions: CalendarModeAction[] }) => {
    if (!selectedProfileId) return;
    await addSlot(selectedProfileId, data);
    setShowAddSlot(false);
  };

  const handleUpdateSlot = async (slotId: string, data: { days: number[]; time: string; modeActions: CalendarModeAction[] }) => {
    await updateSlot(slotId, data);
    setEditingSlotId(null);
  };

  const handleDeleteSlot = async (slotId: string) => {
    await deleteSlot(slotId);
  };

  // Display Mon→Sun (1,2,3,4,5,6,0) instead of JS convention Sun→Sat (0-6)
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const dayLabels = DAY_ORDER.map((i) => ({ index: i, label: t(`calendar.dayShort.${i}`) }));
  const isActive = selectedProfileId === activeProfileId;

  if (loading && profiles.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold text-text leading-[32px]">
          {t("calendar.title")}
        </h1>
        <p className="text-[13px] text-text-secondary mt-0.5">
          {t("calendar.subtitle")}
        </p>
      </div>

      <div className="max-w-[720px] space-y-6">
        {/* Profile selector */}
        <section className="bg-surface rounded-[10px] border border-border p-5">
          <h2 className="text-[14px] font-semibold text-text mb-4 flex items-center gap-2">
            <Calendar size={16} strokeWidth={1.5} className="text-primary" />
            {t("calendar.profiles")}
          </h2>

          <div className="flex items-center gap-2 mb-4">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => handleProfileChange(profile.id)}
                className={`px-4 py-2 text-[13px] font-medium rounded-[6px] transition-colors duration-150 ${
                  selectedProfileId === profile.id
                    ? "bg-primary text-white"
                    : "bg-border-light text-text-secondary hover:bg-border"
                }`}
              >
                {profile.name}
                {profile.id === activeProfileId && (
                  <span className="ml-1.5 text-[10px] opacity-80">({t("calendar.active")})</span>
                )}
              </button>
            ))}
          </div>

          {selectedProfileId && !isActive && (
            <button
              onClick={handleSetActive}
              className="text-[12px] text-primary hover:text-primary-hover transition-colors"
            >
              {t("calendar.setActive")}
            </button>
          )}
        </section>

        {/* Slots */}
        {selectedProfileId && (
          <section className="bg-surface rounded-[10px] border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold text-text flex items-center gap-2">
                <Clock size={16} strokeWidth={1.5} className="text-accent" />
                {t("calendar.slots")}
              </h2>
              <button
                onClick={() => { setShowAddSlot(!showAddSlot); setEditingSlotId(null); }}
                className="p-1.5 rounded-[4px] text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors duration-150"
              >
                {showAddSlot ? <X size={14} strokeWidth={1.5} /> : <Plus size={14} strokeWidth={1.5} />}
              </button>
            </div>

            {slots.length === 0 && !showAddSlot && (
              <p className="text-[13px] text-text-tertiary">{t("calendar.noSlots")}</p>
            )}

            {slots.length > 0 && (
              <div className="space-y-2 mb-3">
                {slots.map((slot) =>
                  editingSlotId === slot.id ? (
                    <SlotForm
                      key={slot.id}
                      dayLabels={dayLabels}
                      modes={modes}
                      initialValues={slot}
                      submitLabel={t("common.save")}
                      onSubmit={(data) => handleUpdateSlot(slot.id, data)}
                      onCancel={() => setEditingSlotId(null)}
                    />
                  ) : (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      dayLabels={dayLabels}
                      modeNames={modes}
                      onEdit={() => { setEditingSlotId(slot.id); setShowAddSlot(false); }}
                      onDelete={() => handleDeleteSlot(slot.id)}
                    />
                  )
                )}
              </div>
            )}

            {showAddSlot && (
              <SlotForm
                dayLabels={dayLabels}
                modes={modes}
                submitLabel={t("common.add")}
                onSubmit={handleAddSlot}
                onCancel={() => setShowAddSlot(false)}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  dayLabels,
  modeNames,
  onEdit,
  onDelete,
}: {
  slot: CalendarSlot;
  dayLabels: { index: number; label: string }[];
  modeNames: { id: string; name: string }[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const labelMap = Object.fromEntries(dayLabels.map((d) => [d.index, d.label]));
  // Display days in Mon→Sun order
  const orderedDays = [...slot.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const daysStr = orderedDays.map((d) => labelMap[d]).join(", ");

  const onModes = slot.modeActions
    .filter((a) => a.action === "on")
    .map((a) => modeNames.find((m) => m.id === a.modeId)?.name ?? a.modeId);
  const offModes = slot.modeActions
    .filter((a) => a.action === "off")
    .map((a) => modeNames.find((m) => m.id === a.modeId)?.name ?? a.modeId);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-background rounded-[6px] border border-border">
      <Clock size={14} strokeWidth={1.5} className="text-accent flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text font-mono">{slot.time}</div>
        <div className="text-[11px] text-text-tertiary truncate">
          {daysStr}
          {onModes.length > 0 && (
            <span className="text-success"> &middot; {t("common.on")}: {onModes.join(", ")}</span>
          )}
          {offModes.length > 0 && (
            <span className="text-error"> &middot; {t("common.off")}: {offModes.join(", ")}</span>
          )}
        </div>
      </div>
      <button
        onClick={onEdit}
        className="p-1 text-text-tertiary hover:text-primary transition-colors"
      >
        <Pencil size={12} strokeWidth={1.5} />
      </button>
      <button
        onClick={onDelete}
        className="p-1 text-text-tertiary hover:text-error transition-colors"
      >
        <Trash2 size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** Tri-state for each mode: null = ignored, "on" = activate, "off" = deactivate */
type ModeState = "on" | "off" | null;

function SlotForm({
  dayLabels,
  modes,
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  dayLabels: { index: number; label: string }[];
  modes: { id: string; name: string }[];
  initialValues?: { days: number[]; time: string; modeActions: CalendarModeAction[] };
  submitLabel: string;
  onSubmit: (data: { days: number[]; time: string; modeActions: CalendarModeAction[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [days, setDays] = useState<number[]>(initialValues?.days ?? [1, 2, 3, 4, 5]);
  const [time, setTime] = useState(initialValues?.time ?? "08:00");
  const [saving, setSaving] = useState(false);

  // Build initial mode states from modeActions
  const [modeStates, setModeStates] = useState<Record<string, ModeState>>(() => {
    const states: Record<string, ModeState> = {};
    if (initialValues?.modeActions) {
      for (const { modeId, action } of initialValues.modeActions) {
        states[modeId] = action;
      }
    }
    return states;
  });

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  /** Cycle: null → on → off → null */
  const cycleMode = (modeId: string) => {
    setModeStates((prev) => {
      const current = prev[modeId] ?? null;
      let next: ModeState;
      if (current === null) next = "on";
      else if (current === "on") next = "off";
      else next = null;

      const updated = { ...prev };
      if (next === null) {
        delete updated[modeId];
      } else {
        updated[modeId] = next;
      }
      return updated;
    });
  };

  const buildModeActions = (): CalendarModeAction[] => {
    return Object.entries(modeStates)
      .filter((entry): entry is [string, "on" | "off"] => entry[1] !== null)
      .map(([modeId, action]) => ({ modeId, action }));
  };

  const hasModeActions = Object.values(modeStates).some((s) => s !== null);

  const handleSubmit = async () => {
    if (days.length === 0 || !time || !hasModeActions) return;
    setSaving(true);
    try {
      await onSubmit({ days, time, modeActions: buildModeActions() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-border-light/20 border border-border-light rounded-[6px] p-3 space-y-3">
      {/* Days */}
      <div>
        <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1.5">
          {t("calendar.days")}
        </label>
        <div className="flex gap-1">
          {dayLabels.map((day) => (
            <button
              key={day.index}
              onClick={() => toggleDay(day.index)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-colors duration-150 ${
                days.includes(day.index)
                  ? "bg-primary text-white"
                  : "bg-border-light text-text-tertiary hover:bg-border"
              }`}
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time */}
      <div>
        <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1.5">
          {t("calendar.time")}
        </label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text font-mono"
        />
      </div>

      {/* Modes — tri-state: click cycles null → ON → OFF → null */}
      <div>
        <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1.5">
          {t("modes.title")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {modes.map((mode) => {
            const state = modeStates[mode.id] ?? null;
            return (
              <button
                key={mode.id}
                onClick={() => cycleMode(mode.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-colors duration-150 ${
                  state === "on"
                    ? "bg-success text-white"
                    : state === "off"
                      ? "bg-error text-white"
                      : "bg-border-light text-text-tertiary hover:bg-border"
                }`}
              >
                {state === "on" && <Power size={10} />}
                {state === "off" && <PowerOff size={10} />}
                {mode.name}
                {state === "on" && <span className="text-[9px] opacity-80">ON</span>}
                {state === "off" && <span className="text-[9px] opacity-80">OFF</span>}
              </button>
            );
          })}
        </div>
        {modes.length === 0 && (
          <p className="text-[11px] text-text-tertiary">{t("calendar.noModesAvailable")}</p>
        )}
        <p className="text-[10px] text-text-tertiary mt-1">{t("calendar.modeActionHint")}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={days.length === 0 || !time || !hasModeActions || saving}
          className="px-3 py-1.5 bg-primary text-white text-[12px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-border-light text-text-secondary text-[12px] font-medium rounded-[6px] hover:bg-border transition-colors duration-150"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
