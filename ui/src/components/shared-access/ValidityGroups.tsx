import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import {
  type ValidityDraft,
  addMinutes,
  moveStart,
  parseHm,
} from "../../lib/shared-access-period";
import { DateTimePicker } from "./DateTimePicker";
import { btnSecondary, iconBtn, inputBadCls, inputCls, Refusal, Segmented } from "./ui";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-3 border border-border rounded-[10px] px-3 py-2.5">
      <legend className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest px-1">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * A bound the server does not hold (an access « from » or « until » a date
 * only): said as such, and set only when the owner asks for it.
 */
function MissingBound({ text, action, onSet }: { text: string; action: string; onSet: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-text-tertiary">{text}</span>
      <button type="button" className={btnSecondary} onClick={onSet}>
        {action}
      </button>
    </div>
  );
}

/**
 * R3.10 — validity is two separate groups, the same on an access and on a
 * profile: Dates (« Tout le temps » | « Du … au … ») and Heures (« Toute la
 * journée » | « Par plages »). `datesSlot` replaces the Dates group body — an
 * external access shows its source's dates there, read-only.
 */
export function ValidityGroups({
  value,
  onChange,
  datesError,
  hoursError,
  datesSlot,
}: {
  value: ValidityDraft;
  onChange: (next: ValidityDraft) => void;
  datesError?: string | null;
  hoursError?: string | null;
  datesSlot?: ReactNode;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<ValidityDraft>) => onChange({ ...value, ...patch });

  const setWindow = (i: number, key: "from" | "to", v: string) =>
    set({ windows: value.windows.map((w, j) => (j === i ? { ...w, [key]: v } : w)) });

  return (
    <>
      <Group title={t("sharedAccess.validity.dates")}>
        {datesSlot ?? (
          <>
            <Segmented
              value={value.period ? "period" : "always"}
              options={[
                { value: "always", label: t("sharedAccess.validity.always") },
                { value: "period", label: t("sharedAccess.validity.period") },
              ]}
              onChange={(v) => set({ period: v === "period" })}
            />
            {value.period && (
              <div className="mt-2.5 grid gap-2 text-[13px] text-text-secondary">
                <div className="flex flex-col gap-1">
                  <span>{t("sharedAccess.validity.from")}</span>
                  {value.from ? (
                    <DateTimePicker
                      label={t("sharedAccess.validity.from")}
                      value={value.from}
                      onChange={(from) =>
                        set({ from, until: moveStart(value.from, from, value.until) })
                      }
                    />
                  ) : (
                    <MissingBound
                      text={t("sharedAccess.validity.noStart")}
                      action={t("sharedAccess.validity.setStart")}
                      // Only on the owner's click: a day before the end it already has.
                      onSet={() => value.until && set({ from: addMinutes(value.until, -24 * 60) })}
                    />
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span>{t("sharedAccess.validity.until")}</span>
                  {value.until ? (
                    <DateTimePicker
                      label={t("sharedAccess.validity.until")}
                      value={value.until}
                      bounds={{ min: value.from, minStrict: true }}
                      onChange={(until) => set({ until })}
                    />
                  ) : (
                    <MissingBound
                      text={t("sharedAccess.validity.noEnd")}
                      action={t("sharedAccess.validity.setEnd")}
                      // Only on the owner's click: a day after the start it already has.
                      onSet={() => value.from && set({ until: addMinutes(value.from, 24 * 60) })}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {datesError && <Refusal>{datesError}</Refusal>}
      </Group>

      <Group title={t("sharedAccess.validity.hours")}>
        <Segmented
          value={value.ranges ? "ranges" : "all"}
          options={[
            { value: "all", label: t("sharedAccess.validity.allDay") },
            { value: "ranges", label: t("sharedAccess.validity.ranges") },
          ]}
          onChange={(v) =>
            set(
              v === "ranges"
                ? {
                    ranges: true,
                    windows: value.windows.length ? value.windows : [{ from: "08:00", to: "20:00" }],
                  }
                : { ranges: false },
            )
          }
        />
        {value.ranges && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {value.windows.map((w, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  className={`${parseHm(w.from) === null ? inputBadCls : inputCls} w-[84px] font-mono`}
                  value={w.from}
                  inputMode="numeric"
                  placeholder="08:00"
                  aria-label={t("sharedAccess.validity.windowFrom")}
                  onChange={(e) => setWindow(i, "from", e.target.value)}
                />
                <span className="text-text-tertiary">–</span>
                <input
                  className={`${parseHm(w.to) === null ? inputBadCls : inputCls} w-[84px] font-mono`}
                  value={w.to}
                  inputMode="numeric"
                  placeholder="20:00"
                  aria-label={t("sharedAccess.validity.windowTo")}
                  onChange={(e) => setWindow(i, "to", e.target.value)}
                />
                <button
                  type="button"
                  className={iconBtn}
                  aria-label={t("common.remove")}
                  onClick={() => {
                    const windows = value.windows.filter((_, j) => j !== i);
                    set({ windows, ranges: windows.length > 0 });
                  }}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className={`${btnSecondary} inline-flex items-center gap-1`}
                onClick={() => set({ windows: [...value.windows, { from: "18:00", to: "20:00" }] })}
              >
                <Plus size={14} strokeWidth={1.5} />
                {t("sharedAccess.validity.addWindow")}
              </button>
            </div>
          </div>
        )}
        {hoursError && <Refusal>{hoursError}</Refusal>}
      </Group>
    </>
  );
}
