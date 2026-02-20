import { useState } from "react";
import { X } from "lucide-react";
import type { EquipmentType, ZoneWithChildren } from "../../types";
import { DeviceSelector } from "./DeviceSelector";

const EQUIPMENT_TYPES: { value: EquipmentType; label: string }[] = [
  { value: "light_onoff", label: "Light (On/Off)" },
  { value: "light_dimmable", label: "Light (Dimmable)" },
  { value: "light_color", label: "Light (Color)" },
  { value: "shutter", label: "Shutter" },
  { value: "switch", label: "Switch / Prise" },
  { value: "sensor", label: "Capteur" },
  { value: "motion_sensor", label: "Capteur mouvement" },
  { value: "contact_sensor", label: "Capteur contact" },
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
                    Type
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
                    {EQUIPMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Spots Salon, Appliques Cuisine..."
                    className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
                    autoFocus
                    maxLength={100}
                  />
                </div>

                {/* Zone */}
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                    Zone
                  </label>
                  <select
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none focus:border-primary transition-colors duration-150"
                  >
                    <option value="">Select a zone...</option>
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
                  Select the device(s) to bind to this equipment. Only compatible devices are shown.
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
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!name.trim() || !zoneId || saving}
                  className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Creating..." : initial ? "Save" : "Create"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
                >
                  Cancel
                </button>
                {initial ? (
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!name.trim() || !zoneId || saving}
                    className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setStep("devices")}
                    disabled={!name.trim() || !zoneId}
                    className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next: Select devices
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
