import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEquipments } from "../../store/useEquipments";
import { backfillPvForecast, getPvForecast } from "../../api";
import type { PvForecastResponse } from "../../types";
import { SolarProfileForm } from "../equipments/SolarProfileForm";
import { isActiveSolarProfile } from "../equipments/solarProfileValidation";

/**
 * Declare the photovoltaic installation (spec 163).
 *
 * The declaration form and the fit-from-history action used to sit under the
 * forecast chart on the production meter's equipment page; they are admin
 * acts performed once per array change, which is what Settings -> Energy is
 * for. The monitoring they feed lives on Energy -> Production.
 */
export function SolarInstallationSettings() {
  const { t } = useTranslation();
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);

  useEffect(() => {
    void fetchEquipments();
  }, [fetchEquipments]);

  const meters = useMemo(
    () => equipments.filter((e) => e.type === "energy_production_meter"),
    [equipments],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Default to the first declared meter so the common case (one array,
  // already declared) opens on its own profile, not on an empty sibling.
  const effectiveId =
    (selectedId && meters.some((m) => m.id === selectedId) ? selectedId : null) ??
    meters.find((m) => isActiveSolarProfile(m.solarProfile))?.id ??
    meters[0]?.id ??
    null;

  const [data, setData] = useState<PvForecastResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Guards against a stale response landing after a meter switch: without it,
   * meter A's profile resolving late would fill the form already keyed to
   * meter B, and the next save would write A's declaration onto B.
   */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!effectiveId) return;
    const seq = ++loadSeq.current;
    try {
      const res = await getPvForecast(effectiveId);
      if (seq !== loadSeq.current) return;
      setData(res);
      setFailed(false);
    } catch {
      if (seq !== loadSeq.current) return;
      setFailed(true);
    }
  }, [effectiveId]);

  useEffect(() => {
    setData(null);
    setNotice(null);
    setFailed(false);
    void load();
  }, [load]);

  /**
   * Fit from history the installation already holds (spec 161).
   *
   * Offered mainly while there is no model, which is the twelve-day gap this
   * exists to close, but kept available afterwards: it is also how a household
   * rebuilds the fit after correcting the declared array or its date.
   */
  async function backfill(): Promise<void> {
    if (!effectiveId) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await backfillPvForecast(effectiveId);
      setNotice(
        res.model
          ? t("equipments.pv.backfilled", { hours: res.hoursPaired })
          : t("equipments.pv.backfilledShort", { hours: res.hoursPaired }),
      );
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Sun size={18} strokeWidth={1.5} className="text-text-secondary" />
        <h2 className="text-[15px] font-semibold text-text">{t("equipments.solar.title")}</h2>
      </div>
      <p className="text-[12px] text-text-secondary mb-4">{t("equipments.solar.help")}</p>

      {meters.length === 0 ? (
        <p className="text-[13px] text-text-secondary">{t("settings.solar.noMeter")}</p>
      ) : (
        <>
          {meters.length > 1 && (
            <label className="flex items-center gap-2 mb-4 text-[13px] text-text-secondary">
              {t("settings.solar.meter")}
              <select
                value={effectiveId ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
                className="px-2 py-1.5 rounded-[6px] border border-border bg-surface text-[13px] text-text"
              >
                {meters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Never render the form from a failed fetch: saving from an empty
              draft would send an empty declaration and wipe whatever is
              stored. Say what happened and offer a retry instead. */}
          {failed ? (
            <div>
              <p className="text-[13px] text-text-secondary">{t("equipments.pv.loadFailed")}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 px-3 py-1.5 rounded-[6px] border border-border text-[12px] text-text-secondary hover:border-primary"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : data && effectiveId ? (
            <>
              <SolarProfileForm
                key={effectiveId}
                equipmentId={effectiveId}
                planes={data.planes}
                since={data.since}
                onSaved={() => void load()}
              />

              {/* Fit-from-history, only once something is declared: fitting an
                  undeclared array has nothing to bound the window with. */}
              {data.active && (
                <div className="mt-4 pt-4 border-t border-border flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void backfill()}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-border text-[13px] text-text-secondary hover:border-primary disabled:opacity-50"
                  >
                    <History size={14} strokeWidth={1.5} />
                    {t("equipments.pv.backfill")}
                  </button>
                  <span className="text-[11px] text-text-tertiary">
                    {t("equipments.pv.backfillHint")}
                  </span>
                  {notice && <span className="text-[12px] text-text-secondary">{notice}</span>}
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
