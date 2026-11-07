import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CircleAlert, Clock, Loader2, Pause, Power, Check, Zap } from "lucide-react";
import { setEvSessionAttribution } from "../../../api";
import { dateLocale } from "../../../lib/locale";
import { useEquipments } from "../../../store/useEquipments";
import type { EquipmentWithDetails, EvChargeSession } from "../../../types";
import { formatEur } from "../../energy/format";
import { ShareBar } from "./EvShareBar";
import { EV_CHARGER_ALIASES, EV_VEHICLE_STATE_CATEGORY } from "../../../lib/ev-charger-contract";
import { electricVehicleStateOf } from "../electricVehicleState";
import { evChargerStateOf } from "../evChargerState";
import { powerLabel, energyLabel, liveState, type LiveInputs, timeLabel } from "./evSessionsDisplay";

/** The shared readers' view of the charger and the car, for `liveState`. */
function liveInputs(
  charger: EquipmentWithDetails | undefined,
  vehicle: EquipmentWithDetails,
): LiveInputs | null {
  if (!charger) return null;
  const c = evChargerStateOf(charger);
  const v = electricVehicleStateOf(vehicle);
  const vehicleBinding =
    charger.dataBindings.find((b) => b.category === EV_VEHICLE_STATE_CATEGORY) ??
    charger.dataBindings.find((b) => b.alias === EV_CHARGER_ALIASES.vehicle);
  return {
    chargerOn: c.on,
    vehicle: c.vehicle,
    vehicleChangedAt: vehicleBinding?.lastChanged ?? null,
    powerW: c.power.watts,
    battery: v.batteryLevel,
    chargeLimit: v.chargeLimit,
    metered: vehicleBinding === undefined,
  };
}

/**
 * Spec 192 — the charge in progress on the vehicle page: charging, paused
 * (with the reason the data tells), or ended and waiting for its automatic
 * attribution, with a button to confirm the car now.
 */
