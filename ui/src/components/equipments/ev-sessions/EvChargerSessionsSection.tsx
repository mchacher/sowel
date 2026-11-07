import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getEvSessions, updateEquipment } from "../../../api";
import { dateLocale } from "../../../lib/locale";
import { useEquipments } from "../../../store/useEquipments";
import { useEvSessions } from "../../../store/useEvSessions";
import type { EvChargeSession } from "../../../types";
import { formatEur } from "../../energy/format";
import { EvMonthNav } from "./EvMonthNav";
import { EvReassignSheet } from "./EvReassignSheet";
import { dayLabel, energyLabel, monthOf, sessionChip, timeLabel } from "./evSessionsDisplay";

/**
 * Spec 191 FR7 — every session of a charger with the vehicle it belongs to.
 * Any row opens the reassignment sheet; every role may use it (P8). Spec 193:
 * an admin names the charger's usual vehicle, which breaks a tie.
 */
export function EvChargerSessionsSection({
  chargerId,
  usualVehicleId,
  isAdmin,
  onUpdated,
}: {
  chargerId: string;
  usualVehicleId: string | undefined;
  isAdmin: boolean;
  onUpdated: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const rev = useEvSessions((s) => s.rev);
  const equipments = useEquipments((s) => s.equipments);

  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [sessions, setSessions] = useState<EvChargeSession[]>([]);
  const [editing, setEditing] = useState<EvChargeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setUsual = async (vehicleId: string) => {
    setSaving(true);
    try {
      await updateEquipment(chargerId, { usualVehicleId: vehicleId === "" ? null : vehicleId });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getEvSessions({ chargerId }, month)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [chargerId, month, rev]);

  const vehicles = useMemo(
    () =>
      equipments
        .filter((e) => e.type === "electric_vehicle")
        .map((e) => ({ id: e.id, name: e.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [equipments],
  );
  const todo = sessions.filter((s) => s.attribution === "unattributed").length;
  const eur = (v: number | null) => (v === null ? "—" : formatEur(v, locale));

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-text">
          {t("equipments.evSessions.sessions")}
        </h3>
        <EvMonthNav month={month} onChange={setMonth} />
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      {todo > 0 && (
        <div className="flex items-center gap-2 bg-accent-light rounded-[8px] px-3 py-2.5 text-small text-text">
          <span className="w-2 h-2 rounded-full bg-accent-hover shrink-0" />
          {t("equipments.evSessions.todoBanner", { count: todo })}
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-small text-text-tertiary">{t("equipments.evSessions.emptyCharger")}</p>
      ) : (
        <div className="flex flex-col border-t border-border-light">
          {sessions.map((s) => {
            const chip = sessionChip(s);
            const solarPct = s.energyWh > 0 ? Math.round((s.solarWh / s.energyWh) * 100) : 0;
            const chipClass =
              chip.kind === "vehicle"
                ? "bg-primary-light text-primary"
                : chip.kind === "todo"
                  ? "bg-accent-light text-text"
                  : "bg-border-light text-text-secondary";
            const chipText =
              chip.kind === "vehicle"
                ? chip.deleted
                  ? t("equipments.evSessions.chip.deleted", { name: chip.name })
                  : chip.name
                : t(`equipments.evSessions.chip.${chip.kind}`);
            const how =
              s.attributionSource === "manual"
                ? t("equipments.evSessions.how.manual")
                : s.attribution === "unattributed" && s.attributionReason
                  ? t(`equipments.evSessions.reason.${s.attributionReason}`)
                  : s.attributionReason === "usual-vehicle"
                    ? t("equipments.evSessions.how.usual")
                    : s.attributionReason === "power-match"
                      ? t("equipments.evSessions.how.power")
                      : s.attributionReason === "energy-match"
                        ? t("equipments.evSessions.how.energy")
                        : s.attributionSource === "auto"
                          ? t("equipments.evSessions.how.auto")
                          : t("equipments.evSessions.solarShare", { pct: solarPct });
            return (
              <div key={s.id} className="flex flex-col gap-1.5 py-2.5 border-b border-border-light">
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className="flex flex-col gap-1.5 text-left cursor-pointer rounded-[6px] hover:bg-border-light/50 -mx-1 px-1"
                  aria-label={t("equipments.evSessions.edit", {
                    day: dayLabel(s.startedAt, locale),
                  })}
                >
                  <div className="flex justify-between gap-3 w-full">
                    <span className="text-body font-medium text-text">
                      {dayLabel(s.startedAt, locale)}{" "}
                      <span className="font-normal text-text-tertiary">
                        · {timeLabel(s.startedAt, locale)} →{" "}
                        {s.endedAt
                          ? timeLabel(s.endedAt, locale)
                          : t("equipments.evSessions.inProgress")}
                      </span>
                    </span>
                    <span className="font-mono text-body font-semibold text-text tabular-nums whitespace-nowrap">
                      {eur(s.costEur)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-caption font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${chipClass}`}
                      >
                        {chipText}
                      </span>
                      <span className="text-caption text-text-tertiary truncate">{how}</span>
                    </div>
                    <span className="font-mono text-caption text-text-secondary tabular-nums whitespace-nowrap">
                      {energyLabel(s.energyWh, locale)}
                    </span>
                  </div>
                </button>
                {chip.kind === "todo" && (
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className="self-start min-h-[44px] px-4 rounded-[8px] border border-primary text-primary text-small font-medium hover:bg-primary-light cursor-pointer"
                  >
                    {t("equipments.evSessions.choose")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && vehicles.length > 1 && (
        <div className="pt-3 border-t border-border-light flex flex-col gap-1">
          <label className="flex items-center justify-between gap-3 text-small text-text">
            <span className="font-semibold">{t("equipments.evSessions.usual.title")}</span>
            <span className="flex items-center gap-2">
              {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
              <select
                value={usualVehicleId ?? ""}
                disabled={saving}
                onChange={(e) => void setUsual(e.target.value)}
                className="min-h-[36px] px-2 rounded-[6px] border border-border bg-surface text-small text-text"
              >
                <option value="">{t("equipments.evSessions.usual.none")}</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <p className="text-caption text-text-tertiary">{t("equipments.evSessions.usual.hint")}</p>
        </div>
      )}

      {editing && (
        <EvReassignSheet
          session={editing}
          vehicles={vehicles}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setSessions((list) => list.map((s) => (s.id === updated.id ? updated : s)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
