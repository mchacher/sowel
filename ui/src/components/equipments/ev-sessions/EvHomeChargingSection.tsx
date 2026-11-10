import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  getEvCurrentSessions,
  getEvSessions,
  getEvVehicleSummary,
  updateEquipment,
} from "../../../api";
import { dateLocale } from "../../../lib/locale";
import { useEvSessions } from "../../../store/useEvSessions";
import type { EquipmentWithDetails, EvChargeSession, EvVehicleMonthSummary } from "../../../types";
import { formatEur } from "../../energy/format";
import { EvMonthNav } from "./EvMonthNav";
import { EvCurrentSessionCard } from "./EvCurrentSessionCard";
import { ShareBar } from "./EvShareBar";
import { dayLabel, endLabel, energyLabel, monthOf, timeLabel } from "./evSessionsDisplay";
import { formatCurrency, formatEnergy } from "../../../lib/format";

const VISIBLE_SESSIONS = 4;

/**
 * Spec 191 FR5 / FR7 — a vehicle's home charging for one month: cost, the
 * off-peak / peak / solar split, the cost per 100 km and its sessions.
 */
export function EvHomeChargingSection({
  equipment,
  isAdmin,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  isAdmin: boolean;
  onUpdated: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const rev = useEvSessions((s) => s.rev);
  const refreshSoon = useEvSessions((s) => s.refreshSoon);

  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [summary, setSummary] = useState<EvVehicleMonthSummary | null>(null);
  const [sessions, setSessions] = useState<EvChargeSession[]>([]);
  const [current, setCurrent] = useState<EvChargeSession[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The plug-in hybrid switch changes the summary: it refetches on it too.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getEvVehicleSummary(equipment.id, month),
      getEvSessions({ vehicleId: equipment.id }, month),
      getEvCurrentSessions(equipment.id),
    ])
      .then(([sum, list, inProgress]) => {
        if (cancelled) return;
        setSummary(sum);
        setSessions(list);
        setCurrent(inProgress);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [equipment.id, equipment.plugInHybrid, month, rev]);

  const eur = (v: number | null) => (v === null ? "—" : formatEur(v, locale));
  // A session shown in its own card above is not repeated in the list (spec 192).
  const listed = sessions.filter((s) => !current.some((c) => c.id === s.id));
  const visible = showAll ? listed : listed.slice(0, VISIBLE_SESSIONS);

  const setHybrid = async (value: boolean) => {
    setSaving(true);
    try {
      await updateEquipment(equipment.id, { plugInHybrid: value });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Spec 192 — the charge in progress, before it counts in the month. */}
      {month === monthOf(new Date()) &&
        current.map((s) => (
          <EvCurrentSessionCard
            key={s.id}
            session={s}
            vehicle={equipment}
            onAttributed={refreshSoon}
          />
        ))}
      <div className="card p-4 mb-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-body font-semibold text-text">
            {t("equipments.evSessions.homeCharging")}
          </h3>
          <EvMonthNav month={month} onChange={setMonth} />
        </div>

        {error && <p className="text-caption text-error">{error}</p>}

        {summary && summary.sessions === 0 ? (
          <p className="text-small text-text-tertiary">{t("equipments.evSessions.emptyVehicle")}</p>
        ) : (
          summary && (
            <>
              <div className="flex items-end justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-display font-semibold text-text tabular-nums">
                    {eur(summary.costEur)}
                  </span>
                  <span className="text-small text-text-tertiary">
                    {t("equipments.evSessions.addedToBill")}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-title font-semibold text-text tabular-nums">
                    {energyLabel(summary.energyWh, locale)}
                  </span>
                  <span className="text-small text-text-tertiary">
                    {t("equipments.evSessions.sessionsCount", { count: summary.sessions })}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <ShareBar
                  e={summary}
                  height="h-3.5"
                  label={t("equipments.evSessions.barLabel", {
                    hc: energyLabel(summary.gridHcWh, locale),
                    hp: energyLabel(summary.gridHpWh, locale),
                    solar: energyLabel(summary.solarWh, locale),
                  })}
                />
                <div className="flex flex-col gap-1.5 text-small">
                  {(
                    [
                      ["bg-energy-hc", "gridHc", summary.gridHcWh, eur(summary.costHcEur)],
                      ["bg-energy-hp", "gridHp", summary.gridHpWh, eur(summary.costHpEur)],
                      ["bg-solar-auto", "solar", summary.solarWh, null],
                    ] as const
                  ).map(([swatch, key, wh, cost]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${swatch}`} />
                      <span className="flex-1 text-text">{t(`equipments.evSessions.${key}`)}</span>
                      <span className="text-text-secondary tabular-nums">
                        {energyLabel(wh, locale)}
                      </span>
                      <span
                        className={`w-16 text-right ${cost === null ? "text-success" : "text-text tabular-nums"}`}
                      >
                        {cost ?? t("equipments.evSessions.free")}
                      </span>
                    </div>
                  ))}
                </div>
                <Per100km summary={summary} locale={locale} />
              </div>

              <div className="flex flex-col border-t border-border-light">
                {visible.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col gap-1.5 py-2.5 border-b border-border-light"
                  >
                    <div className="flex justify-between gap-3">
                      <span className="text-body font-medium text-text">
                        {dayLabel(s.startedAt, locale)}{" "}
                        <span className="font-normal text-text-tertiary">
                          <span className="whitespace-nowrap">
                            {timeLabel(s.startedAt, locale)} →
                          </span>{" "}
                          <span className="whitespace-nowrap">
                            {s.endedAt
                              ? endLabel(s.startedAt, s.endedAt, locale)
                              : t("equipments.evSessions.inProgress")}
                          </span>
                        </span>
                      </span>
                      <span className="text-body font-semibold text-text tabular-nums whitespace-nowrap">
                        {eur(s.costEur)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1">
                        <ShareBar e={s} height="h-1.5" />
                      </div>
                      <span className="text-caption text-text-secondary tabular-nums whitespace-nowrap">
                        {energyLabel(s.energyWh, locale)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {listed.length > VISIBLE_SESSIONS && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="self-start min-h-[44px] text-small font-medium text-primary hover:text-primary-hover cursor-pointer"
                >
                  {showAll
                    ? t("equipments.evSessions.showLess")
                    : t("equipments.evSessions.seeAll", { count: listed.length })}
                </button>
              )}
            </>
          )
        )}

        {isAdmin && (
          <div className="pt-3 border-t border-border-light">
            <label className="flex items-center gap-2 text-small text-text cursor-pointer">
              <input
                type="checkbox"
                checked={equipment.plugInHybrid === true}
                disabled={saving}
                onChange={(e) => void setHybrid(e.target.checked)}
              />
              <span className="font-semibold">{t("equipments.evSessions.plugInHybrid.title")}</span>
              {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
            </label>
            <p className="text-caption text-text-tertiary mt-1">
              {t("equipments.evSessions.plugInHybrid.hint")}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function Per100km({ summary, locale }: { summary: EvVehicleMonthSummary; locale: string }) {
  const { t } = useTranslation();
  if (summary.eurPer100kmUnavailable === "plug-in-hybrid") return null;
  if (
    summary.eurPer100km === null ||
    summary.kWhPer100km === null ||
    summary.homePriceEurPerKwh === null
  ) {
    return (
      <p className="text-caption text-text-tertiary pt-1">
        {t(
          `equipments.evSessions.per100Unavailable.${summary.eurPer100kmUnavailable ?? "not-learned"}`,
        )}
      </p>
    );
  }
  const price = formatCurrency(summary.homePriceEurPerKwh, { locale, decimals: 3 });
  const consumption = formatEnergy(summary.kWhPer100km, { locale });
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <span className="text-small text-text-secondary">
        <span className="font-semibold text-text tabular-nums">
          {formatEur(summary.eurPer100km, locale)}
        </span>{" "}
        {t("equipments.evSessions.per100")}
      </span>
      <span className="text-caption text-text-tertiary">
        {t("equipments.evSessions.per100Detail", { consumption, price })}
      </span>
    </div>
  );
}