export function EvCurrentSessionCard({
  session,
  vehicle,
  onAttributed,
}: {
  session: EvChargeSession;
  vehicle: EquipmentWithDetails;
  onAttributed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const charger = useEquipments((s) => s.equipments.find((e) => e.id === session.chargerId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = liveState(session, liveInputs(charger, vehicle));
  const eur = (v: number | null) => (v === null ? "—" : formatEur(v, locale));
  const time = (iso: string) => timeLabel(iso, locale);

  const confirm = async () => {
    setSaving(true);
    try {
      await setEvSessionAttribution(session.id, { target: "vehicle", vehicleId: vehicle.id });
      onAttributed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  if (live.kind === "unplugged") return null;

  if (live.kind === "ended") {
    return (
      <div className="bg-surface rounded-[10px] border border-border p-4 mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Clock size={18} strokeWidth={1.5} className="text-text-secondary" />
          <h3 className="text-[14px] font-semibold text-text">
            {t("equipments.evSessions.current.ended")}
          </h3>
        </div>
        <span className="text-[13px] text-text-secondary -mt-1.5">
          {session.chargerName} · {time(session.startedAt)} → {time(session.endedAt!)}
        </span>
        <div className="flex items-center gap-2.5">
          <div className="flex-1">
            <ShareBar e={session} height="h-1.5" />
          </div>
          <span className="font-mono text-[12px] text-text-secondary tabular-nums whitespace-nowrap">
            {energyLabel(session.energyWh, locale)}
          </span>
          <span className="font-mono text-[14px] font-semibold text-text tabular-nums whitespace-nowrap">
            {eur(session.costEur)}
          </span>
        </div>
        {session.graceUntil && (
          <div className="flex gap-2.5 items-start bg-accent-light rounded-[6px] px-3 py-2.5">
            <CircleAlert size={16} strokeWidth={1.5} className="shrink-0 mt-px text-active-text" />
            <span className="text-[13px] text-text">
              {t("equipments.evSessions.current.willAttribute", {
                name: vehicle.name,
                time: time(session.graceUntil),
              })}
            </span>
          </div>
        )}
        {error && <p className="text-[12px] text-error">{error}</p>}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={saving}
            onClick={() => void confirm()}
            className="min-h-[44px] rounded-[6px] bg-primary hover:bg-primary-hover text-white text-[14px] font-medium cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={16} strokeWidth={1.5} />
            )}
            {t("equipments.evSessions.current.confirm", { name: vehicle.name })}
          </button>
          <Link
            to={`/equipments/${session.chargerId}`}
            className="min-h-[44px] flex items-center justify-center text-[13px] font-medium text-primary hover:text-primary-hover"
          >
            {t("equipments.evSessions.current.notThisCar")} ›
          </Link>
        </div>
      </div>
    );
  }

  const charging = live.kind === "charging";
  return (
    <div
      className={`rounded-[10px] border p-4 mb-6 flex flex-col gap-3 ${
        charging ? "bg-primary-light border-primary/25" : "bg-surface border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {charging ? (
            <Zap size={18} strokeWidth={1.5} className="text-primary" />
          ) : (
            <Pause size={18} strokeWidth={1.5} className="text-text-secondary" />
          )}
          <h3 className={`text-[14px] font-semibold ${charging ? "text-primary" : "text-text"}`}>
            {t(`equipments.evSessions.current.${live.kind}`)}
          </h3>
        </div>
        {live.kind === "charging" && live.powerW !== null && (
          <span className="flex items-center gap-1.5 font-mono text-[13px] text-primary tabular-nums">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            {powerLabel(live.powerW, locale)}
          </span>
        )}
        {live.kind === "paused" && live.sinceIso && (
          <span className="text-[12px] font-medium text-text-secondary bg-background rounded-[6px] px-2 py-0.5">
            {t("equipments.evSessions.current.since", { time: time(live.sinceIso) })}
          </span>
        )}
      </div>
      <span className="text-[13px] text-text-secondary -mt-1.5">
        {t(
          charging
            ? "equipments.evSessions.current.startedCharging"
            : "equipments.evSessions.current.startedPaused",
          { charger: session.chargerName, time: time(session.startedAt) },
        )}
      </span>

      {live.kind === "paused" && live.reason !== null && (
        <div className="flex gap-2.5 items-start bg-background rounded-[6px] px-3 py-2.5">
          {live.reason === "charger-off" ? (
            <Power size={16} strokeWidth={1.5} className="shrink-0 mt-px text-text-secondary" />
          ) : live.reason === "charge-limit" ? (
            <Check size={16} strokeWidth={1.5} className="shrink-0 mt-px text-success" />
          ) : (
            <Clock size={16} strokeWidth={1.5} className="shrink-0 mt-px text-text-secondary" />
          )}
          <span className="text-[13px] text-text-secondary">
            {t(`equipments.evSessions.current.reason.${live.reason}`, {
              name: vehicle.name,
              battery: live.battery ?? "—",
            })}
          </span>
        </div>
      )}

      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-mono text-[28px] font-semibold text-text tabular-nums">
            {energyLabel(session.energyWh, locale)}
          </span>
          <span className="text-[13px] text-text-tertiary">
            {t("equipments.evSessions.current.charged")}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-[18px] font-semibold text-text tabular-nums">
            {eur(session.costEur)}
          </span>
          <span className="text-[13px] text-text-tertiary">
            {t("equipments.evSessions.current.soFar")}
          </span>
        </div>
      </div>
      <ShareBar
        e={session}
        height="h-2"
        label={t("equipments.evSessions.barLabel", {
          hc: energyLabel(session.gridHcWh, locale),
          hp: energyLabel(session.gridHpWh, locale),
          solar: energyLabel(session.solarWh, locale),
        })}
      />
      <span
        className={`text-[12px] text-text-tertiary border-t pt-2.5 ${
          charging ? "border-primary/15" : "border-border-light"
        }`}
      >
        {t(
          charging
            ? "equipments.evSessions.current.countedLater"
            : "equipments.evSessions.current.sameSession",
        )}
      </span>
    </div>
  );
}
