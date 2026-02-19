import type { DeviceData } from "../../types";
import { formatDataValue, formatRelativeTime, categoryLabel } from "../../lib/format";

interface DeviceDataTableProps {
  data: DeviceData[];
}

export function DeviceDataTable({ data }: DeviceDataTableProps) {
  if (data.length === 0) {
    return (
      <p className="text-[13px] text-text-tertiary italic py-4">
        No data points available.
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
            <th className="text-left py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
              Key
            </th>
            <th className="text-left py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
              Category
            </th>
            <th className="text-right py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
              Value
            </th>
            <th className="text-right py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
              Updated
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
                <span className="font-mono text-[13px] text-text">{d.key}</span>
              </td>
              <td className="py-2.5 px-3">
                <CategoryBadge category={d.category} />
              </td>
              <td className="py-2.5 px-3 text-right">
                <DataValueCell value={d.value} unit={d.unit} type={d.type} />
              </td>
              <td className="py-2.5 px-3 text-right">
                <span className="text-[12px] text-text-tertiary">
                  {formatRelativeTime(d.lastUpdated)}
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
  const colorClass = getCategoryColor(category);

  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium
        ${colorClass}
      `}
    >
      {categoryLabel(category)}
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
  if (value === null || value === undefined) {
    return <span className="text-[13px] text-text-tertiary">—</span>;
  }

  // Boolean states get colored badges
  if (type === "boolean") {
    const isOn = value === true || value === "true" || value === "ON";
    return (
      <span
        className={`
          inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold
          ${isOn ? "bg-success/10 text-success" : "bg-border-light text-text-tertiary"}
        `}
      >
        {isOn ? "ON" : "OFF"}
      </span>
    );
  }

  return (
    <span className="font-mono text-[13px] text-text">
      {formatDataValue(value, unit)}
    </span>
  );
}

function getCategoryColor(category: string): string {
  const map: Record<string, string> = {
    temperature: "bg-accent/10 text-accent",
    humidity: "bg-info/10 text-info",
    motion: "bg-motion/10 text-motion",
    light_state: "bg-warning/10 text-warning",
    light_brightness: "bg-warning/10 text-warning",
    battery: "bg-success/10 text-success",
    power: "bg-accent/10 text-accent",
    energy: "bg-accent/10 text-accent",
    contact_door: "bg-info/10 text-info",
    contact_window: "bg-info/10 text-info",
    water_leak: "bg-error/10 text-error",
    smoke: "bg-error/10 text-error",
  };
  return map[category] ?? "bg-border-light text-text-secondary";
}
