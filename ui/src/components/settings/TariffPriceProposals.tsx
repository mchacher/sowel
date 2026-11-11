import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, Loader2 } from "lucide-react";
import {
  applyPriceFilePrices,
  dismissPriceFilePrices,
  restoreDismissedPriceFilePrices,
} from "../../api";
import { apiErrorText } from "../../lib/api-error";
import { formatCurrency, formatDay, formatNumber, formatWithUnit } from "../../lib/format";
import type { PriceFileStatus, TariffSupplier } from "../../types";

// Spec 203 (FR5) — the prices the file holds for the contract and that wait
// for a confirmation: listed newest first above the price list, added all at
// once or set aside. Once set aside, one line offers to bring them back.

const TH =
  "sticky top-0 bg-primary-light py-1.5 font-medium border-b border-border whitespace-nowrap";
const TD = "py-2 border-b border-primary/20 text-text";
// A link in a sentence from `sm`; on a phone its own line, 44 px high.
const LINK =
  "flex sm:inline-flex items-center gap-1 min-h-11 sm:min-h-0 text-left text-primary hover:text-primary-hover transition-colors disabled:opacity-60";

type Action = "apply" | "dismiss" | "restore";

export function TariffPriceProposals({
  supplier,
  status,
  onStatus,
  onApplied,
}: {
  /** The contract's supplier, named in the sentence above the table. */
  supplier: TariffSupplier;
  status: PriceFileStatus;
  /** The status after an action: the parent holds it. */
  onStatus: (status: PriceFileStatus) => void;
  /** Prices were added: the price list reads its versions again. */
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action, call: () => Promise<PriceFileStatus>) => {
    setBusy(action);
    setError(null);
    try {
      onStatus(await call());
      if (action === "apply") onApplied();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(null);
    }
  };

  const alert = error && (
    <p role="alert" className="text-caption text-error mt-2">
      {error}
    </p>
  );

  const { pending } = status;

  if (pending.length === 0) {
    if (!status.following || status.dismissedCount === 0) return null;
    return (
      <div className="sm:-mt-2 mb-1 sm:mb-3">
        <p className="text-caption leading-4.5 text-text-tertiary">
          {t("tariff.proposals.dismissed", { count: status.dismissedCount })}{" "}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("restore", restoreDismissedPriceFilePrices)}
            className={LINK}
          >
            {t("tariff.proposals.restore", { count: status.dismissedCount })}
            {busy === "restore" && (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            )}
          </button>
        </p>
        {alert}
      </div>
    );
  }

  const startDates = pending.map((row) => row.startDate);
  // Newest first: the oldest is the last one. Every row is of the contract.
  const oldest = pending[pending.length - 1];
  const base = oldest.contractType === "base";
  const price = (v: number) => formatNumber(v, { decimals: 4 });

  return (
    <div
      data-testid="price-proposals"
      className="mt-2 sm:mt-0 mb-2 sm:mb-4 p-4 rounded-md bg-primary-light border border-primary/20"
    >
      <div className="flex items-start gap-2 mb-3">
        <Info
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-primary"
        />
        <div>
          <h4 className="text-small font-semibold text-text">
            {t("tariff.proposals.title", { count: pending.length })}
          </h4>
          <p
            data-testid="price-proposals-contract"
            className="text-caption leading-4.5 text-text-secondary mt-0.5"
          >
            {t("tariff.proposals.contract", {
              supplier: t(`tariff.proposals.suppliers.${supplier}`),
              type: t(`tariff.proposals.types.${oldest.contractType}`),
              power: formatWithUnit(oldest.kva, "kVA"),
              date: formatDay(oldest.startDate),
            })}
          </p>
        </div>
      </div>

      {/* Four rows high, the header staying in place. */}
      <div className="max-h-44.5 overflow-y-auto pr-1 sm:pr-2 sm:[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-text-tertiary/50">
        <table className="w-full border-separate border-spacing-0 text-small tabular-nums">
          <thead>
            <tr className="text-micro leading-4 uppercase tracking-wide text-text-tertiary">
              <th scope="col" className={`${TH} text-left`}>
                {t("tariff.prices.col.start")}
              </th>
              {base ? (
                <th scope="col" className={`${TH} text-right w-24 sm:w-27.5`}>
                  {t("tariff.prices.col.price")}
                </th>
              ) : (
                <>
                  {/* The short header on a phone, the unit with it from `sm`. */}
                  <th scope="col" className={`${TH} text-right w-14 sm:w-27.5`}>
                    <span className="sm:hidden">{t("tariff.prices.hpShort")}</span>
                    <span className="hidden sm:inline">{t("tariff.prices.col.hp")}</span>
                  </th>
                  <th scope="col" className={`${TH} text-right w-14 sm:w-27.5`}>
                    <span className="sm:hidden">{t("tariff.prices.hcShort")}</span>
                    <span className="hidden sm:inline">{t("tariff.prices.col.hc")}</span>
                  </th>
                </>
              )}
              <th scope="col" className={`${TH} text-right w-23 sm:w-35`}>
                {t("tariff.prices.col.fee")}
              </th>
            </tr>
          </thead>
          <tbody>
            {pending.map((row) => (
              <tr key={row.startDate} data-testid="price-proposal-row">
                <td className={TD}>{formatDay(row.startDate)}</td>
                <td className={`${TD} text-right`}>{price(row.hp)}</td>
                {!base && <td className={`${TD} text-right`}>{price(row.hc)}</td>}
                <td className={`${TD} text-right`}>
                  {t("tariff.prices.feePerYear", { amount: formatCurrency(row.fixedFeeYear) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alert}

      <div className="grid grid-cols-2 gap-2 mt-4 sm:flex">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run("apply", async () => (await applyPriceFilePrices(startDates)).status)
          }
          className="min-h-11 sm:min-h-0 flex items-center justify-center gap-1.5 px-2 sm:px-4 py-1.5 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover disabled:opacity-50 transition-colors"
        >
          {busy === "apply" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {t("tariff.proposals.add", { count: pending.length })}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("dismiss", () => dismissPriceFilePrices(startDates))}
          className="min-h-11 sm:min-h-0 flex items-center justify-center gap-1.5 px-2 sm:px-4 py-1.5 border border-border rounded-sm bg-surface text-text text-small font-medium hover:bg-border-light disabled:opacity-50 transition-colors"
        >
          {busy === "dismiss" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {t("tariff.proposals.dismiss")}
        </button>
      </div>
    </div>
  );
}
