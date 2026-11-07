import { useTranslation } from "react-i18next";
import type { DeviceData } from "../../types";
import { formatDataValue } from "../../lib/format";
import { RelativeTime } from "../RelativeTime";

interface DeviceDataTableProps {
  data: DeviceData[];
}

export function DeviceDataTable({ data }: DeviceDataTableProps) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <p className="text-small text-text-tertiary italic py-4">
        {t("devices.noData")}
      </p>
    );
  }

  // Sort by category, then by key
  const sorted = [...data].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.key.localeCompare(b.key);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2.5 px-3 text-caption font-semibold uppercase tracking-[0.04em] text-text-tertiary">
              {t("devices.col.key")}
            </th>
            <th className="text-left py-2.5 px-3 text-caption font-semibold uppercase tracking-[0.04em] text-text-tertiary">
              {t("devices.col.category")}
            </th>
            <th className="text-right py-2.5 px-3 text-caption font-semibold uppercase tracking-[0.04em] text-text-tertiary">
              {t("devices.col.value")}
            </th>
            <th className="text-right py-2.5 px-3 text-caption font-semibold uppercase tracking-[0.04em] text-text-tertiary">
              {t("devices.col.updated")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr
              key={d.id}
              className="border-b border-border-light hover:bg-border-light/50 transition-colors duration-100"
            >
              <td className="py-2.5 px-3">
                <span className="font-mono text-small text-text">{d.key}</span>
              </td>
              <td className="py-2.5 px-3">
                <CategoryBadge category={d.category} />
              </td>
              <td className="py-2.5 px-3 text-right">
                <DataValueCell value={d.value} unit={d.unit} type={d.type} />
              </td>
              <td className="py-2.5 px-3 text-right">
                <span className="text-caption text-text-tertiary">
                  <RelativeTime iso={d.lastUpdated} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const { t } = useTranslation();
  const colorClass = getCategoryColor(category);

  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-full text-micro font-medium
        ${colorClass}
      `}
    >
      {t(`category.${category}`, { defaultValue: category })}
    </span>
  );
}

function DataValueCell({
  value,
  unit,
  type,
}: {
  value: unknown;
  unit?: string;
  type: string;
}) {
  const { t } = useTranslation();

  if (value === null || value === undefined) {
    return <span className="text-small text-text-tertiary">—</span>;
  }

  // Boolean states get colored badges
  if (type === "boolean") {
    const isOn = value === true || value === "true" || value === "ON";
    return (
      <span
        className={`
          inline-flex items-center px-2 py-0.5 rounded-full text-micro font-semibold
          ${isOn ? "bg-success/10 text-success" : "bg-border-light text-text-tertiary"}
        `}
      >
        {isOn ? t("common.on") : t("common.off")}
      </span>
    );
  }

  return (
    <span className="tabular-nums text-small text-text">
      {formatDataValue(value, unit)}
    </span>
  );
}

function getCategoryColor(category: string): string {
  const map: Record<string, string> = {
    temperature: "bg-border-light text-text-secondary",
    humidity: "bg-info/10 text-info",
    motion: "bg-primary/10 text-primary",
    light_state: "bg-active-bg text-active-ink",
    light_brightness: "bg-active-bg text-active-ink",
    battery: "bg-success/10 text-success",
    power: "bg-primary/10 text-primary",
    energy: "bg-primary/10 text-primary",
    contact_door: "bg-info/10 text-info",
    contact_window: "bg-info/10 text-info",
    water_leak: "bg-error/10 text-error",
    smoke: "bg-error/10 text-error",
  };
  return map[category] ?? "bg-border-light text-text-secondary";
}
