import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Radio, Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import type { DataCategory, EquipmentType } from "../../types";
import { getDevices, type DeviceWithData } from "../../api";

/** Maps EquipmentType to required DataCategories for filtering. */
const EQUIPMENT_TYPE_CATEGORIES: Partial<Record<EquipmentType, DataCategory[]>> = {
  light_onoff: ["light_state"],
  light_dimmable: ["light_state", "light_brightness"],
  light_color: ["light_state", "light_brightness", "light_color"],
  shutter: ["shutter_position"],
  switch: ["light_state"],
  sensor: ["temperature", "humidity", "pressure", "luminosity", "co2", "voc", "motion", "contact_door", "contact_window", "water_leak", "smoke"],
  button: ["action"],
};

interface DeviceSelectorProps {
  equipmentType: EquipmentType;
  selectedDeviceIds: string[];
  onSelectionChange: (deviceIds: string[]) => void;
  /** Device IDs already bound to other equipments — excluded from the list. */
  boundDeviceIds?: Set<string>;
}

export function DeviceSelector({
  equipmentType,
  selectedDeviceIds,
  onSelectionChange,
  boundDeviceIds,
}: DeviceSelectorProps) {
  const { t } = useTranslation();
  const [allDevices, setAllDevices] = useState<DeviceWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- loading state before async fetch
    getDevices()
      .then((all) => {
        setAllDevices(all);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  // Exclude devices already bound to other equipments
  const availableDevices = boundDeviceIds
    ? allDevices.filter((d) => !boundDeviceIds.has(d.id))
    : allDevices;

  const categories = EQUIPMENT_TYPE_CATEGORIES[equipmentType];
  const compatible = categories && categories.length > 0
    ? availableDevices.filter((device) =>
        device.data.some((d) => categories.includes(d.category))
      )
    : availableDevices;

  const baseDevices = showAll ? availableDevices : compatible;
  const filterLower = filter.toLowerCase();
  const devices = filterLower
    ? baseDevices.filter((d) => d.name.toLowerCase().includes(filterLower))
    : baseDevices;

  const toggleDevice = (deviceId: string) => {
    if (selectedDeviceIds.includes(deviceId)) {
      onSelectionChange(selectedDeviceIds.filter((id) => id !== deviceId));
    } else {
      onSelectionChange([...selectedDeviceIds, deviceId]);
    }
  };

  if (loading) {
    return <p className="text-[13px] text-text-tertiary py-4">{t("deviceSelector.loading")}</p>;
  }

  if (allDevices.length === 0) {
    return (
      <p className="text-[13px] text-text-tertiary py-4">
        {t("deviceSelector.noDevices")}
      </p>
    );
  }

  return (
    <div>
      {/* Show all toggle when filter is active and hides some devices */}
      {compatible.length < availableDevices.length && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] text-text-tertiary">
            {t("deviceSelector.compatible", { count: compatible.length, total: availableDevices.length })}
          </span>
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-[12px] text-primary hover:underline"
          >
            {showAll ? t("deviceSelector.showCompatible") : t("deviceSelector.showAll")}
          </button>
        </div>
      )}

      {/* Filter by name */}
      <div className="relative mb-2">
        <Search size={14} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("devices.filterPlaceholder")}
          className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
        />
      </div>

      {devices.length === 0 ? (
        <p className="text-[13px] text-text-tertiary py-4">
          {t("deviceSelector.noCompatible")}
        </p>
      ) : (
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {devices.map((device) => {
            const isSelected = selectedDeviceIds.includes(device.id);
            const isExpanded = expandedDevice === device.id;
            const isCompatible = compatible.includes(device);

            return (
              <div key={device.id}>
                <div
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-[6px] cursor-pointer
                    transition-colors duration-150
                    ${isSelected ? "bg-primary-light border border-primary/30" : "bg-border-light/50 hover:bg-border-light border border-transparent"}
                  `}
                  onClick={() => toggleDevice(device.id)}
                >
                  <div
                    className={`
                      flex-shrink-0 w-5 h-5 rounded-[4px] border flex items-center justify-center
                      ${isSelected ? "bg-primary border-primary text-white" : "border-border bg-surface"}
                    `}
                  >
                    {isSelected && <Check size={12} strokeWidth={2} />}
                  </div>
                  <Radio size={16} strokeWidth={1.5} className="text-text-tertiary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] font-medium ${isCompatible ? "text-text" : "text-text-secondary"}`}>
                      {device.name}
                    </span>
                    {device.manufacturer && (
                      <span className="text-[11px] text-text-tertiary ml-2">
                        {device.manufacturer} {device.model ?? ""}
                      </span>
                    )}
                  </div>
                  <div
                    className={`
                      w-2 h-2 rounded-full flex-shrink-0
                      ${device.status === "online" ? "bg-success" : device.status === "offline" ? "bg-error" : "bg-text-tertiary"}
                    `}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDevice(isExpanded ? null : device.id);
                    }}
                    className="p-1 text-text-tertiary hover:text-text-secondary"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {/* Device data details */}
                {isExpanded && (
                  <div className="ml-11 mt-1 mb-2 text-[11px] text-text-tertiary space-y-0.5">
                    {device.data.map((d) => (
                      <div key={d.id} className="flex items-center gap-2">
                        <span className="font-mono">{d.key}</span>
                        <span className="text-text-tertiary">({d.category})</span>
                        <span className="text-text-secondary">
                          {d.value !== null && d.value !== undefined ? String(d.value) : "—"}
                        </span>
                        {d.unit && <span>{d.unit}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { EQUIPMENT_TYPE_CATEGORIES };
