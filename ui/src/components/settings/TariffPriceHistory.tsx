import { useCallback, useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createTariffVersion,
  deleteTariffVersion,
  getTariffVersions,
  updateTariffVersion,
} from "../../api";
import { apiErrorText } from "../../lib/api-error";
import { EMPTY, formatCurrency, formatDay, formatNumber, formatWithUnit } from "../../lib/format";
import { localDateStr } from "../../lib/local-date";
import { buildTariffVersionRows, parseDecimalInput } from "../../lib/tariffVersions";
import type { TariffVersionRow } from "../../lib/tariffVersions";
import type { TariffContractType, TariffVersion, TariffVersionInput } from "../../types";

// Spec 202 (FR6) — the price history: one row per version, newest first, three
// at a time, and one inline form to add a price change or correct a version.
// A table from `sm`, a three-line list on a phone; both read the same rows.

/** The server refuses a price outside 0..5 €/kWh; said here before the round trip. */
const MAX_PRICE = 5;

const LABEL = "block text-caption text-text-secondary mb-1";
// 44 px high with 16 px text on a phone (no zoom on focus), 34 px and 13 px from `sm`.
const INPUT =
  "w-full min-w-0 min-h-11 sm:min-h-0 px-3 py-2 sm:px-2.5 sm:py-1.5 border border-border rounded-sm bg-surface text-text text-lead sm:text-small tabular-nums";
const TH = "sticky top-0 bg-surface py-1.5 font-medium border-b border-border whitespace-nowrap";
const ICON_BTN =
  "inline-flex items-center justify-center w-10 h-11 sm:w-8 sm:h-8 rounded-sm text-text-tertiary hover:text-text hover:bg-border-light transition-colors disabled:opacity-40";
const CONFIRM_BTN =
  "shrink-0 min-h-11 sm:min-h-0 px-1.5 py-1 text-caption font-medium text-error border border-error/40 rounded-sm hover:bg-error/10 disabled:opacity-50";
const PILL =
  "inline-block py-0.5 rounded-full bg-primary-light text-primary font-medium leading-4 whitespace-nowrap";

type FormState = { mode: "add" } | { mode: "edit"; version: TariffVersion };

