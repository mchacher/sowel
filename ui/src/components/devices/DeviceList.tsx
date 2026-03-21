import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { Device, DeviceData } from "../../types";
import { sourceLabel } from "../../lib/format";
import { RelativeTime } from "../RelativeTime";
import {
  Radio,
  Battery,
  BatteryLow,
  BatteryWarning,
  Signal,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

interface DeviceListProps {
  devices: Device[];
  deviceData: Record<string, DeviceData[]>;
  /** Active integration tab (null = all devices). Controls which columns are shown. */
  activeTab: string | null;
}

type SortKey =
  | "status"
  | "name"
  | "manufacturer"
  | "model"
  | "source"
  | "battery"
  | "lqi"
  | "lastSeen";
type SortDir = "asc" | "desc";

function getNumericDataValue(
  deviceData: Record<string, DeviceData[]>,
  deviceId: string,
  match: (d: DeviceData) => boolean
): number | null {
  const data = deviceData[deviceId] ?? [];
  const found = data.find(match);
  if (!found || found.value === null || found.value === undefined) return null;
  const n = typeof found.value === "number" ? found.value : Number(found.value);
  return isNaN(n) ? null : n;
}

function compareSortKey(
  a: Device,
  b: Device,
  key: SortKey,
  dir: SortDir,
  deviceData: Record<string, DeviceData[]>
): number {
  const mul = dir === "asc" ? 1 : -1;

  switch (key) {
    case "status": {
      const order = { online: 0, offline: 1, unknown: 2 };
      return mul * ((order[a.status] ?? 2) - (order[b.status] ?? 2));
    }
    case "name":
      return mul * a.name.localeCompare(b.name);
    case "manufacturer":
      return mul * (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "");
    case "model":
      return mul * (a.model ?? "").localeCompare(b.model ?? "");
    case "source":
      return mul * a.source.localeCompare(b.source);
    case "battery": {
      const ba = getNumericDataValue(deviceData, a.id, (d) => d.category === "battery");
      const bb = getNumericDataValue(deviceData, b.id, (d) => d.category === "battery");
      if (ba === null && bb === null) return 0;
      if (ba === null) return 1;
      if (bb === null) return -1;
      return mul * (ba - bb);
    }
    case "lqi": {
      const la = getNumericDataValue(deviceData, a.id, (d) => d.key === "linkquality");
      const lb = getNumericDataValue(deviceData, b.id, (d) => d.key === "linkquality");
      if (la === null && lb === null) return 0;
      if (la === null) return 1;
      if (lb === null) return -1;
      return mul * (la - lb);
    }
    case "lastSeen": {
      const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return mul * (ta - tb);
    }
    default:
      return 0;
  }
}

export function DeviceList({ devices, deviceData, activeTab }: DeviceListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const showSource = activeTab === null;
  const showRadioColumns = activeTab === null || activeTab === "zigbee2mqtt";

  if (devices.length === 0) {
    return <EmptyState />;
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = [...devices].sort((a, b) =>
    compareSortKey(a, b, sortKey, sortDir, deviceData)
  );

  return (
    <div className="bg-surface rounded-[10px] border border-border overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-border-light/40">
            <SortHeader
              label=""
              sortKey="status"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              className="w-[42px]"
            />
            <SortHeader
              label={t("devices.col.name")}
              sortKey="name"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              align="left"
            />
            <SortHeader
              label={t("devices.col.manufacturer")}
              sortKey="manufacturer"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              align="left"
              className="hidden lg:table-cell"
            />
            <SortHeader
              label={t("devices.col.model")}
              sortKey="model"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              align="left"
              className="hidden md:table-cell"
            />
            {showSource && (
              <SortHeader
                label={t("devices.col.source")}
                sortKey="source"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                align="left"
                className="hidden sm:table-cell"
              />
            )}
            {showRadioColumns && (
              <SortHeader
                label={t("devices.col.battery")}
                sortKey="battery"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                align="center"
                className="hidden md:table-cell"
              />
            )}
            {showRadioColumns && (
              <SortHeader
                label={t("devices.col.lqi")}
                sortKey="lqi"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                align="center"
                className="hidden lg:table-cell"
              />
            )}
            <SortHeader
              label={t("devices.col.lastSeen")}
              sortKey="lastSeen"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              align="right"
              className="hidden sm:table-cell"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((device) => {
            const data = deviceData[device.id] ?? [];
            const battery = data.find((d) => d.category === "battery");
            const lqi = data.find((d) => d.key === "linkquality");

            return (
              <tr
                key={device.id}
                onClick={() => navigate(`/devices/${device.id}`)}
                className="border-b border-border-light last:border-b-0 cursor-pointer hover:bg-primary-light/40 transition-colors duration-100"
              >
                <td className="py-2.5 px-3 text-center">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      device.status === "online"
                        ? "bg-success"
                        : device.status === "offline"
                          ? "bg-error"
                          : "bg-text-tertiary"
                    }`}
                  />
                </td>
                <td className="py-2.5 px-3">
                  <span className="text-[13px] font-medium text-text">{device.name}</span>
                </td>
                <td className="py-2.5 px-3 hidden lg:table-cell">
                  <span className="text-[12px] text-text-secondary truncate block max-w-[160px]">
                    {device.manufacturer ?? "—"}
                  </span>
                </td>
                <td className="py-2.5 px-3 hidden md:table-cell">
                  <span className="text-[12px] text-text-secondary truncate block max-w-[180px]">
                    {device.model ?? "—"}
                  </span>
                </td>
                {showSource && (
                  <td className="py-2.5 px-3 hidden sm:table-cell">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-border-light text-[10px] font-semibold text-text-secondary uppercase tracking-wide">
                      {sourceLabel(device.source)}
                    </span>
                  </td>
                )}
                {showRadioColumns && (
                  <td className="py-2.5 px-3 text-center hidden md:table-cell">
                    <BatteryCell value={battery?.value} />
                  </td>
                )}
                {showRadioColumns && (
                  <td className="py-2.5 px-3 text-center hidden lg:table-cell">
                    <LqiCell value={lqi?.value} />
                  </td>
                )}
                <td className="py-2.5 px-3 text-right hidden sm:table-cell">
                  <span className="text-[11px] text-text-tertiary">
                    <RelativeTime iso={device.lastSeen} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const isActive = currentKey === sortKey;
  const alignClass =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";

  return (
    <th
      className={`py-2 px-3 cursor-pointer select-none group ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-1 ${alignClass}`}>
        <span
          className={`text-[11px] font-semibold uppercase tracking-wider ${
            isActive ? "text-primary" : "text-text-tertiary group-hover:text-text-secondary"
          } transition-colors duration-100`}
        >
          {label}
        </span>
        {isActive && (
          currentDir === "asc" ? (
            <ArrowUp size={11} strokeWidth={2} className="text-primary" />
          ) : (
            <ArrowDown size={11} strokeWidth={2} className="text-primary" />
          )
        )}
      </span>
    </th>
  );
}

function BatteryCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-[11px] text-text-tertiary">—</span>;
  }

  const level = typeof value === "number" ? value : Number(value);
  if (isNaN(level)) return <span className="text-[11px] text-text-tertiary">—</span>;

  const Icon = level <= 15 ? BatteryLow : level <= 30 ? BatteryWarning : Battery;
  const color =
    level <= 15
      ? "text-error"
      : level <= 30
        ? "text-warning"
        : "text-text-secondary";

  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Icon size={14} strokeWidth={1.5} />
      <span className="text-[11px] font-mono">{level}%</span>
    </span>
  );
}

function LqiCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-[11px] text-text-tertiary">—</span>;
  }

  const lqi = typeof value === "number" ? value : Number(value);
  if (isNaN(lqi)) return <span className="text-[11px] text-text-tertiary">—</span>;

  // Zigbee LQI range: 0–255. <75 = poor, <150 = fair, ≥150 = good
  const color =
    lqi < 75
      ? "text-error"
      : lqi < 150
        ? "text-warning"
        : "text-text-secondary";

  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Signal size={13} strokeWidth={1.5} />
      <span className="text-[11px] font-mono">{lqi}</span>
    </span>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-border-light flex items-center justify-center mb-4">
        <Radio size={28} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">{t("devices.empty.title")}</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px]">
        {t("devices.empty.message")}
      </p>
    </div>
  );
}
