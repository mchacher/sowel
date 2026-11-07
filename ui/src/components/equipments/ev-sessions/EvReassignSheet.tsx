import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { setEvSessionAttribution } from "../../../api";
import { dateLocale } from "../../../lib/locale";
import type { EvAttributionChoice, EvChargeSession } from "../../../types";
import { formatEur } from "../../energy/format";
import { dayLabel, energyLabel, timeLabel } from "./evSessionsDisplay";

type Choice = { kind: "vehicle"; id: string } | { kind: "other" } | { kind: "todo" };

function initialChoice(s: EvChargeSession): Choice | null {
  if (s.attribution === "vehicle" && s.vehicleId && !s.vehicleDeleted) {
    return { kind: "vehicle", id: s.vehicleId };
  }
  if (s.attribution === "other") return { kind: "other" };
  return null;
}

/**
 * Spec 191 FR4 — say which car a session was. A sheet from the bottom on a
 * phone, a dialog on a wide screen. The choice is final (P8).
 */
export function EvReassignSheet({
  session,
  vehicles,
  onClose,
  onSaved,
}: {
  session: EvChargeSession;
  vehicles: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (s: EvChargeSession) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const [choice, setChoice] = useState<Choice | null>(() => initialChoice(session));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!choice) return;
    const body: EvAttributionChoice =
      choice.kind === "vehicle"
        ? { target: "vehicle", vehicleId: choice.id }
        : { target: choice.kind === "other" ? "other" : "unattributed" };
    setSaving(true);
    setError(null);
    try {
      onSaved(await setEvSessionAttribution(session.id, body));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const evidenceOf = (vehicleId: string): string | null => {
    const c = session.candidates.find((x) => x.vehicleId === vehicleId);
    if (!c) return null;
    if (c.batteryFrom !== null && c.batteryTo !== null) {
      return c.batteryTo > c.batteryFrom
        ? t("equipments.evSessions.sheet.batteryRose", {
            from: Math.round(c.batteryFrom),
            to: Math.round(c.batteryTo),
          })
        : t("equipments.evSessions.sheet.batteryFlat");
    }
    return c.chargingSeen ? t("equipments.evSessions.sheet.chargingSeen") : null;
  };

  const isSelected = (c: Choice) =>
    choice !== null &&
    choice.kind === c.kind &&
    (c.kind !== "vehicle" || (choice.kind === "vehicle" && choice.id === c.id));

  const option = (c: Choice, label: string, hint: string | null) => {
    const selected = isSelected(c);
    const value = c.kind === "vehicle" ? c.id : c.kind;
    return (
      <label
        key={value}
        className={`flex items-center gap-3 min-h-[48px] px-3 rounded-[8px] cursor-pointer ${
          selected ? "border-2 border-primary bg-primary-light" : "border border-border"
        }`}
      >
        <input
          type="radio"
          name="ev-session-vehicle"
          value={value}
          checked={selected}
          onChange={() => setChoice(c)}
          className="w-[18px] h-[18px] accent-primary"
        />
        <span className={`flex-1 text-body text-text ${selected ? "font-medium" : ""}`}>
          {label}
        </span>
        {hint && <span className="text-caption text-text-tertiary text-right">{hint}</span>}
      </label>
    );
  };

  const reason =
    session.attribution === "unattributed" && session.attributionReason
      ? t(`equipments.evSessions.sheet.reason.${session.attributionReason}`)
      : null;
  const title = t("equipments.evSessions.sheet.title", {
    day: dayLabel(session.startedAt, locale),
  });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full sm:max-w-md bg-surface rounded-t-[12px] sm:rounded-[12px] border border-border px-4 pt-3 pb-6 sm:p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden self-center w-10 h-1 rounded-full bg-border" aria-hidden="true" />
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <h3 className="text-lead font-semibold text-text">{title}</h3>
            <span className="text-small text-text-secondary">
              {timeLabel(session.startedAt, locale)} →{" "}
              {session.endedAt
                ? timeLabel(session.endedAt, locale)
                : t("equipments.evSessions.inProgress")}{" "}
              · <span className="tabular-nums">{energyLabel(session.energyWh, locale)}</span>
              {session.costEur !== null && (
                <>
                  {" "}
                  · <span className="tabular-nums">{formatEur(session.costEur, locale)}</span>
                </>
              )}
              {session.solarWh > 0 &&
                ` · ${t("equipments.evSessions.sheet.solarPart", { energy: energyLabel(session.solarWh, locale) })}`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 -mt-2 -mr-2 flex items-center justify-center rounded-[8px] text-text-secondary hover:bg-border-light cursor-pointer"
            aria-label={t("common.close")}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {reason && (
          <div className="flex gap-2 items-start bg-accent-light rounded-[8px] px-3 py-2.5 text-small text-text">
            <span className="w-2 h-2 rounded-full bg-accent-hover shrink-0 mt-[5px]" />
            <span>{reason}</span>
          </div>
        )}

        <fieldset className="flex flex-col gap-1">
          <legend className="text-small text-text-tertiary pb-1.5">
            {t("equipments.evSessions.sheet.question")}
          </legend>
          {vehicles.map((v) => option({ kind: "vehicle", id: v.id }, v.name, evidenceOf(v.id)))}
          {option(
            { kind: "other" },
            t("equipments.evSessions.sheet.other"),
            t("equipments.evSessions.sheet.otherHint"),
          )}
          {option({ kind: "todo" }, t("equipments.evSessions.sheet.todo"), null)}
        </fieldset>

        <span className="text-caption text-text-tertiary">
          {t("equipments.evSessions.sheet.final")}
        </span>
        {error && <p className="text-caption text-error">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-[8px] border border-border text-body font-medium text-text hover:bg-border-light cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!choice || saving}
            className="flex-1 min-h-[44px] rounded-[8px] bg-primary text-white text-body font-medium hover:bg-primary-hover disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t("equipments.evSessions.sheet.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
