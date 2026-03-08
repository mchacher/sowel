import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, Box, Map } from "lucide-react";
import type { EquipmentWithDetails, ZoneWithChildren, WidgetFamily } from "../../types";

interface AddWidgetModalProps {
  equipments: EquipmentWithDetails[];
  zones: ZoneWithChildren[];
  onAddEquipment: (equipmentId: string) => void;
  onAddZone: (zoneId: string, family: WidgetFamily) => void;
  onClose: () => void;
}

const FAMILIES: WidgetFamily[] = ["lights", "shutters", "heating", "sensors"];

export function AddWidgetModal({
  equipments,
  zones,
  onAddEquipment,
  onAddZone,
  onClose,
}: AddWidgetModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"equipment" | "zone">("equipment");
  const [selectedZoneId, setSelectedZoneId] = useState<string>("");
  const [selectedFamily, setSelectedFamily] = useState<WidgetFamily>("lights");

  // Group equipments by zone
  const equipmentsByZone = useMemo(() => {
    const map = new Map<string, { zoneName: string; equipments: EquipmentWithDetails[] }>();

    function flattenZones(zoneList: ZoneWithChildren[], prefix = ""): Map<string, string> {
      const result = new Map<string, string>();
      for (const zone of zoneList) {
        const name = prefix ? `${prefix} > ${zone.name}` : zone.name;
        result.set(zone.id, name);
        for (const [id, n] of flattenZones(zone.children, name)) {
          result.set(id, n);
        }
      }
      return result;
    }

    const zoneNames = flattenZones(zones);

    for (const eq of equipments) {
      const existing = map.get(eq.zoneId);
      if (existing) {
        existing.equipments.push(eq);
      } else {
        map.set(eq.zoneId, {
          zoneName: zoneNames.get(eq.zoneId) ?? eq.zoneId,
          equipments: [eq],
        });
      }
    }
    return map;
  }, [equipments, zones]);

  // Flatten zones for zone picker
  const flatZones = useMemo(() => {
    const result: { id: string; name: string; depth: number }[] = [];
    function walk(zoneList: ZoneWithChildren[], depth: number) {
      for (const z of zoneList) {
        result.push({ id: z.id, name: z.name, depth });
        walk(z.children, depth + 1);
      }
    }
    walk(zones, 0);
    return result;
  }, [zones]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface border border-border rounded-[14px] shadow-xl w-full max-w-[480px] max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h2 className="text-[16px] font-semibold text-text">{t("dashboard.addWidget")}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text transition-colors cursor-pointer">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-light">
          <button
            onClick={() => setTab("equipment")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors cursor-pointer ${
              tab === "equipment"
                ? "text-primary border-b-2 border-primary"
                : "text-text-secondary hover:text-text"
            }`}
          >
            <Box size={14} strokeWidth={1.5} />
            {t("dashboard.tabEquipment")}
          </button>
          <button
            onClick={() => setTab("zone")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors cursor-pointer ${
              tab === "zone"
                ? "text-primary border-b-2 border-primary"
                : "text-text-secondary hover:text-text"
            }`}
          >
            <Map size={14} strokeWidth={1.5} />
            {t("dashboard.tabZone")}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "equipment" && (
            <div className="space-y-4">
              {Array.from(equipmentsByZone.entries()).map(([zoneId, { zoneName, equipments: zoneEqs }]) => (
                <div key={zoneId}>
                  <h3 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5 px-1">
                    {zoneName}
                  </h3>
                  <div className="space-y-0.5">
                    {zoneEqs.map((eq) => (
                      <button
                        key={eq.id}
                        onClick={() => {
                          onAddEquipment(eq.id);
                          onClose();
                        }}
                        className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-border-light rounded-[6px] transition-colors cursor-pointer"
                      >
                        {eq.name}
                        <span className="ml-2 text-[11px] text-text-tertiary">{eq.type}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {equipmentsByZone.size === 0 && (
                <p className="text-[13px] text-text-tertiary text-center py-4">{t("dashboard.noEquipmentsAvailable")}</p>
              )}
            </div>
          )}

          {tab === "zone" && (
            <div className="space-y-4">
              {/* Zone selector */}
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1">{t("dashboard.selectZone")}</label>
                <select
                  value={selectedZoneId}
                  onChange={(e) => setSelectedZoneId(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                >
                  <option value="">{t("dashboard.chooseZone")}</option>
                  {flatZones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {"  ".repeat(z.depth)}{z.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Family selector */}
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1">{t("dashboard.selectFamily")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {FAMILIES.map((f) => (
                    <button
                      key={f}
                      onClick={() => setSelectedFamily(f)}
                      className={`px-3 py-2 text-[13px] font-medium rounded-[6px] border transition-colors cursor-pointer ${
                        selectedFamily === f
                          ? "border-primary bg-primary-light text-primary"
                          : "border-border text-text-secondary hover:bg-border-light"
                      }`}
                    >
                      {t(`dashboard.family.${f}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Add button */}
              <button
                disabled={!selectedZoneId}
                onClick={() => {
                  if (selectedZoneId) {
                    onAddZone(selectedZoneId, selectedFamily);
                    onClose();
                  }
                }}
                className="w-full px-4 py-2.5 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
              >
                {t("dashboard.addZoneWidget")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
