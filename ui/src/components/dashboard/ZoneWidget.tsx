import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Lightbulb,
  LightbulbOff,
  ArrowUpFromLine,
  ArrowDownToLine,
} from "lucide-react";
import type { DashboardWidget, EquipmentWithDetails, ZoneWithChildren, WidgetFamily } from "../../types";
import { executeZoneOrder } from "../../api";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { getWidgetIcon } from "./widget-icons";

const WIDGET_FAMILY_TYPES: Record<WidgetFamily, string[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
};

interface ZoneWidgetProps {
  widget: DashboardWidget;
  zone: ZoneWithChildren | null;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

function getDescendantZoneIds(zone: ZoneWithChildren): string[] {
  const ids = [zone.id];
  for (const child of zone.children) {
    ids.push(...getDescendantZoneIds(child));
  }
  return ids;
}

export function ZoneWidget({ widget, zone, equipments, onExecuteOrder }: ZoneWidgetProps) {
  const { t } = useTranslation();
  const [commandLoading, setCommandLoading] = useState<string | null>(null);

  const family = widget.family!;
  const familyTypes = WIDGET_FAMILY_TYPES[family];

  // Get all zone IDs (zone + descendants)
  const zoneIds = useMemo(() => {
    if (!zone) return new Set<string>();
    return new Set(getDescendantZoneIds(zone));
  }, [zone]);

  // Filter equipments by zone IDs + family types
  const filteredEquipments = useMemo(() => {
    return equipments.filter(
      (eq) => zoneIds.has(eq.zoneId) && familyTypes.includes(eq.type),
    );
  }, [equipments, zoneIds, familyTypes]);

  const zoneName = zone?.name ?? t("dashboard.unknownZone");
  const familyLabel = t(`dashboard.family.${family}`);
  const label = widget.label || `${familyLabel} - ${zoneName}`;

  const IconComponent = getWidgetIcon(widget.icon, family);

  const handleZoneCommand = useCallback(async (orderKey: string) => {
    if (!widget.zoneId) return;
    setCommandLoading(orderKey);
    try {
      await executeZoneOrder(widget.zoneId, orderKey);
    } catch {
      // silent — user sees result via live updates
    } finally {
      setCommandLoading(null);
    }
  }, [widget.zoneId]);

  const iconColor = family === "lights"
    ? "bg-active/15 text-active-text"
    : family === "shutters"
      ? "bg-primary/10 text-primary"
      : family === "heating"
        ? "bg-error/10 text-error"
        : "bg-border-light text-text-secondary";

  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 flex flex-col gap-2 min-h-[80px]">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className={`flex-shrink-0 w-7 h-7 rounded-[5px] flex items-center justify-center ${iconColor}`}>
          <IconComponent size={16} strokeWidth={1.5} />
        </div>
        <span className="text-[13px] font-medium text-text truncate flex-1">{label}</span>
      </div>

      {/* Equipment list */}
      {filteredEquipments.length === 0 ? (
        <span className="text-[12px] text-text-tertiary">{t("dashboard.noEquipments")}</span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {filteredEquipments.map((eq) => (
            <ZoneEquipmentRow key={eq.id} equipment={eq} family={family} onExecuteOrder={onExecuteOrder} />
          ))}
        </div>
      )}

      {/* Grouped action buttons */}
      {filteredEquipments.length > 0 && (family === "lights" || family === "shutters") && (
        <div className="flex gap-1.5 mt-1">
          {family === "lights" && (
            <>
              <button
                onClick={() => handleZoneCommand("allLightsOn")}
                disabled={commandLoading !== null}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-active/8 hover:text-active-text hover:border-active/40 transition-colors duration-150 disabled:opacity-50"
              >
                {commandLoading === "allLightsOn" ? <Loader2 size={12} className="animate-spin" /> : <Lightbulb size={12} strokeWidth={1.5} />}
                {t("zones.commands.allLightsOn")}
              </button>
              <button
                onClick={() => handleZoneCommand("allLightsOff")}
                disabled={commandLoading !== null}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150 disabled:opacity-50"
              >
                {commandLoading === "allLightsOff" ? <Loader2 size={12} className="animate-spin" /> : <LightbulbOff size={12} strokeWidth={1.5} />}
                {t("zones.commands.allLightsOff")}
              </button>
            </>
          )}
          {family === "shutters" && (
            <>
              <button
                onClick={() => handleZoneCommand("allShuttersOpen")}
                disabled={commandLoading !== null}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-primary/6 hover:text-primary hover:border-primary/40 transition-colors duration-150 disabled:opacity-50"
              >
                {commandLoading === "allShuttersOpen" ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpFromLine size={12} strokeWidth={1.5} />}
                {t("zones.commands.allShuttersOpen")}
              </button>
              <button
                onClick={() => handleZoneCommand("allShuttersClose")}
                disabled={commandLoading !== null}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150 disabled:opacity-50"
              >
                {commandLoading === "allShuttersClose" ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} strokeWidth={1.5} />}
                {t("zones.commands.allShuttersClose")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ZoneEquipmentRow({
  equipment,
  family,
  onExecuteOrder,
}: {
  equipment: EquipmentWithDetails;
  family: WidgetFamily;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { isOn, stateBinding, shutterPosition, sensorBindings } = useEquipmentState(equipment);

  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <span className="text-[12px] text-text-secondary truncate flex-1">{equipment.name}</span>
      {family === "lights" && stateBinding && (
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${isOn ? "bg-active/15 text-active-text" : "bg-border-light text-text-tertiary"}`}>
          {isOn ? t("common.on") : t("common.off")}
        </span>
      )}
      {family === "shutters" && shutterPosition !== null && (
        <span className="text-[11px] text-text-secondary tabular-nums">{shutterPosition}%</span>
      )}
      {family === "heating" && (
        <span className="text-[11px] text-text-secondary tabular-nums">
          {formatValue(
            equipment.dataBindings.find((b) => b.alias === "temperature")?.value,
            "°C",
          )}
        </span>
      )}
      {family === "sensors" && sensorBindings.length > 0 && (
        <span className="text-[11px] text-text-secondary tabular-nums">
          {formatValue(sensorBindings[0].value, sensorBindings[0].unit)}
        </span>
      )}
    </div>
  );
}
