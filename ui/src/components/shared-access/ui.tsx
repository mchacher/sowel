/* eslint-disable react-refresh/only-export-components -- small shared kit: class names and helpers beside the components */
import { useCallback, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { SharedAccessStatus } from "../../types";

// ============================================================
// Spec 181 — the few pieces every shared-access screen shares, in Sowel's
// own visual language (Settings forms, MFA modals, mode switches).
// ============================================================

export const inputCls =
  "px-3 py-2 text-[14px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary disabled:opacity-50";
export const inputBadCls =
  "px-3 py-2 text-[14px] bg-background border border-error rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none";
export const labelCls = "block text-[12px] text-text-tertiary uppercase tracking-widest mb-1";
export const btnPrimary =
  "px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default";
export const btnSecondary =
  "px-3 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default";
export const btnDanger =
  "px-3 py-2 text-[13px] font-medium text-error border border-error/40 rounded-[6px] hover:bg-error/10 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default";
export const iconBtn =
  "p-1.5 rounded-[6px] text-text-tertiary hover:text-text hover:bg-border-light transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-default";

/** A server refusal code (`{ error }` of a 4xx), in words. */
export function useRefusalText(): (code: string) => string {
  const { t } = useTranslation();
  return useCallback(
    (code: string) =>
      t(`sharedAccess.error.${code}`, {
        defaultValue: t("sharedAccess.error.generic", { code }),
      }),
    [t],
  );
}

export function errorCode(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A refusal shown next to the control it is about. */
export function Refusal({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[12.5px] text-error bg-error/10 rounded-[6px] px-2.5 py-1.5 mt-2">
      {children}
    </p>
  );
}

/**
 * The modal shell. The card carries `m-auto` on purpose: Tailwind's preflight
 * zeroes every margin, and a dialog that relied on the browser's own
 * `margin: auto` ended up pinned to the top-left corner. The flex overlay
 * centres it as well; `m-auto` keeps it centred if the overlay ever scrolls.
 */
export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/50 p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`m-auto bg-surface rounded-[14px] border border-border p-4 sm:p-6 w-full ${
          wide ? "max-w-[640px]" : "max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-[16px] font-semibold text-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className={`${iconBtn} ml-auto`}
            aria-label={t("common.close")}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The on/off switch Sowel uses for modes. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className="relative w-9 h-5 rounded-full transition-colors duration-200 disabled:opacity-50 flex-shrink-0 cursor-pointer disabled:cursor-default"
      style={{ backgroundColor: checked ? "var(--color-success)" : "var(--color-border)" }}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className="absolute top-[3px] left-[3px] w-[14px] h-[14px] bg-white rounded-full shadow-sm transition-transform duration-200"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

/** Two choices side by side (« Tout le temps » / « Du … au … »). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex border border-border rounded-[6px] overflow-hidden">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-[13px] transition-colors cursor-pointer disabled:cursor-default ${
            i > 0 ? "border-l border-border" : ""
          } ${
            value === o.value
              ? "bg-primary-light text-primary font-semibold"
              : "bg-surface text-text-secondary hover:bg-border-light"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_CLS: Record<SharedAccessStatus, string> = {
  live: "bg-success/15 text-success",
  outside_hours: "bg-warning/15 text-warning",
  not_yet: "bg-primary-light text-primary",
  ended: "bg-border-light text-text-tertiary",
  suspended: "bg-warning/15 text-warning",
  revoked: "bg-border-light text-text-tertiary",
  no_gate: "bg-error/10 text-error",
};

export function StatusBadge({ status }: { status: SharedAccessStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`text-[11.5px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_CLS[status]}`}
    >
      {t(`sharedAccess.status.${status}`)}
    </span>
  );
}

/** What a press sends, in words (`open` → « ouvrir »); unknown values stay raw. */
export function useValueLabel(): (value: string) => string {
  const { t } = useTranslation();
  return (value: string) => t(`sharedAccess.value.${value}`, { defaultValue: value });
}
