import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Layers, Plus, Loader2, AlertCircle, ToggleRight, ToggleLeft, Clock } from "lucide-react";
import { useModes } from "../store/useModes";
import { getActiveCalendar } from "../api";
import { ModeForm } from "../components/modes/ModeForm";
import type { ModeWithDetails, CalendarSlot } from "../types";
import { useWsSubscription } from "../hooks/useWsSubscription";

export function ModesPage() {
  useWsSubscription(["modes"]);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modes = useModes((s) => s.modes);
  const loading = useModes((s) => s.loading);
  const fetchModes = useModes((s) => s.fetchModes);
  const createMode = useModes((s) => s.createMode);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarSlots, setCalendarSlots] = useState<CalendarSlot[]>([]);

  useEffect(() => {
    fetchModes().catch((err) => {
      setError(err instanceof Error ? err.message : t("modes.loadError"));
    });
    getActiveCalendar()
      .then(({ slots }) => setCalendarSlots(slots))
      .catch(() => setCalendarSlots([]));
  }, [fetchModes]);

  const handleCreate = async (data: { name: string; description?: string; icon?: string }) => {
    const mode = await createMode(data);
    navigate(`/modes/${mode.id}`);
  };

  if (loading && modes.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
            <AlertCircle size={28} strokeWidth={1.5} className="text-error" />
          </div>
          <h3 className="text-[16px] font-medium text-text mb-1">{t("common.error")}</h3>
          <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">{error}</p>
          <button
            onClick={() => { setError(null); fetchModes(); }}
            className="px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("modes.title")}
          </h1>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {t("modes.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150"
          >
            <Plus size={16} strokeWidth={1.5} />
            {t("modes.addMode")}
          </button>
          <span className="text-[13px] font-medium text-primary bg-primary-light px-3 py-1.5 rounded-[6px] tabular-nums">
            {modes.length}
          </span>
        </div>
      </div>

      {/* Content */}
      {modes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-border-light flex items-center justify-center mb-4">
            <Layers size={28} strokeWidth={1.5} className="text-text-tertiary" />
          </div>
          <h3 className="text-[16px] font-medium text-text mb-1">{t("modes.noModes")}</h3>
          <p className="text-[13px] text-text-secondary max-w-[320px]">
            {t("modes.noModesMessage")}
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-w-[720px]">
          {modes.map((mode) => (
            <ModeCard key={mode.id} mode={mode} calendarSlots={calendarSlots} onClick={() => navigate(`/modes/${mode.id}`)} />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showForm && (
        <ModeForm
          title={t("modes.createMode")}
          onSubmit={handleCreate}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function ModeCard({ mode, calendarSlots, onClick }: { mode: ModeWithDetails; calendarSlots: CalendarSlot[]; onClick: () => void }) {
  const { t } = useTranslation();
  const activateMode = useModes((s) => s.activateMode);
  const deactivateMode = useModes((s) => s.deactivateMode);
  const [toggling, setToggling] = useState(false);

  // Count total actions across all zone impacts
  const totalActions = mode.impacts.reduce((sum, imp) => sum + imp.actions.length, 0);
  const triggerCount = mode.eventTriggers.length;

  // Find next scheduled slot for this mode
  const modeSlots = calendarSlots.filter((s) => s.modeIds.includes(mode.id));
  const nextSlot = modeSlots.length > 0 ? modeSlots.sort((a, b) => a.time.localeCompare(b.time))[0] : null;

  // Build summary parts
  const parts: string[] = [];
  if (totalActions > 0) parts.push(t("modes.actionCount", { count: totalActions }));
  if (triggerCount > 0) parts.push(t("modes.triggerCount", { count: triggerCount }));
  const summary = parts.length > 0 ? parts.join(", ") : undefined;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling) return;
    setToggling(true);
    try {
      if (mode.active) {
        await deactivateMode(mode.id);
      } else {
        await activateMode(mode.id);
      }
    } finally {
      setToggling(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3 bg-surface rounded-[10px] border border-border hover:border-primary/30 transition-colors duration-150 text-left cursor-pointer group"
    >
      <div
        className={`w-10 h-10 rounded-[8px] flex items-center justify-center flex-shrink-0 ${
          mode.active ? "bg-primary/10" : "bg-border-light"
        }`}
      >
        {mode.active ? (
          <ToggleRight size={20} strokeWidth={1.5} className="text-primary" />
        ) : (
          <ToggleLeft size={20} strokeWidth={1.5} className="text-text-tertiary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-text truncate">
          {mode.name}
        </div>
        {mode.description && (
          <div className="text-[12px] text-text-secondary truncate">{mode.description}</div>
        )}
        <div className="text-[11px] text-text-tertiary truncate">
          {summary ?? t("modes.noImpacts")}
          {nextSlot && (
            <span className="ml-1.5">
              · <Clock size={10} strokeWidth={1.5} className="inline -mt-0.5" /> {nextSlot.time}
            </span>
          )}
        </div>
      </div>
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
        mode.active
          ? "text-primary bg-primary/10"
          : "text-text-tertiary bg-border-light"
      }`}>
        {mode.active ? t("modes.active") : t("modes.inactive")}
      </span>
      <button
        onClick={handleToggle}
        disabled={toggling}
        className={`text-[11px] font-medium px-2.5 py-1 rounded-[6px] flex-shrink-0 border transition-colors duration-150 disabled:opacity-50 ${
          mode.active
            ? "text-text-secondary border-border hover:bg-border-light"
            : "text-primary border-primary/30 hover:bg-primary/10"
        }`}
      >
        {mode.active ? t("modes.deactivate") : t("modes.activate")}
      </button>
    </div>
  );
}
