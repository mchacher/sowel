import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Plus, Trash2, Loader2, Clock, X, Check } from "lucide-react";
import { useCalendar } from "../store/useCalendar";
import { useModes } from "../store/useModes";
import type { CalendarSlot, CalendarProfile } from "../types";
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
  const deleteSlot = useCalendar((s) => s.deleteSlot);
  const modes = useModes((s) => s.modes);
  const fetchModes = useModes((s) => s.fetchModes);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showAddSlot, setShowAddSlot] = useState(false);

  useEffect(() => {
    fetchProfiles();
    fetchActive();
    fetchModes();
  }, [fetchProfiles, fetchActive, fetchModes]);

  // Sync selected profile with active profile
  useEffect(() => {
    if (activeProfileId && !selectedProfileId) {
      setSelectedProfileId(activeProfileId);
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

  const handleAddSlot = async (data: { days: number[]; time: string; modeIds: string[] }) => {
    if (!selectedProfileId) return;
    await addSlot(selectedProfileId, data);
    setShowAddSlot(false);
  };

  const handleDeleteSlot = async (slotId: string) => {
    await deleteSlot(slotId);
  };

  const dayLabels = Array.from({ length: 7 }, (_, i) => t(`calendar.dayShort.${i}`));
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
                onClick={() => setShowAddSlot(!showAddSlot)}
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
                {slots.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slot={slot}
                    dayLabels={dayLabels}
                    modeNames={modes}
                    onDelete={() => handleDeleteSlot(slot.id)}
                  />
                ))}
              </div>
            )}

            {showAddSlot && (
              <AddSlotForm
                dayLabels={dayLabels}
                modes={modes}
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
  onDelete,
}: {
  slot: CalendarSlot;
  dayLabels: string[];
  modeNames: { id: string; name: string }[];
  onDelete: () => void;
}) {
  const daysStr = slot.days.map((d) => dayLabels[d]).join(", ");
  const modesStr = slot.modeIds
    .map((id) => modeNames.find((m) => m.id === id)?.name ?? id)
    .join(", ");

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-background rounded-[6px] border border-border">
      <Clock size={14} strokeWidth={1.5} className="text-accent flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text font-mono">{slot.time}</div>
        <div className="text-[11px] text-text-tertiary truncate">
          {daysStr} &middot; {modesStr}
        </div>
      </div>
      <button
        onClick={onDelete}
        className="p-1 text-text-tertiary hover:text-error transition-colors"
      >
        <Trash2 size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function AddSlotForm({
  dayLabels,
  modes,
  onSubmit,
  onCancel,
}: {
  dayLabels: string[];
  modes: { id: string; name: string }[];
  onSubmit: (data: { days: number[]; time: string; modeIds: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri by default
  const [time, setTime] = useState("08:00");
  const [modeIds, setModeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const toggleMode = (modeId: string) => {
    setModeIds((prev) =>
      prev.includes(modeId) ? prev.filter((id) => id !== modeId) : [...prev, modeId]
    );
  };

  const handleSubmit = async () => {
    if (days.length === 0 || !time || modeIds.length === 0) return;
    setSaving(true);
    try {
      await onSubmit({ days, time, modeIds });
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
          {dayLabels.map((label, idx) => (
            <button
              key={idx}
              onClick={() => toggleDay(idx)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-colors duration-150 ${
                days.includes(idx)
                  ? "bg-primary text-white"
                  : "bg-border-light text-text-tertiary hover:bg-border"
              }`}
            >
              {label}
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

      {/* Modes */}
      <div>
        <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1.5">
          {t("modes.title")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => toggleMode(mode.id)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-colors duration-150 ${
                modeIds.includes(mode.id)
                  ? "bg-primary text-white"
                  : "bg-border-light text-text-tertiary hover:bg-border"
              }`}
            >
              {mode.name}
              {modeIds.includes(mode.id) && <Check size={10} className="inline ml-1" />}
            </button>
          ))}
        </div>
        {modes.length === 0 && (
          <p className="text-[11px] text-text-tertiary">{t("calendar.noModesAvailable")}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={days.length === 0 || !time || modeIds.length === 0 || saving}
          className="px-3 py-1.5 bg-primary text-white text-[12px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50"
        >
          {t("common.add")}
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
