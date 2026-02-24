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
];

interface EquipmentFormProps {
  title: string;
  initial?: {
    name: string;
    type: EquipmentType;
    zoneId: string;
  };
  zones: ZoneWithChildren[];
  onSubmit: (data: {
    name: string;
    type: EquipmentType;
    zoneId: string;
    selectedDeviceIds: string[];
  }) => Promise<void>;
  onClose: () => void;
  boundDeviceIds?: Set<string>;
}

export function EquipmentForm({ title, initial, zones, onSubmit, onClose, boundDeviceIds }: EquipmentFormProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"info" | "devices">("info");
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<EquipmentType>(initial?.type ?? "light_onoff");
  const [zoneId, setZoneId] = useState(initial?.zoneId ?? "");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flatZones = flattenZones(zones);

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface rounded-[14px] border border-border shadow-xl w-full max-w-[520px] mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
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
                    {EQUIPMENT_TYPE_KEYS.map((et) => (
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
                        {"  ".repeat(z.depth)}{z.name}
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

function flattenZones(
  zones: ZoneWithChildren[],
  depth = 0
): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const zone of zones) {
    result.push({ id: zone.id, name: zone.name, depth });
    result.push(...flattenZones(zone.children, depth + 1));
  }
  return result;
}
