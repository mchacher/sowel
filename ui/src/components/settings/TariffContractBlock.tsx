import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  checkPriceFile,
  getPriceFileStatus,
  getTariffContract,
  saveTariffContract,
} from "../../api";
import { apiErrorText } from "../../lib/api-error";
import { formatDay, formatWithUnit } from "../../lib/format";
import { localDateStr } from "../../lib/local-date";
import { canCheckPriceFile, followsPriceFile, priceFileStatusLine } from "../../lib/priceFile";
import type { PriceFileStatusLine } from "../../lib/priceFile";
import type {
  PriceFileStatus,
  TariffContract,
  TariffContractType,
  TariffSupplier,
} from "../../types";

// Spec 202 (FR4, FR6) — the current contract: supplier, type and subscribed
// power, saved on change. The type decides whether the price form asks for one
// price or two, and the power pre-fills a new price change.
//
// Spec 203 (FR3, FR6) — a supplier of the price file adds « Mettre à jour les
// prix automatiquement », saved like the selects, and under it where the read
// of the file stands, with « Vérifier maintenant ». The supplier, the type and
// the power are what the rows of the file are matched on.

const SUPPLIERS: TariffSupplier[] = ["edf-tarif-bleu", "other"];
const CONTRACT_TYPES: TariffContractType[] = ["hphc", "base"];
/** The powers a French residential contract can subscribe, kVA. */
const POWERS_KVA = [3, 6, 9, 12, 15, 18, 24, 30, 36];

const LABEL = "block text-caption text-text-secondary mb-1";
// 44 px high with 16 px text on a phone (no zoom on focus), 34 px and 13 px from `sm`.
const SELECT =
  "w-full h-11 sm:h-8.5 px-3 sm:px-2.5 border border-border rounded-sm bg-surface text-text text-lead sm:text-small disabled:opacity-60";

/** The local day of an ISO time, as a short date. */
const dayOf = (iso: string) => formatDay(localDateStr(new Date(iso)));

