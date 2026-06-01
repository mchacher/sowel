import { useTranslation } from "react-i18next";
import { Monitor, Wifi, Tag, Clock, Languages, Sun } from "lucide-react";
import type {
  DataBindingWithValue,
  OrderBindingWithDetails,
  DataCategory,
  OrderCategory,
} from "../../types";

interface DisplayPanelProps {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
  equipmentId: string;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

const ROW_ORDER: DataCategory[] = [
  "firmware_version",
  "uptime",
  "rssi",
  "language",
  "display_brightness",
];

function formatUptime(secs: number): string {
  if (secs < 60) return `${Math.floor(secs)} s`;
  if (secs < 3600) return `${Math.floor(secs / 60)} min`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return h === 0 ? `${d} j` : `${d} j ${h} h`;
}

function iconFor(category: DataCategory) {
  switch (category) {
    case "firmware_version":
      return <Tag size={16} strokeWidth={1.5} className="text-text-tertiary" />;
    case "uptime":
      return <Clock size={16} strokeWidth={1.5} className="text-text-tertiary" />;
    case "rssi":
      return <Wifi size={16} strokeWidth={1.5} className="text-text-tertiary" />;
    case "language":
      return <Languages size={16} strokeWidth={1.5} className="text-text-tertiary" />;
    case "display_brightness":
      return <Sun size={16} strokeWidth={1.5} className="text-text-tertiary" />;
    default:
      return <Monitor size={16} strokeWidth={1.5} className="text-text-tertiary" />;
  }
}

function formatValue(category: DataCategory, value: unknown): string {
  if (value === null || value === undefined) return "—";
  switch (category) {
    case "uptime":
      return typeof value === "number" ? formatUptime(value) : String(value);
    case "rssi":
      return typeof value === "number" ? `${value} dBm` : String(value);
    case "display_brightness":
      return typeof value === "number" ? `${value} %` : String(value);
    default:
      return String(value);
  }
}

export function DisplayPanel({
  dataBindings,
  orderBindings,
  onExecuteOrder,
}: DisplayPanelProps) {
  const { t } = useTranslation();

  // Index bindings by category. A category may have multiple bindings (e.g.
  // two displays merged into one equipment) — we render the first match, which
  // matches the canonical 1-display-per-equipment convention.
  const dataByCategory = new Map<DataCategory, DataBindingWithValue>();
  for (const b of dataBindings) {
    if (!dataByCategory.has(b.category)) dataByCategory.set(b.category, b);
  }

  const orderByCategory = new Map<OrderCategory, OrderBindingWithDetails>();
  for (const o of orderBindings) {
    if (o.category && !orderByCategory.has(o.category)) {
      orderByCategory.set(o.category, o);
    }
  }

  const visibleRows = ROW_ORDER.filter((c) => dataByCategory.has(c));
  if (visibleRows.length === 0) {
    return (
      <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
        <h3 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-2">
          <Monitor size={16} strokeWidth={1.5} className="text-text-tertiary" />
          {t("displays.panel.title")}
        </h3>
        <p className="text-[13px] text-text-tertiary">{t("displays.panel.noData")}</p>
      </div>
    );
  }

  const brightnessOrder = orderByCategory.get("set_display_brightness");
  const languageOrder = orderByCategory.get("set_language");
  const languageBinding = dataByCategory.get("language");
  const brightnessBinding = dataByCategory.get("display_brightness");

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <h3 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-4">
        <Monitor size={16} strokeWidth={1.5} className="text-text-tertiary" />
        {t("displays.panel.title")}
      </h3>

      <div className="divide-y divide-border-light">
        {visibleRows.map((category) => {
          const binding = dataByCategory.get(category);
          if (!binding) return null;
          const isInteractive =
            (category === "language" && languageOrder) ||
            (category === "display_brightness" && brightnessOrder);

          return (
            <div
              key={category}
              className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
            >
              {iconFor(category)}
              <span className="flex-1 text-[13px] text-text">
                {t(`displays.fields.${category}`)}
              </span>
              {!isInteractive && (
                <span className="text-[13px] font-mono text-text-secondary">
                  {formatValue(category, binding.value)}
                </span>
              )}
              {category === "language" && languageBinding && languageOrder && (
                <select
                  className="text-[13px] bg-bg border border-border rounded-[6px] px-2 py-1"
                  value={String(languageBinding.value ?? "")}
                  onChange={(e) =>
                    onExecuteOrder(languageOrder.alias, e.target.value)
                  }
                >
                  <option value="fr">FR</option>
                  <option value="en">EN</option>
                </select>
              )}
              {category === "display_brightness" &&
                brightnessBinding &&
                brightnessOrder && (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={5}
                      max={100}
                      step={5}
                      value={Number(brightnessBinding.value ?? 0)}
                      onChange={(e) =>
                        onExecuteOrder(brightnessOrder.alias, Number(e.target.value))
                      }
                      className="w-24"
                    />
                    <span className="text-[13px] font-mono text-text-secondary w-12 text-right">
                      {formatValue(category, brightnessBinding.value)}
                    </span>
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
