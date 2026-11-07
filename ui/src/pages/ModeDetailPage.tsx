import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Loader2, Layers, Trash2, Pencil,
  ToggleRight, ToggleLeft, MapPin,
  Lightbulb, Power, Clock, Zap, DoorClosed,
} from "lucide-react";
import { ShutterClosedIcon } from "../components/icons/ShutterIcons";
import { getMode, getActiveCalendar, getModeTriggers } from "../api";
import { useModes } from "../store/useModes";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useRecipes } from "../store/useRecipes";
import { useAuth } from "../store/useAuth";
import { ModeForm } from "../components/modes/ModeForm";
import { Switch } from "../components/ui/Switch";
import type { ModeWithDetails, EquipmentWithDetails, ZoneModeImpactAction, CalendarSlot, ButtonActionBinding } from "../types";
import { useWsSubscription } from "../hooks/useWsSubscription";
import { flattenZonesWithPath } from "../lib/zone-path";
import { brightnessPercent, brightnessScale } from "../lib/brightness";
import { formatPercent } from "../lib/format";

export function ModeDetailPage() {
  useWsSubscription(["modes"]);
  const { t } = useTranslation();
  const isAdmin = useAuth((s) => s.user?.role === "admin");
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
  const [triggers, setTriggers] = useState<ButtonActionBinding[]>([]);

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
    if (id) {
      getModeTriggers(id)
        .then(setTriggers)
        .catch(() => setTriggers([]));
    }
  }, [fetchMode, fetchEquipments, fetchZones, modes, id]);

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
      <div className="p-4 sm:p-6">
        <Link
          to="/modes"
          className="inline-flex items-center gap-1.5 text-small text-text-secondary hover:text-text transition-colors mb-4"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          {t("modes.backToModes")}
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h3 className="text-lead font-medium text-text mb-1">{t("modes.notFound")}</h3>
        </div>
      </div>
    );
  }

  // Path-aware zone labels for impacts (spec 139)
  const zoneLabels = new Map(flattenZonesWithPath(tree).map((z) => [z.id, z.label]));
  const findZoneName = (zoneId: string): string => zoneLabels.get(zoneId) ?? zoneId;

  return (
    <div className="p-4 sm:p-6">
      {/* Back link */}
      <Link
        to="/modes"
        className="inline-flex items-center gap-1.5 text-small text-text-secondary hover:text-text transition-colors mb-4"
      >
        <ArrowLeft size={14} strokeWidth={1.5} />
        {t("modes.backToModes")}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-4 sm:mb-8 max-w-[720px]">
        <div className="hidden lg:flex items-center gap-3 sm:gap-4 min-w-0">
          <div
            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-[8px] sm:rounded-[10px] flex items-center justify-center flex-shrink-0 ${
              mode.active ? "bg-primary/10" : "bg-border-light"
            }`}
          >
            {mode.active ? (
              <ToggleRight size={20} strokeWidth={1.5} className="text-primary" />
            ) : (
              <ToggleLeft size={20} strokeWidth={1.5} className="text-text-tertiary" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate">
              {mode.name}
            </h1>
            {mode.description && (
              <p className="text-small text-text-secondary mt-0.5 truncate">{mode.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Issue #912 — switching which mode is on is usage, not
              configuration, so the switch renders for every authenticated
              user. Edit and delete below stay behind `isAdmin`. */}
          <Switch
            checked={mode.active}
            onChange={() => void handleToggle()}
            title={mode.active ? t("modes.deactivate") : t("modes.activate")}
            label={mode.name}
          />
          {isAdmin && (
            <>
              <button
                onClick={() => setShowEditForm(true)}
                className="p-2 text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
                title={t("common.edit")}
              >
                <Pencil size={14} strokeWidth={1.5} />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 text-error border border-error/30 rounded-[6px] hover:bg-error/10 transition-colors duration-150"
                title={t("common.delete")}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-6 max-w-[720px]">
        {/* Calendar schedule section */}
        <CalendarScheduleSection
          modeId={mode.id}
          slots={calendarSlots}
          t={t}
        />

        {/* Button triggers section */}
        <ButtonTriggersSection
          modeId={mode.id}
          triggers={triggers}
          equipments={equipments}
          modes={modes}
          findZoneName={findZoneName}
          t={t}
        />

        {/* Zone impacts section */}
        <section className="bg-surface rounded-[10px] border border-border p-3 sm:p-5">
          <h2 className="text-body font-semibold text-text flex items-center gap-2 mb-4">
            <MapPin size={16} strokeWidth={1.5} className="text-primary" />
            {t("modes.impacts")}
          </h2>

          {mode.impacts.length === 0 ? (
            <p className="text-small text-text-tertiary">{t("modes.noImpactsGlobal")}</p>
          ) : (
            <div className="space-y-4">
              {mode.impacts.map((impact) => (
                <div key={impact.id}>
                  {/* Zone header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin size={14} strokeWidth={1.5} className="text-text-tertiary" />
                      <span className="text-small font-medium text-text">
                        {findZoneName(impact.zoneId)}
                      </span>
                    </div>
                    <Link
                      to={`/home/${impact.zoneId}`}
                      className="text-micro text-primary hover:text-primary-hover transition-colors"
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

    if (eq?.type === "shutter" || eq?.type === "door") {
      icon =
        eq.type === "door" ? (
          <DoorClosed size={12} strokeWidth={1.5} />
        ) : (
          <ShutterClosedIcon size={12} strokeWidth={1.5} />
        );
      if (action.orderAlias === "state" && action.value === "OPEN") {
        detail = t("controls.open");
      } else if (action.orderAlias === "state" && action.value === "CLOSE") {
        detail = t("controls.close");
      } else if (action.orderAlias === "position") {
        detail = `${t("controls.position")} ${formatPercent(Number(action.value))}`;
      }
    } else if (eq?.type?.startsWith("light_")) {
      icon = <Lightbulb size={12} strokeWidth={1.5} />;
      if ((action.orderAlias === "state" && (action.value === "ON" || action.value === "OFF")) ||
          (action.orderAlias === "turn_on" && typeof action.value === "boolean")) {
        const on = action.value === "ON" || action.value === true;
        detail = on ? t("controls.on") : t("controls.off");
      } else if (action.orderAlias === "brightness") {
        const scale = brightnessScale(eq.orderBindings.find((o) => o.alias === "brightness"));
        detail = `${t("controls.brightness")} ${formatPercent(brightnessPercent(Number(action.value), scale))}`;
      }
    } else if (action.orderAlias === "state" && (action.value === "ON" || action.value === "OFF")) {
      detail = action.value === "ON" ? t("controls.on") : t("controls.off");
    }

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-[4px] border border-border-light">
        <span className="text-text-tertiary flex-shrink-0">{icon}</span>
        <span className="text-caption text-text font-medium">{name}</span>
        <span className="text-caption text-text-secondary">→</span>
        <span className="text-caption text-text-secondary">{detail}</span>
      </div>
    );
  }

  if (action.type === "recipe_toggle") {
    const inst = instances.find((i) => i.id === action.instanceId);
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-[4px] border border-border-light">
        <span className="text-text-tertiary flex-shrink-0"><Layers size={12} strokeWidth={1.5} /></span>
        <span className="text-caption text-text font-medium">{inst?.recipeId ?? action.instanceId}</span>
        <span className="text-caption text-text-secondary">→</span>
        <span className={`text-caption font-medium ${action.enabled ? "text-success" : "text-text-tertiary"}`}>
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
        <span className="text-caption text-text font-medium">{inst?.recipeId ?? action.instanceId}</span>
        <span className="text-caption text-text-secondary">→</span>
        <span className="text-caption text-text-secondary font-mono">{JSON.stringify(action.params)}</span>
      </div>
    );
  }

  return null;
}

function ButtonTriggersSection({
  modeId,
  triggers,
  equipments,
  modes,
  findZoneName,
  t,
}: {
  modeId: string;
  triggers: ButtonActionBinding[];
  equipments: EquipmentWithDetails[];
  modes: { id: string; name: string }[];
  findZoneName: (zoneId: string) => string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (triggers.length === 0) return null;

  return (
    <section className="bg-surface rounded-[10px] border border-border p-3 sm:p-5">
      <h2 className="text-body font-semibold text-text flex items-center gap-2 mb-4">
        <Zap size={16} strokeWidth={1.5} className="text-text-tertiary" />
        {t("modes.triggers")}
      </h2>

      <div className="space-y-2">
        {triggers.map((binding) => {
          const eq = equipments.find((e) => e.id === binding.equipmentId);
          const eqName = eq?.name ?? binding.equipmentId;
          const zoneName = eq ? findZoneName(eq.zoneId) : null;

          // Resolve action label (single → "Appui simple", etc.)
          const actionKey = `buttonActions.action.${binding.actionValue}`;
          const actionTranslated = t(actionKey);
          const actionLabel = actionTranslated !== actionKey ? actionTranslated : binding.actionValue;

          // Resolve effect label
          let effectLabel = "";
          if (binding.effectType === "mode_activate") {
            effectLabel = t("modes.triggerActivate");
          } else if (binding.effectType === "mode_toggle") {
            const otherModeId =
              (binding.config.modeAId as string) === modeId
                ? (binding.config.modeBId as string)
                : (binding.config.modeAId as string);
            const otherMode = otherModeId ? modes.find((m) => m.id === otherModeId) : null;
            effectLabel = otherMode
              ? t("modes.triggerToggleWith", { name: otherMode.name })
              : t("modes.triggerToggle");
          }

          return (
            <Link
              key={binding.id}
              to={`/equipments/${binding.equipmentId}`}
              className="flex items-center gap-3 px-3 py-2 bg-background rounded-[6px] border border-border-light hover:border-primary/30 transition-colors"
            >
              <Zap size={14} strokeWidth={1.5} className="text-text-tertiary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-small font-medium text-text">
                  {eqName}
                  {zoneName && (
                    <span className="text-text-tertiary font-normal"> · {zoneName}</span>
                  )}
                </div>
                <div className="text-micro text-text-tertiary">
                  {actionLabel}
                  {effectLabel && <span> · {effectLabel}</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
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
  const modeSlots = slots.filter((s) => s.modeActions.some((a) => a.modeId === modeId));

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
    return [...days]
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map((d) => t(`calendar.days.${DAY_KEYS[d]}`))
      .join(", ");
  };

  return (
    <section className="bg-surface rounded-[10px] border border-border p-3 sm:p-5">
      <h2 className="text-body font-semibold text-text flex items-center gap-2 mb-4">
        <Clock size={16} strokeWidth={1.5} className="text-text-tertiary" />
        {t("modes.schedule")}
      </h2>

      <div className="space-y-2">
        {modeSlots.map((slot) => {
          const action = slot.modeActions.find((a) => a.modeId === modeId)?.action;
          return (
            <div
              key={slot.id}
              className="flex items-center gap-3 px-3 py-2 bg-background rounded-[6px] border border-border-light"
            >
              <span className={`text-caption font-medium px-1.5 py-0.5 rounded ${
                action === "on"
                  ? "bg-success/10 text-success"
                  : "bg-error/10 text-error"
              }`}>
                {action === "on" ? t("common.on") : t("common.off")}
              </span>
              <span className="text-display sm:text-value font-semibold text-text leading-[1.1] tracking-tight tabular-nums">
                {slot.time}
              </span>
              <span className="text-small text-text-secondary">
                {formatDays(slot.days)}
              </span>
            </div>
          );
        })}
      </div>

      <Link
        to="/calendar"
        className="inline-block mt-3 text-micro text-primary hover:text-primary-hover transition-colors"
      >
        {t("modes.editSchedule")}
      </Link>
    </section>
  );
}