export function TariffPriceHistory({
  contractType,
  contractKva,
  reloadKey = 0,
  notice = null,
  onVersionsChange,
}: {
  /** A Base contract asks for one price and shows one price column. */
  contractType: TariffContractType;
  /** The contract's subscribed power: pre-fills a new price change. */
  contractKva: number | null;
  /** Spec 203 — a new value reads the versions again: the price file added some. */
  reloadKey?: number;
  /** Spec 203 — shown under the hint, above the list: the prices of the file to confirm. */
  notice?: ReactNode;
  /** Spec 203 — a version was added, corrected or deleted here: the prices to confirm follow. */
  onVersionsChange?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [versions, setVersions] = useState<TariffVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVersions(await getTariffVersions());
      setError(null);
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // An armed delete is given up by pressing anywhere else.
  useEffect(() => {
    if (armed === null) return;
    const disarm = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest("[data-confirm-delete]")) setArmed(null);
    };
    document.addEventListener("pointerdown", disarm);
    return () => document.removeEventListener("pointerdown", disarm);
  }, [armed]);

  const rows = buildTariffVersionRows(versions ?? [], localDateStr());
  // One price column and one price field only while every version holds a
  // single price. A household that moved from off-peak hours to Base keeps
  // past versions with two prices: they stay visible and editable as two, so
  // correcting a fee never overwrites an off-peak price (spec 202 FR4).
  const singleRate = contractType === "base";
  const onePrice = (v: TariffVersion) => v.prices.hp === v.prices.hc;
  const base = singleRate && rows.every((r) => onePrice(r.version));
  const latest = rows[0]?.version ?? null;

  const save = async (input: TariffVersionInput) => {
    if (form?.mode === "edit") await updateTariffVersion(form.version.id, input);
    else await createTariffVersion(input);
    setForm(null);
    await load();
    onVersionsChange?.();
  };

  const remove = async (version: TariffVersion) => {
    setArmed(null);
    setBusy(version.id);
    setError(null);
    try {
      await deleteTariffVersion(version.id);
      if (form?.mode === "edit" && form.version.id === version.id) setForm(null);
      await load();
      onVersionsChange?.();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(null);
    }
  };

  const openForm = (next: FormState) => {
    setArmed(null);
    setForm(next);
  };

  // ── What a row reads ──────────────────────────────────────────────────

  const price = (v: number) => formatNumber(v, { decimals: 4 });
  const fee = (v: TariffVersion) =>
    v.fixedFeeYear == null
      ? null
      : t("tariff.prices.feePerYear", { amount: formatCurrency(v.fixedFeeYear) });
  const power = (v: TariffVersion) => (v.kva == null ? null : formatWithUnit(v.kva, "kVA"));

  /** Rows are newest first: the version that follows row `i` in time is row `i - 1`. */
  const editLabel = (row: TariffVersionRow, i: number) => {
    if (row.startDate) return t("tariff.prices.edit", { date: formatDay(row.startDate) });
    const next = rows[i - 1]?.startDate;
    return next
      ? t("tariff.prices.editBefore", { date: formatDay(next) })
      : t("tariff.prices.editOrigin");
  };

  /** « Depuis le … », « Du … au … », « Jusqu'au … »: the period on one line, for the phone. */
  const period = (row: TariffVersionRow) => {
    if (row.startDate && row.endDate) {
      return t("tariff.prices.range", {
        start: formatDay(row.startDate),
        end: formatDay(row.endDate),
      });
    }
    if (row.startDate) {
      return t(row.status === "upcoming" ? "tariff.prices.from" : "tariff.prices.since", {
        date: formatDay(row.startDate),
      });
    }
    if (row.endDate) return t("tariff.prices.until", { date: formatDay(row.endDate) });
    return t("tariff.prices.sinceStart");
  };

  const pill = (row: TariffVersionRow, size: string) =>
    row.status && (
      <span className={`${PILL} ${size}`}>
        {t(row.status === "current" ? "tariff.prices.current" : "tariff.prices.upcoming")}
      </span>
    );

  /** Pencil and trash; the version without a date has no trash, and keeps its place. */
  const actions = (row: TariffVersionRow, i: number, spacer: string) => {
    const v = row.version;
    if (armed === v.id) {
      return (
        <button
          type="button"
          data-confirm-delete
          disabled={busy !== null}
          aria-label={t("tariff.prices.confirmDelete", { date: formatDay(row.startDate) })}
          onClick={() => void remove(v)}
          className={CONFIRM_BTN}
        >
          {t("common.confirm")}
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          className={ICON_BTN}
          disabled={busy !== null}
          aria-label={editLabel(row, i)}
          onClick={() => openForm({ mode: "edit", version: v })}
        >
          <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {row.startDate ? (
          <button
            type="button"
            className={ICON_BTN}
            disabled={busy !== null}
            aria-label={t("tariff.prices.delete", { date: formatDay(row.startDate) })}
            onClick={() => setArmed(v.id)}
          >
            {busy === v.id ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className={spacer} />
        )}
      </>
    );
  };

  // ── The form, for the first price, a new change or a correction ───────

  const formFor = (state: FormState | null): ReactNode => {
    const editing = state?.mode === "edit" ? state.version : null;
    const first = state === null;
    const editIndex = editing ? rows.findIndex((r) => r.version.id === editing.id) : -1;
    const title = editing
      ? editIndex >= 0
        ? editLabel(rows[editIndex], editIndex)
        : t("tariff.prices.editOrigin")
      : first
        ? null
        : t("tariff.prices.form.newTitle");
    return (
      <PriceForm
        // A new key resets the fields when the target, the contract type or the
        // power a new change is pre-filled with changes.
        key={editing ? `${editing.id}-${contractType}` : `new-${contractType}-${contractKva}`}
        title={title}
        base={singleRate && (!editing || onePrice(editing))}
        takenDates={rows
          .map((r) => r.version)
          .filter((v) => v.id !== editing?.id && v.startDate !== null)
          .map((v) => v.startDate as string)}
        // The version without a date has no date; neither has the very first one.
        withDate={editing ? editing.startDate !== null : !first}
        initial={{
          startDate: editing?.startDate ?? "",
          hp: editing ? editing.prices.hp : null,
          hc: editing ? editing.prices.hc : null,
          // A new change keeps the latest fee and takes the contract's power.
          fixedFeeYear: editing ? editing.fixedFeeYear : (latest?.fixedFeeYear ?? null),
          kva: editing ? editing.kva : (contractKva ?? latest?.kva ?? null),
        }}
        autoFocus={!first}
        onSubmit={save}
        onCancel={first ? null : () => setForm(null)}
      />
    );
  };

  return (
    <section aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-small font-medium text-text mb-1">
        {t("tariff.prices.title")}
      </h3>
      <p className="text-caption leading-4.5 text-text-tertiary mb-1 sm:mb-3">
        {t("tariff.prices.hint")}
      </p>

      {notice}

      {versions === null && !error && (
        <Loader2 size={16} className="animate-spin text-text-tertiary" />
      )}

      {rows.length > 0 && (
        <>
          {/* From `sm`: a table, three rows high, the header staying in place. */}
          <div className="hidden sm:block max-h-44 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-text-tertiary/50">
            <table className="w-full border-separate border-spacing-0 text-small tabular-nums">
              <thead>
                <tr className="text-micro leading-4 uppercase tracking-wide text-text-tertiary">
                  <th scope="col" className={`${TH} text-left`}>
                    {t("tariff.prices.col.start")}
                  </th>
                  <th scope="col" className={`${TH} text-left w-27.5`}>
                    {t("tariff.prices.col.end")}
                  </th>
                  {base ? (
                    <th scope="col" className={`${TH} text-right w-21`}>
                      {t("tariff.prices.col.price")}
                    </th>
                  ) : (
                    <>
                      <th scope="col" className={`${TH} text-right w-21`}>
                        {t("tariff.prices.col.hp")}
                      </th>
                      <th scope="col" className={`${TH} text-right w-21`}>
                        {t("tariff.prices.col.hc")}
                      </th>
                    </>
                  )}
                  <th scope="col" className={`${TH} text-right w-28`}>
                    {t("tariff.prices.col.fee")}
                  </th>
                  <th scope="col" className={`${TH} text-right w-22`}>
                    {t("tariff.prices.col.power")}
                  </th>
                  <th scope="col" className={`${TH} w-20`}>
                    <span className="sr-only">{t("tariff.prices.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const v = row.version;
                  const td = `py-2 text-text ${i < rows.length - 1 ? "border-b border-border-light" : ""}`;
                  return (
                    <tr key={v.id} data-testid="tariff-version-row">
                      <td className={td}>
                        {row.startDate ? (
                          <span className="font-medium">{formatDay(row.startDate)}</span>
                        ) : (
                          <span className="text-text-tertiary">{t("tariff.prices.origin")}</span>
                        )}
                      </td>
                      <td className={td}>
                        {row.endDate ? formatDay(row.endDate) : pill(row, "px-2 text-caption")}
                      </td>
                      <td className={`${td} text-right`}>{price(v.prices.hp)}</td>
                      {!base && <td className={`${td} text-right`}>{price(v.prices.hc)}</td>}
                      <td className={`${td} text-right`}>{fee(v) ?? EMPTY}</td>
                      <td className={`${td} text-right`}>{power(v) ?? EMPTY}</td>
                      <td className={td}>
                        <div className="flex items-center justify-end min-h-8">
                          {actions(row, i, "shrink-0 w-8")}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* On a phone: three lines per version, three versions high. */}
          <ul className="sm:hidden max-h-[243px] overflow-y-auto pr-1 text-small tabular-nums [&::-webkit-scrollbar-thumb]:bg-text-tertiary/50">
            {rows.map((row, i) => {
              const v = row.version;
              return (
                <li
                  key={v.id}
                  data-testid="tariff-version-item"
                  className={`flex items-center gap-2 py-2.5 ${
                    i < rows.length - 1 ? "border-b border-border-light" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0 text-text">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{period(row)}</span>
                      {pill(row, "px-1.5 text-micro")}
                    </div>
                    <div className="flex gap-4 mt-0.5">
                      {base ? (
                        <span>{formatCurrency(v.prices.hp, { decimals: 4 })}</span>
                      ) : (
                        <>
                          <span>
                            <span className="text-text-tertiary">{t("tariff.prices.hpShort")}</span>{" "}
                            {formatCurrency(v.prices.hp, { decimals: 4 })}
                          </span>
                          <span>
                            <span className="text-text-tertiary">{t("tariff.prices.hcShort")}</span>{" "}
                            {formatCurrency(v.prices.hc, { decimals: 4 })}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-caption leading-4.5 text-text-tertiary">
                      {[fee(v), power(v)].filter(Boolean).join(", ") || EMPTY}
                    </div>
                  </div>
                  {actions(row, i, "shrink-0 w-10")}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error && (
        <p role="alert" className="text-caption text-error mt-2">
          {error}
        </p>
      )}

      {versions !== null && rows.length === 0 && formFor(null)}

      {rows.length > 0 &&
        (form ? (
          formFor(form)
        ) : (
          <button
            type="button"
            onClick={() => openForm({ mode: "add" })}
            className="mt-1 sm:mt-3 min-h-11 sm:min-h-0 flex items-center gap-1 text-caption text-primary hover:text-primary-hover transition-colors"
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            {t("tariff.prices.add")}
          </button>
        ))}
    </section>
  );
}

interface PriceFormValues {
  startDate: string;
  hp: number | null;
  hc: number | null;
  fixedFeeYear: number | null;
  kva: number | null;
}

/** A stored number as the text of a field: the locale's decimal mark, no grouping. */
function fieldText(v: number | null, maxDecimals: number): string {
  return v == null ? "" : formatNumber(v, { maxDecimals, grouping: false });
}

function PriceForm({
  title,
  base,
  takenDates,
  withDate,
  initial,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  /** Null for the first price ever: the block's own heading is enough. */
  title: string | null;
  base: boolean;
  /** The start dates of the other versions: two cannot share one. */
  takenDates: string[];
  withDate: boolean;
  initial: PriceFormValues;
  autoFocus: boolean;
  /** Rejects with the server's error, shown in the form. */
  onSubmit: (input: TariffVersionInput) => Promise<void>;
  /** Null when there is nothing to go back to (no version yet). */
  onCancel: (() => void) | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [startDate, setStartDate] = useState(initial.startDate);
  const [hp, setHp] = useState(fieldText(initial.hp, 6));
  const [hc, setHc] = useState(fieldText(initial.hc, 6));
  const [feeText, setFeeText] = useState(fieldText(initial.fixedFeeYear, 2));
  const [kvaText, setKvaText] = useState(fieldText(initial.kva, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The input to send, or the message that says what to fix. */
  const read = (): TariffVersionInput | string => {
    if (withDate && !startDate) return t("tariff.prices.form.error.date");
    if (withDate && takenDates.includes(startDate)) {
      return t("tariff.prices.form.error.duplicate");
    }
    const peak = parseDecimalInput(hp);
    const offPeak = base ? peak : parseDecimalInput(hc);
    if (peak === null || offPeak === null || peak > MAX_PRICE || offPeak > MAX_PRICE) {
      return t("tariff.prices.form.error.price");
    }
    const feeValue = feeText.trim() === "" ? null : parseDecimalInput(feeText);
    if (feeText.trim() !== "" && feeValue === null) return t("tariff.prices.form.error.fee");
    const kvaValue = kvaText.trim() === "" ? null : parseDecimalInput(kvaText);
    if (kvaText.trim() !== "" && (kvaValue === null || kvaValue <= 0)) {
      return t("tariff.prices.form.error.power");
    }
    return {
      ...(withDate ? { startDate } : {}),
      prices: { hp: peak, hc: offPeak },
      fixedFeeYear: feeValue,
      kva: kvaValue,
    };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = read();
    if (typeof input === "string") return setError(input);
    setSaving(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  const hint = t("tariff.prices.form.startDateHint");

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="mt-2 sm:mt-3 p-4 rounded-md bg-background"
    >
      {title && <h4 className="text-small font-medium text-text mb-3">{title}</h4>}
      {/* Stacked on a phone, the four figures two by two; one row from `sm`. */}
      <div className="flex flex-col gap-3 sm:grid sm:grid-flow-col sm:auto-cols-fr">
        {withDate && (
          <div>
            <label htmlFor={`${id}-date`} className={LABEL}>
              {t("tariff.prices.form.startDate")}
            </label>
            <input
              id={`${id}-date`}
              type="date"
              required
              autoFocus={autoFocus}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={INPUT}
            />
            <p className="sm:hidden text-caption leading-4.5 text-text-tertiary mt-1">{hint}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <div>
            <label htmlFor={`${id}-hp`} className={LABEL}>
              {t(base ? "tariff.prices.form.price" : "tariff.priceHp")}
            </label>
            <input
              id={`${id}-hp`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={formatNumber(0, { decimals: 4 })}
              autoFocus={autoFocus && !withDate}
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              className={INPUT}
            />
          </div>
          {!base && (
            <div>
              <label htmlFor={`${id}-hc`} className={LABEL}>
                {t("tariff.priceHc")}
              </label>
              <input
                id={`${id}-hc`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder={formatNumber(0, { decimals: 4 })}
                value={hc}
                onChange={(e) => setHc(e.target.value)}
                className={INPUT}
              />
            </div>
          )}
          <div>
            <label htmlFor={`${id}-fee`} className={LABEL}>
              {t("tariff.prices.form.fee")}
            </label>
            <input
              id={`${id}-fee`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={feeText}
              onChange={(e) => setFeeText(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor={`${id}-kva`} className={LABEL}>
              {t("tariff.prices.form.power")}
            </label>
            <input
              id={`${id}-kva`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={kvaText}
              onChange={(e) => setKvaText(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
      </div>
      {withDate && (
        <p className="hidden sm:block text-caption leading-4.5 text-text-tertiary mt-2">{hint}</p>
      )}
      {error && (
        <p role="alert" className="text-caption text-error mt-2">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 mt-4 sm:flex">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 sm:min-h-0 px-4 py-1.5 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              {t("tariff.saving")}
            </span>
          ) : (
            t("common.save")
          )}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 sm:min-h-0 px-4 py-1.5 border border-border rounded-sm bg-surface text-text text-small font-medium hover:bg-border-light transition-colors"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
