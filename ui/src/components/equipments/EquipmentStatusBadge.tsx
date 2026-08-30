/**
 * EquipmentStatusBadge (spec 116).
 *
 * Renders nothing when status === "online" — silence is success.
 * Otherwise renders a small ambre (degraded) or red (offline) pill with
 * an icon + label and a native HTML tooltip describing the cause.
 */

import { AlertTriangle, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EquipmentStatus, EquipmentStatusReason } from "../../types";
import { formatRelative } from "../../lib/format-relative";

type Size = "sm" | "md";

interface Props {
  status: EquipmentStatus;
  reason?: EquipmentStatusReason;
  size?: Size;
  /** When true, hides the text label (icon only). Used in tight slots. */
  iconOnly?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-[11px] font-medium px-2 py-0.5 gap-1",
  md: "text-[12px] font-medium px-2.5 py-1 gap-1.5",
};

const ICON_SIZE: Record<Size, number> = { sm: 11, md: 13 };


function buildTooltip(
  status: EquipmentStatus,
  reason: EquipmentStatusReason | undefined,
  t: (k: string, params?: Record<string, unknown>) => string,
): string {
  if (!reason) return t(`equipment.status.${status}`);
  const lines: string[] = [t(`equipment.status.${status}`)];
  if (reason.offlineDevices.length > 0) {
    lines.push("");
    lines.push(t("equipment.status.tooltip.offlineDevices", { count: reason.offlineDevices.length }));
    for (const name of reason.offlineDevices) lines.push(`  · ${name}`);
  }
  if (reason.staleBindings.length > 0) {
    lines.push("");
    lines.push(t("equipment.status.tooltip.staleBindings", { count: reason.staleBindings.length }));
    for (const alias of reason.staleBindings) lines.push(`  · ${alias}`);
  }
  if (reason.offlineSince) {
    lines.push("");
    lines.push(
      t("equipment.status.tooltip.since", { when: formatRelative(reason.offlineSince) }),
    );
  }
  return lines.join("\n");
}

export function EquipmentStatusBadge({
  status,
  reason,
  size = "sm",
  iconOnly = false,
  className = "",
}: Props) {
  const { t } = useTranslation();

  if (status === "online") return null;

  const Icon = status === "offline" ? WifiOff : AlertTriangle;
  const colorClasses =
    status === "offline"
      ? "bg-error/10 text-error"
      : "bg-warning/10 text-warning";

  const labelKey = status === "offline" ? "equipment.status.offline" : "equipment.status.degraded";
  const tooltip = buildTooltip(status, reason, t);

  return (
    <span
      className={`inline-flex items-center rounded-full whitespace-nowrap ${SIZE_CLASSES[size]} ${colorClasses} ${className}`}
      role="status"
      aria-label={`${t(labelKey)}${reason?.offlineSince ? ` — ${formatRelative(reason.offlineSince)}` : ""}`}
      title={tooltip}
    >
      <Icon size={ICON_SIZE[size]} strokeWidth={1.75} />
      {!iconOnly && <span>{t(labelKey)}</span>}
    </span>
  );
}
