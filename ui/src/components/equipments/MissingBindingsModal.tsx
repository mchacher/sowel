import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, LineChart } from "lucide-react";
import type { DataBindingWithValue, OrderBindingWithDetails } from "../../types";
import {
  applyBindingPlan,
  computeMissingBindings,
  fetchDevices,
  type PlannedBinding,
} from "./bindingUtils";

interface MissingBindingsModalProps {
  equipmentId: string;
  equipmentType: string;
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
  onClose: () => void;
  /** Called after bindings were added, so the page can reload. */
  onAdded: () => void;
}

/**
 * Issue #707 — offer the data points a plugin started publishing after this
 * equipment was bound.
 *
 * Everything is proposed checked, because the common case is "the plugin added
 * these, I want them". Unchecking is what keeps the owner in control: nothing
 * here is applied without the confirm, so Sowel never puts back something that
 * was removed on purpose.
 */
export function MissingBindingsModal({
  equipmentId,
  equipmentType,
  dataBindings,
  orderBindings,
  onClose,
  onAdded,
}: MissingBindingsModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState<PlannedBinding[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Computed once, when the modal opens.
  //
  // The bindings arrive as a fresh array on every value update of this
  // equipment (the page refetches on each one), so an effect keyed on their
  // identity would re-run every few seconds behind an open modal: it would
  // re-issue a GET per backing device, and — worse — re-check the boxes the
  // owner had just unchecked, then bind them on confirm. What is on offer
  // cannot change while the modal is open anyway.
  useEffect(() => {
    let cancelled = false;
    const deviceIds = [
      ...new Set([
        ...dataBindings.map((b) => b.deviceId),
        ...orderBindings.map((b) => b.deviceId),
      ]),
    ];
    fetchDevices(deviceIds)
      .then((devices) => {
        if (cancelled) return;
        const found = computeMissingBindings(
          devices,
          equipmentType,
          dataBindings,
          orderBindings,
        );
        setMissing(found);
        setSelected(new Set(found.map((m) => m.sourceId)));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("binding.loadError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (sourceId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const chosen = missing.filter((m) => selected.has(m.sourceId));
  const historizedCount = chosen.filter((m) => m.historized).length;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { added, failed } = await applyBindingPlan(equipmentId, chosen);
      // Nothing landed: stay open and say so rather than closing on a success
      // the owner never got.
      if (added === 0 && failed.length > 0) {
        setError(t("binding.missingFailed", { aliases: failed.join(", ") }));
        setSubmitting(false);
        return;
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("binding.loadError"));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-[14px] border border-border shadow-xl w-full max-w-[520px] mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h2 className="text-[16px] font-semibold text-text">{t("binding.missingTitle")}</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[4px] hover:bg-border-light"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : missing.length === 0 ? (
            <p className="text-[13px] text-text-secondary py-4">{t("binding.missingNone")}</p>
          ) : (
            <>
              <p className="text-[13px] text-text-secondary">
                {t("binding.missingIntro", { count: missing.length })}
              </p>
              <div className="space-y-1">
                {missing.map((item) => (
                  <label
                    key={item.sourceId}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] bg-border-light/50 hover:bg-border-light transition-colors duration-150 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.sourceId)}
                      onChange={() => toggle(item.sourceId)}
                      className="accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-[12px] font-medium ${
                            item.kind === "data" ? "text-primary" : "text-accent"
                          }`}
                        >
                          {item.alias}
                        </span>
                        {item.category && (
                          <span className="text-[11px] text-text-tertiary">({item.category})</span>
                        )}
                      </div>
                      <div className="text-[11px] text-text-tertiary truncate">
                        {item.deviceName} · {item.key}
                      </div>
                    </div>
                    {item.historized && (
                      <span
                        title={t("binding.missingHistorizedHint")}
                        className="flex items-center gap-1 text-[11px] text-text-tertiary flex-shrink-0"
                      >
                        <LineChart size={12} strokeWidth={1.5} />
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {historizedCount > 0 && (
                <p className="flex items-start gap-1.5 text-[12px] text-text-tertiary">
                  <LineChart size={13} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" />
                  {t("binding.missingHistorized", { count: historizedCount })}
                </p>
              )}
            </>
          )}
          {error && <p className="text-[13px] text-error">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-light">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-text-secondary hover:text-text rounded-[6px] hover:bg-border-light"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || chosen.length === 0}
            className="px-3 py-1.5 text-[13px] font-medium text-white bg-primary hover:bg-primary-hover rounded-[6px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              t("binding.missingConfirm", { count: chosen.length })
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
