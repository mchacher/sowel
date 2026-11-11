import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { getTariffContract, saveTariffContract } from "../../api";
import { apiErrorText } from "../../lib/api-error";
import { formatWithUnit } from "../../lib/format";
import type { TariffContract, TariffContractType, TariffSupplier } from "../../types";

// Spec 202 (FR4, FR6) — the current contract: supplier, type and subscribed
// power, saved on change. The supplier has no effect yet (the price file lot
// will match its rows on it); the type decides whether the price form asks for
// one price or two, and the power pre-fills a new price change.

const SUPPLIERS: TariffSupplier[] = ["edf-tarif-bleu", "other"];
const CONTRACT_TYPES: TariffContractType[] = ["hphc", "base"];
/** The powers a French residential contract can subscribe, kVA. */
const POWERS_KVA = [3, 6, 9, 12, 15, 18, 24, 30, 36];

const LABEL = "block text-caption text-text-secondary mb-1";
// 44 px high with 16 px text on a phone (no zoom on focus), 34 px and 13 px from `sm`.
const SELECT =
  "w-full h-11 sm:h-8.5 px-3 sm:px-2.5 border border-border rounded-sm bg-surface text-text text-lead sm:text-small disabled:opacity-60";

export function TariffContractBlock({
  onContract,
}: {
  /**
   * The contract as read, then after each save: the price block follows it.
   * Pass a stable function (a state setter): a new one reads the contract again.
   */
  onContract: (contract: TariffContract) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [contract, setContract] = useState<TariffContract | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTariffContract()
      .then((c) => {
        if (cancelled) return;
        setContract(c);
        onContract(c);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorText(err, t));
      });
    return () => {
      cancelled = true;
    };
  }, [onContract, t]);

  const change = async (patch: Partial<TariffContract>) => {
    if (!contract) return;
    const previous = contract;
    const next = { ...contract, ...patch };
    setContract(next);
    setSaving(true);
    setError(null);
    try {
      const stored = await saveTariffContract(next);
      setContract(stored);
      onContract(stored);
    } catch (err) {
      setContract(previous);
      setError(apiErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  const disabled = contract === null || saving;
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
      {error && (
        <p role="alert" className="text-caption text-error mt-2">
          {error}
        </p>
      )}
    </section>
  );
}