export function TariffContractBlock({
  onContract,
  status,
  onStatus,
  onFileRead,
}: {
  /**
   * The contract as read, then after each save: the price block follows it.
   * Pass a stable function (a state setter): a new one reads the contract again.
   */
  onContract: (contract: TariffContract) => void;
  /** Where the read of the price file stands; null until it is read. The parent holds it. */
  status: PriceFileStatus | null;
  /** The status as read, then after each save and each check. A stable function too. */
  onStatus: (status: PriceFileStatus) => void;
  /** The file was read again: it may have added prices by itself. A stable function too. */
  onFileRead: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [contract, setContract] = useState<TariffContract | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTariffContract()
      .then((c) => {
        if (cancelled) return;
        setContract(c);
        onContract(c);
        return getPriceFileStatus().then((s) => {
          if (!cancelled) onStatus(s);
        });
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorText(err, t));
      });
    return () => {
      cancelled = true;
    };
  }, [onContract, onStatus, t]);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      onStatus(await checkPriceFile());
      onFileRead();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setChecking(false);
    }
  }, [onStatus, onFileRead, t]);

  /**
   * After a save: the status of the new contract at once (it is computed from
   * the file already read), then the result of the read the server starts on a
   * contract change, which a check asked now joins.
   */
  const refresh = async (stored: TariffContract) => {
    try {
      onStatus(await getPriceFileStatus());
    } catch (err) {
      setError(apiErrorText(err, t));
      return;
    }
    if (followsPriceFile(stored)) await check();
  };

  const change = async (patch: Partial<TariffContract>) => {
    if (!contract) return;
    const previous = contract;
    const { autoUpdate, ...rest } = { ...contract, ...patch };
    // Another supplier: the server says whether its prices are followed (on
    // for a supplier of the file, off for « Autre fournisseur »).
    const newSupplier = rest.supplier !== previous.supplier;
    setContract({ ...rest, autoUpdate: newSupplier ? rest.supplier !== "other" : autoUpdate });
    setSaving(true);
    setError(null);
    let stored: TariffContract;
    try {
      stored = await saveTariffContract(newSupplier ? rest : { ...rest, autoUpdate });
    } catch (err) {
      setContract(previous);
      setError(apiErrorText(err, t));
      return;
    } finally {
      setSaving(false);
    }
    setContract(stored);
    onContract(stored);
    void refresh(stored);
  };

  const statusText = (line: PriceFileStatusLine): string => {
    switch (line.kind) {
      case "noPower":
        return t("tariff.contract.status.noPower");
      case "neverChecked":
        return t("tariff.contract.status.neverChecked");
      case "noPrice":
        return t("tariff.contract.status.noPrice");
      case "failed":
        return line.lastSuccessAt
          ? t("tariff.contract.status.failed", { date: dayOf(line.lastSuccessAt) })
          : t("tariff.contract.status.failedNever");
      case "checked":
        return line.latestStartDate
          ? t("tariff.contract.status.checked", {
              date: dayOf(line.lastCheckAt),
              latest: formatDay(line.latestStartDate),
            })
          : t("tariff.contract.status.checkedOnly", { date: dayOf(line.lastCheckAt) });
    }
  };

  const disabled = contract === null || saving;
  const line = contract ? priceFileStatusLine(contract, status) : null;
  const canCheck = canCheckPriceFile(line);
  // A power outside the usual steps (set through the API) stays selectable.
  const powers =
    contract?.kva != null && !POWERS_KVA.includes(contract.kva)
      ? [...POWERS_KVA, contract.kva].sort((a, b) => a - b)
      : POWERS_KVA;

  return (
    <section aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-small font-medium text-text mb-2">
        {t("tariff.contract.title")}
      </h3>
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <label htmlFor={`${id}-supplier`} className={LABEL}>
            {t("tariff.contract.supplier")}
          </label>
          <select
            id={`${id}-supplier`}
            className={SELECT}
            disabled={disabled}
            value={contract?.supplier ?? "other"}
            onChange={(e) => void change({ supplier: e.target.value as TariffSupplier })}
          >
            {SUPPLIERS.map((s) => (
              <option key={s} value={s}>
                {t(`tariff.contract.suppliers.${s}`)}
              </option>
            ))}
          </select>
        </div>
        {/* Side by side under the supplier on a phone, two more columns from `sm`. */}
        <div className="grid grid-cols-[3fr_2fr] gap-3 sm:contents">
          <div>
            <label htmlFor={`${id}-type`} className={LABEL}>
              {t("tariff.contract.type")}
            </label>
            <select
              id={`${id}-type`}
              className={SELECT}
              disabled={disabled}
              value={contract?.contractType ?? "hphc"}
              onChange={(e) => void change({ contractType: e.target.value as TariffContractType })}
            >
              {CONTRACT_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`tariff.contract.types.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-kva`} className={LABEL}>
              {t("tariff.contract.power")}
            </label>
            <select
              id={`${id}-kva`}
              className={SELECT}
              disabled={disabled}
              value={contract?.kva ?? ""}
              onChange={(e) => {
                // The empty choice only exists while no power is set: it is not a way back.
                if (e.target.value !== "") void change({ kva: Number(e.target.value) });
              }}
            >
              {contract?.kva == null && <option value="">{t("tariff.contract.powerUnset")}</option>}
              {powers.map((kva) => (
                <option key={kva} value={kva}>
                  {formatWithUnit(kva, "kVA")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {contract && contract.supplier !== "other" && (
        <>
          {/* 44 px high with an 18 px box on a phone, one line and 16 px from `sm`. */}
          <div className="flex items-center gap-2 mt-3 min-h-11 sm:min-h-0">
            <input
              id={`${id}-auto`}
              type="checkbox"
              className="shrink-0 w-4.5 h-4.5 sm:w-4 sm:h-4"
              disabled={disabled}
              checked={contract.autoUpdate}
              onChange={(e) => void change({ autoUpdate: e.target.checked })}
            />
            <label htmlFor={`${id}-auto`} className="text-small text-text">
              {t("tariff.contract.autoUpdate")}
            </label>
          </div>
          {line && (
            // Under the label, past the box. On a phone the button has its own
            // 44 px line, which stands for most of the space before the rule.
            <p
              className={`ml-6.5 sm:ml-6 sm:mt-1 text-caption leading-4.5 text-text-tertiary ${
                canCheck && !error ? "-mb-3 sm:mb-0" : ""
              }`}
            >
              <span data-testid="price-file-status">{statusText(line)}</span>{" "}
              {canCheck && (
                <button
                  type="button"
                  disabled={checking}
                  onClick={() => void check()}
                  className="flex sm:inline-flex items-center gap-1 min-h-11 sm:min-h-0 text-left text-primary hover:text-primary-hover transition-colors disabled:opacity-60"
                >
                  {t("tariff.contract.checkNow")}
                  {checking && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                </button>
              )}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-caption text-error mt-2">
          {error}
        </p>
      )}
    </section>
  );
}
