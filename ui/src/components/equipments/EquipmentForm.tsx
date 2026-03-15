import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { EquipmentType, ZoneWithChildren } from "../../types";
import { DeviceSelector } from "./DeviceSelector";

const EQUIPMENT_TYPE_KEYS: { value: EquipmentType; labelKey: string }[] = [
  { value: "light_onoff", labelKey: "equipments.type.light_onoff" },
  { value: "light_dimmable", labelKey: "equipments.type.light_dimmable" },
  { value: "light_color", labelKey: "equipments.type.light_color" },
  { value: "shutter", labelKey: "equipments.type.shutter" },
  { value: "switch", labelKey: "equipments.type.switch" },
  { value: "sensor", labelKey: "equipments.type.sensor" },
  { value: "button", labelKey: "equipments.type.button" },
  { value: "thermostat", labelKey: "equipments.type.thermostat" },
  { value: "weather", labelKey: "equipments.type.weather" },
  { value: "gate", labelKey: "equipments.type.gate" },
  { value: "heater", labelKey: "equipments.type.heater" },
  { value: "energy_meter", labelKey: "equipments.type.energy_meter" },
  { value: "main_energy_meter", labelKey: "equipments.type.main_energy_meter" },
  { value: "energy_production_meter", labelKey: "equipments.type.energy_production_meter" },
];

interface EquipmentFormProps {
  title: string;
  initial?: {
    name: string;
    type: EquipmentType;
    zoneId: string;
  };
  defaultZoneId?: string;
  zones: ZoneWithChildren[];
  onSubmit: (data: {
    name: string;
    type: EquipmentType;
    zoneId: string;
    selectedDeviceIds: string[];
  }) => Promise<void>;
  onClose: () => void;
  boundDeviceIds?: Set<string>;
  /** Equipment types to exclude from the type selector (e.g. singleton types already created). */
  excludeTypes?: Set<EquipmentType>;
}

export function EquipmentForm({ title, initial, defaultZoneId, zones, onSubmit, onClose, boundDeviceIds, excludeTypes }: EquipmentFormProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"info" | "devices">("info");
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<EquipmentType>(initial?.type ?? "light_onoff");
  const [zoneId, setZoneId] = useState(initial?.zoneId ?? defaultZoneId ?? "");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flatZones = flattenZones(zones);
  const availableTypes = excludeTypes
    ? EQUIPMENT_TYPE_KEYS.filter((et) => !excludeTypes.has(et.value))
    : EQUIPMENT_TYPE_KEYS;
  const sortedTypes = [...availableTypes].sort((a, b) =>
    t(a.labelKey).localeCompare(t(b.labelKey)),
  );

  const handleCreate = async () => {
    if (!name.trim() || !zoneId || saving) return;

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        type,
        zoneId,
        selectedDeviceIds,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div
        className="bg-surface rounded-[14px] border border-border shadow-xl w-full max-w-[520px] mx-4 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light flex-shrink-0">
          <h2 className="text-[16px] font-semibold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary transition-colors">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Form */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {step === "info" && (
              <>
                {/* Type */}
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                    {t("equipments.form.type")}
                  </label>
                  <select
                    value={type}
                    onChange={(e) => {
                      setType(e.target.value as EquipmentType);
                      setSelectedDeviceIds([]);
                    }}
                    className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none focus:border-primary transition-colors duration-150"
                    disabled={!!initial}
                  >
                    {sortedTypes.map((et) => (
                      <option key={et.value} value={et.value}>{t(et.labelKey)}</option>
                    ))}
                  </select>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                    {t("equipments.form.name")}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t("equipments.form.namePlaceholder")}
                    className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
                    autoFocus
                    maxLength={100}
                  />
                </div>

                {/* Zone */}
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                    {t("equipments.form.zone")}
                  </label>
                  <select
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none focus:border-primary transition-colors duration-150"
                  >
                    <option value="">{t("equipments.form.selectZone")}</option>
                    {flatZones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {step === "devices" && (
              <>
                <p className="text-[13px] text-text-secondary">
                  {t("equipments.form.deviceInstruction")}
                </p>
                <DeviceSelector
                  equipmentType={type}
                  selectedDeviceIds={selectedDeviceIds}
                  onSelectionChange={setSelectedDeviceIds}
                  boundDeviceIds={boundDeviceIds}
                />
              </>
            )}

            {/* Error */}
            {error && <p className="text-[13px] text-error">{error}</p>}
          </div>

          {/* Actions */}
          <div className="flex justify-between gap-3 px-6 py-4 border-t border-border-light flex-shrink-0">
            {step === "devices" ? (
              <>
                <button
                  type="button"
                  onClick={() => setStep("info")}
                  className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
                >
                  {t("common.back")}
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!name.trim() || !zoneId || saving}
                  className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? t("common.creating") : initial ? t("common.save") : t("common.create")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
                >
                  {t("common.cancel")}
                </button>
                {initial ? (
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!name.trim() || !zoneId || saving}
                    className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? t("common.saving") : t("common.save")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setStep("devices")}
                    disabled={!name.trim() || !zoneId}
                    className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t("equipments.form.nextDevices")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function flattenZones(zones: ZoneWithChildren[]): { id: string; name: string; label: string }[] {
  const result: { id: string; name: string; label: string }[] = [];
  function walk(list: ZoneWithChildren[], parentLabel?: string) {
    for (const z of list) {
      const label = parentLabel ? `${parentLabel} › ${z.name}` : z.name;
      result.push({ id: z.id, name: z.name, label });
      if (z.children.length > 0) walk(z.children, label);
    }
  }
  walk(zones);
  return result;
}
