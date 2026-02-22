import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Loader2, Layers, Trash2, Pencil,
  ToggleRight, ToggleLeft, MapPin,
  Lightbulb, ArrowUpDown, Power, Clock,
} from "lucide-react";
import { getMode, getActiveCalendar } from "../api";
import { useModes } from "../store/useModes";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useRecipes } from "../store/useRecipes";
import { ModeForm } from "../components/modes/ModeForm";
import type { ModeWithDetails, EquipmentWithDetails, ZoneModeImpactAction, CalendarSlot } from "../types";
import { useWsSubscription } from "../hooks/useWsSubscription";

export function ModeDetailPage() {
  useWsSubscription(["modes"]);
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const updateMode = useModes((s) => s.updateMode);
  const deleteModeAction = useModes((s) => s.deleteMode);
  const activateMode = useModes((s) => s.activateMode);
  const deactivateMode = useModes((s) => s.deactivateMode);
  const modes = useModes((s) => s.modes);
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);
  const instances = useRecipes((s) => s.instances);

  const [mode, setMode] = useState<ModeWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditForm, setShowEditForm] = useState(false);
  const [calendarSlots, setCalendarSlots] = useState<CalendarSlot[]>([]);

  const fetchMode = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await getMode(id);
      setMode(data);
    } catch {
      setMode(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchMode();
    fetchEquipments();
    fetchZones();
    getActiveCalendar()
      .then(({ slots }) => setCalendarSlots(slots))
      .catch(() => setCalendarSlots([]));
  }, [fetchMode, fetchEquipments, fetchZones, modes]);

  const handleDelete = async () => {
    if (!mode || !confirm(t("modes.deleteConfirm", { name: mode.name }))) return;
    await deleteModeAction(mode.id);
    navigate("/modes");
  };

  const handleToggle = async () => {
    if (!mode) return;
    if (mode.active) {
      await deactivateMode(mode.id);
    } else {
      await activateMode(mode.id);
    }
    await fetchMode();
  };

  const handleEdit = async (data: { name: string; description?: string }) => {
    if (!mode) return;
    await updateMode(mode.id, data);
    await fetchMode();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (!mode) {
    return (
      <div className="p-6">
        <Link
          to="/modes"
          className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text transition-colors mb-4"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          {t("modes.backToModes")}
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h3 className="text-[16px] font-medium text-text mb-1">{t("modes.notFound")}</h3>
        </div>
      </div>
    );
  }

  // Find zone names for impacts
  const findZoneName = (zoneId: string): string => {
    const find = (zones: typeof tree): string | null => {
      for (const z of zones) {
        if (z.id === zoneId) return z.name;
        const found = find(z.children);
        if (found) return found;
      }
      return null;
    };
    return find(tree) ?? zoneId;
  };

  return (
    <div className="p-6">
      {/* Back link */}
      <Link
        to="/modes"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text transition-colors mb-4"
      >
        <ArrowLeft size={14} strokeWidth={1.5} />
        {t("modes.backToModes")}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-[10px] flex items-center justify-center ${
              mode.active ? "bg-primary/10" : "bg-border-light"
            }`}
          >
            {mode.active ? (
              <ToggleRight size={24} strokeWidth={1.5} className="text-primary" />
            ) : (
              <ToggleLeft size={24} strokeWidth={1.5} className="text-text-tertiary" />
            )}
          </div>
          <div>
            <h1 className="text-[24px] font-semibold text-text leading-[32px]">
              {mode.name}
            </h1>
            {mode.description && (
              <p className="text-[13px] text-text-secondary mt-0.5">{mode.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggle}
            className="relative w-10 h-[22px] rounded-full transition-colors duration-200 flex-shrink-0 cursor-pointer"
            style={{ backgroundColor: mode.active ? "var(--color-primary)" : "var(--color-border)" }}
            title={mode.active ? t("modes.deactivate") : t("modes.activate")}
            role="switch"
            aria-checked={mode.active}
          >
            <span
              className="absolute top-[3px] left-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200"
              style={{ transform: mode.active ? "translateX(18px)" : "translateX(0)" }}
            />
          </button>
          <button
            onClick={() => setShowEditForm(true)}
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
          >
            <Pencil size={14} strokeWidth={1.5} />
            {t("common.edit")}
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-error border border-error/30 rounded-[6px] hover:bg-error/10 transition-colors duration-150"
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {t("common.delete")}
          </button>
        </div>
      </div>

      <div className="space-y-6 max-w-[720px]">
        {/* Calendar schedule section */}
        <CalendarScheduleSection
          modeId={mode.id}
          slots={calendarSlots}
          t={t}
        />

        {/* Zone impacts section */}
        <section className="bg-surface rounded-[10px] border border-border p-5">
          <h2 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-4">
            <MapPin size={16} strokeWidth={1.5} className="text-primary" />
            {t("modes.impacts")}
          </h2>

          {mode.impacts.length === 0 ? (
            <p className="text-[13px] text-text-tertiary">{t("modes.noImpactsGlobal")}</p>
          ) : (
            <div className="space-y-4">
              {mode.impacts.map((impact) => (
                <div key={impact.id}>
                  {/* Zone header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin size={14} strokeWidth={1.5} className="text-text-tertiary" />
                      <span className="text-[13px] font-medium text-text">
                        {findZoneName(impact.zoneId)}
                      </span>
                    </div>
                    <Link
                      to={`/home/${impact.zoneId}`}
                      className="text-[11px] text-primary hover:text-primary-hover transition-colors"
                    >
                      {t("modes.configureInBehaviors")}
                    </Link>
                  </div>
                  {/* Actions list */}
                  <div className="space-y-1 pl-6">
                    {impact.actions.map((action, idx) => (
                      <ImpactActionRow
                        key={idx}
                        action={action}
                        equipments={equipments}
                        instances={instances}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Edit modal */}
      {showEditForm && (
        <ModeForm
          title={t("modes.editMode")}
          initial={{ name: mode.name, description: mode.description }}
          onSubmit={handleEdit}
          onClose={() => setShowEditForm(false)}
        />
      )}
    </div>
  );
}

function ImpactActionRow({
  action,
  equipments,
  instances,
  t,
}: {
  action: ZoneModeImpactAction;
  equipments: EquipmentWithDetails[];
  instances: { id: string; recipeId: string; params: Record<string, unknown> }[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (action.type === "order") {
    const eq = equipments.find((e) => e.id === action.equipmentId);
    const name = eq?.name ?? action.equipmentId;

    let icon: React.ReactNode = <Power size={12} strokeWidth={1.5} />;
    let detail = `${action.orderAlias} = ${JSON.stringify(action.value)}`;

    if (eq?.type === "shutter") {
      icon = <ArrowUpDown size={12} strokeWidth={1.5} />;
      if (action.orderAlias === "state" && action.value === "OPEN") {
        detail = t("controls.open");
      } else if (action.orderAlias === "state" && action.value === "CLOSE") {
        detail = t("controls.close");
      } else if (action.orderAlias === "position") {
        detail = `${t("controls.position")} ${action.value}%`;
      }
    } else if (eq?.type?.startsWith("light_")) {
      icon = <Lightbulb size={12} strokeWidth={1.5} />;
      if ((action.orderAlias === "state" && (action.value === "ON" || action.value === "OFF")) ||
          (action.orderAlias === "turn_on" && typeof action.value === "boolean")) {
        const on = action.value === "ON" || action.value === true;
        detail = on ? "ON" : "OFF";
      } else if (action.orderAlias === "brightness") {
        const max = eq.orderBindings.find((o) => o.alias === "brightness")?.max ?? 254;
        detail = `${t("controls.brightness")} ${Math.round((Number(action.value) / max) * 100)}%`;
      }
    } else if (action.orderAlias === "state" && (action.value === "ON" || action.value === "OFF")) {
      detail = action.value as string;
    }

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-[4px] border border-border-light">
        <span className="text-text-tertiary flex-shrink-0">{icon}</span>
        <span className="text-[12px] text-text font-medium">{name}</span>
        <span className="text-[12px] text-text-secondary">→</span>
        <span className="text-[12px] text-text-secondary">{detail}</span>
      </div>
    );
  }

  if (action.type === "recipe_toggle") {
    const inst = instances.find((i) => i.id === action.instanceId);
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-[4px] border border-border-light">
        <span className="text-text-tertiary flex-shrink-0"><Layers size={12} strokeWidth={1.5} /></span>
        <span className="text-[12px] text-text font-medium">{inst?.recipeId ?? action.instanceId}</span>
        <span className="text-[12px] text-text-secondary">→</span>
        <span className={`text-[12px] font-medium ${action.enabled ? "text-success" : "text-text-tertiary"}`}>
          {action.enabled ? t("common.on") : t("common.off")}
        </span>
      </div>
    );
  }

  if (action.type === "recipe_params") {
    const inst = instances.find((i) => i.id === action.instanceId);
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-[4px] border border-border-light">
        <span className="text-text-tertiary flex-shrink-0"><Layers size={12} strokeWidth={1.5} /></span>
        <span className="text-[12px] text-text font-medium">{inst?.recipeId ?? action.instanceId}</span>
        <span className="text-[12px] text-text-secondary">→</span>
        <span className="text-[12px] text-text-secondary font-mono">{JSON.stringify(action.params)}</span>
      </div>
    );
  }

  return null;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function CalendarScheduleSection({
  modeId,
  slots,
  t,
}: {
  modeId: string;
  slots: CalendarSlot[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const modeSlots = slots.filter((s) => s.modeIds.includes(modeId));

  if (modeSlots.length === 0) return null;

  const formatDays = (days: number[]) => {
    if (days.length === 7) return t("calendar.everyday");
    if (
      days.length === 5 &&
      [1, 2, 3, 4, 5].every((d) => days.includes(d))
    )
      return t("calendar.weekdays");
    if (
      days.length === 2 &&
      days.includes(0) &&
      days.includes(6)
    )
      return t("calendar.weekend");
    return days
      .sort((a, b) => a - b)
      .map((d) => t(`calendar.days.${DAY_KEYS[d]}`))
      .join(", ");
  };

  return (
    <section className="bg-surface rounded-[10px] border border-border p-5">
      <h2 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-4">
        <Clock size={16} strokeWidth={1.5} className="text-accent" />
        {t("modes.schedule")}
      </h2>

      <div className="space-y-2">
        {modeSlots.map((slot) => (
          <div
            key={slot.id}
            className="flex items-center gap-3 px-3 py-2 bg-background rounded-[6px] border border-border-light"
          >
            <span className="text-[18px] font-semibold text-text tabular-nums font-mono">
              {slot.time}
            </span>
            <span className="text-[13px] text-text-secondary">
              {formatDays(slot.days)}
            </span>
          </div>
        ))}
      </div>

      <Link
        to="/calendar"
        className="inline-block mt-3 text-[11px] text-primary hover:text-primary-hover transition-colors"
      >
        {t("modes.editSchedule")}
      </Link>
    </section>
  );
}
