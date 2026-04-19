import { useCallback, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Palette, SlidersHorizontal } from "lucide-react";
import type { DashboardWidget, EquipmentWithDetails, ZoneWithChildren } from "../../types";
import { EquipmentWidget } from "./EquipmentWidget";
import { ZoneWidget } from "./ZoneWidget";
import { IconPicker } from "./IconPicker";
import { BindingsPicker } from "./BindingsPicker";
import { MobileWidgetCard } from "./MobileWidgetCard";
import { LightBulbIcon, ShutterWidgetIcon, ThermometerIcon, MultiSensorIcon } from "./WidgetIcons";
import { shutterLevel } from "./widget-icons";
import { EquipmentDetailSheet, ZoneDetailSheet } from "./WidgetDetailSheet";
import { needsDetailSheet } from "./widget-utils";
import { useDashboard } from "../../store/useDashboard";
import { useIsMobile } from "../../hooks/useIsMobile";
import { getSensorBindings } from "../equipments/sensorUtils";

interface WidgetGridProps {
  widgets: DashboardWidget[];
  equipmentMap: Map<string, EquipmentWithDetails>;
  zoneMap: Map<string, ZoneWithChildren>;
  equipments: EquipmentWithDetails[];
  editMode: boolean;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  onReorder: (order: string[]) => void;
  onDelete: (id: string) => void;
}

export function WidgetGrid({
  widgets,
  equipmentMap,
  zoneMap,
  equipments,
  editMode,
  onExecuteOrder,
  onReorder,
  onDelete,
}: WidgetGridProps) {
  const isMobile = useIsMobile();
  const [detailWidgetId, setDetailWidgetId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = widgets.findIndex((w) => w.id === active.id);
      const newIndex = widgets.findIndex((w) => w.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const newOrder = [...widgets];
      const [moved] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, moved);
      onReorder(newOrder.map((w) => w.id));
    },
    [widgets, onReorder],
  );

  const ids = widgets.map((w) => w.id);

  // Find the widget being shown in bottom sheet (auto-clears if widget was deleted)
  const detailWidget = detailWidgetId ? widgets.find((w) => w.id === detailWidgetId) ?? null : null;

  if (!editMode) {
    return (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {widgets.map((widget) => (
            <WidgetRenderer
              key={widget.id}
              widget={widget}
              equipmentMap={equipmentMap}
              zoneMap={zoneMap}
              equipments={equipments}
              onExecuteOrder={onExecuteOrder}
              isMobile={isMobile}
              onOpenDetail={() => setDetailWidgetId(widget.id)}
            />
          ))}
        </div>

        {/* Mobile bottom sheet */}
        {detailWidget && detailWidget.type === "equipment" && detailWidget.equipmentId && (
          <EquipmentDetailSheet
            widget={detailWidget}
            equipment={equipmentMap.get(detailWidget.equipmentId)!}
            onExecuteOrder={onExecuteOrder}
            onClose={() => setDetailWidgetId(null)}
          />
        )}
        {detailWidget && detailWidget.type === "zone" && detailWidget.zoneId && (
          <ZoneDetailSheet
            widget={detailWidget}
            zone={zoneMap.get(detailWidget.zoneId) ?? null}
            equipments={equipments}
            onClose={() => setDetailWidgetId(null)}
          />
        )}
      </>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {widgets.map((widget) => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              equipmentMap={equipmentMap}
              zoneMap={zoneMap}
              equipments={equipments}
              onExecuteOrder={onExecuteOrder}
              onDelete={onDelete}
              isMobile={isMobile}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function getEquipmentType(widget: DashboardWidget, equipmentMap: Map<string, EquipmentWithDetails>): string | undefined {
  if (widget.type === "equipment" && widget.equipmentId) {
    return equipmentMap.get(widget.equipmentId)?.type;
  }
  if (widget.type === "zone" && widget.family) {
    return widget.family;
  }
  return undefined;
}

function SortableWidget({
  widget,
  equipmentMap,
  zoneMap,
  equipments,
  onExecuteOrder,
  onDelete,
  isMobile,
}: {
  widget: DashboardWidget;
  equipmentMap: Map<string, EquipmentWithDetails>;
  zoneMap: Map<string, ZoneWithChildren>;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  onDelete: (id: string) => void;
  isMobile: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showBindingsPicker, setShowBindingsPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const { updateWidget } = useDashboard();

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    ...(isDragging && isMobile ? { zIndex: 50, scale: "1.05", boxShadow: "0 8px 24px rgba(0,0,0,0.15)" } : {}),
  };

  const eqType = getEquipmentType(widget, equipmentMap);
  const isSensorWidget = eqType === "sensor" || eqType === "sensors" || eqType === "weather" || eqType === "button";
  const sensorEquipment = isSensorWidget && widget.type === "equipment" && widget.equipmentId
    ? equipmentMap.get(widget.equipmentId)
    : undefined;
  const sensorBindings = sensorEquipment ? getSensorBindings(sensorEquipment.dataBindings) : [];

  const currentLabel = widget.label
    || (widget.type === "equipment" && widget.equipmentId ? equipmentMap.get(widget.equipmentId)?.name : undefined)
    || (widget.type === "zone" && widget.zoneId ? zoneMap.get(widget.zoneId)?.name : undefined)
    || "";

  const handleRenameStart = () => {
    setRenameValue(currentLabel);
    setRenaming(true);
  };

  const handleRenameCommit = () => {
    setRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== currentLabel) {
      updateWidget(widget.id, { label: trimmed });
    }
  };

  // Icon size for mobile vs desktop overlay buttons
  const iconSize = isMobile ? 12 : 14;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isMobile && !isDragging ? "animate-jiggle" : ""}`}
      {...(isMobile ? { ...attributes, ...listeners } : {})}
    >
      {/* Drag handle — on desktop: listeners here; on mobile: whole card is draggable */}
      <div
        {...(isMobile ? {} : { ...attributes, ...listeners })}
        className="absolute top-1 left-1 z-20 p-1 cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-secondary"
      >
        <GripVertical size={iconSize} strokeWidth={1.5} />
      </div>
      {/* Bindings config button (sensor widgets only) */}
      {isSensorWidget && sensorBindings.length > 0 && (
        <button
          onClick={() => setShowBindingsPicker(!showBindingsPicker)}
          className="absolute top-1 right-13 z-20 p-1 text-text-tertiary hover:text-primary transition-colors cursor-pointer"
        >
          <SlidersHorizontal size={iconSize} strokeWidth={1.5} />
        </button>
      )}
      {/* Icon picker button */}
      <button
        onClick={() => setShowIconPicker(!showIconPicker)}
        className="absolute top-1 right-7 z-20 p-1 text-text-tertiary hover:text-primary transition-colors cursor-pointer"
      >
        <Palette size={iconSize} strokeWidth={1.5} />
      </button>
      {/* Delete button */}
      <button
        onClick={() => onDelete(widget.id)}
        className="absolute top-1 right-1 z-20 p-1 text-text-tertiary hover:text-error transition-colors cursor-pointer"
      >
        <X size={iconSize} strokeWidth={1.5} />
      </button>
      {/* Rename overlay on title area */}
      {renaming ? (
        <div className={`absolute ${isMobile ? "top-[2px] left-6 right-6" : "top-[10px] left-3 right-3"} z-10`}>
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameCommit();
              if (e.key === "Escape") setRenaming(false);
            }}
            className={`w-full font-semibold text-text text-center bg-surface border border-primary/40 rounded-[5px] px-1 py-0 outline-none focus:ring-1 focus:ring-primary/30 ${
              isMobile ? "text-[11px]" : "text-[17px]"
            }`}
          />
        </div>
      ) : (
        <button
          onClick={handleRenameStart}
          className={`absolute ${isMobile ? "top-[2px] left-6 right-6 h-[18px]" : "top-[10px] left-7 right-7 h-[24px]"} z-10 cursor-text rounded hover:bg-primary/5 transition-colors`}
        />
      )}
      {/* Bindings picker popover */}
      {showBindingsPicker && sensorBindings.length > 0 && (
        <div className={isMobile ? "fixed inset-0 z-50 flex items-start justify-center pt-24" : "absolute top-7 left-0 right-0 z-20"}>
          {isMobile && <div className="fixed inset-0 bg-black/20" onClick={() => setShowBindingsPicker(false)} />}
          <BindingsPicker
            bindings={sensorBindings}
            visibleAliases={widget.config?.visibleBindings}
            onUpdate={(aliases) => {
              updateWidget(widget.id, {
                config: aliases.length > 0 ? { ...widget.config, visibleBindings: aliases } : null,
              });
            }}
            onClose={() => setShowBindingsPicker(false)}
            mobile={isMobile}
          />
        </div>
      )}
      {/* Icon picker popover */}
      {showIconPicker && (
        <div className={isMobile ? "fixed inset-0 z-50 flex items-start justify-center pt-24" : "absolute top-7 left-0 right-0 z-20"}>
          {isMobile && <div className="fixed inset-0 bg-black/20" onClick={() => setShowIconPicker(false)} />}
          <IconPicker
            currentIcon={widget.icon}
            equipmentType={eqType}
            onSelect={(iconName) => {
              updateWidget(widget.id, { icon: iconName });
            }}
            onClose={() => setShowIconPicker(false)}
            mobile={isMobile}
          />
        </div>
      )}
      <WidgetRenderer
        widget={widget}
        equipmentMap={equipmentMap}
        zoneMap={zoneMap}
        equipments={equipments}
        onExecuteOrder={onExecuteOrder}
        isMobile={isMobile}
        editMode={true}
      />
    </div>
  );
}

function WidgetRenderer({
  widget,
  equipmentMap,
  zoneMap,
  equipments,
  onExecuteOrder,
  isMobile,
  onOpenDetail,
  editMode,
}: {
  widget: DashboardWidget;
  equipmentMap: Map<string, EquipmentWithDetails>;
  zoneMap: Map<string, ZoneWithChildren>;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  isMobile?: boolean;
  onOpenDetail?: () => void;
  editMode?: boolean;
}) {
  if (widget.type === "equipment" && widget.equipmentId) {
    const equipment = equipmentMap.get(widget.equipmentId);
    if (!equipment) return null;

    // On mobile: ALL equipment widgets use compact MobileWidgetCard
    if (isMobile) {
      const mobileClick = editMode ? undefined : getMobileClickAction(equipment, onExecuteOrder, onOpenDetail);
      return (
        <MobileWidgetCard
          widget={widget}
          equipment={equipment}
          onClick={mobileClick}
          editMode={editMode}
        />
      );
    }

    return (
      <EquipmentWidget
        widget={widget}
        equipment={equipment}
        onExecuteOrder={onExecuteOrder}
      />
    );
  }
  if (widget.type === "zone" && widget.zoneId) {
    // On mobile: zone widgets open detail sheet
    if (isMobile) {
      const zone = zoneMap.get(widget.zoneId) ?? null;
      return (
        <MobileZoneCard
          widget={widget}
          zone={zone}
          equipments={equipments}
          onClick={editMode ? undefined : onOpenDetail}
          editMode={editMode}
        />
      );
    }

    const zone = zoneMap.get(widget.zoneId) ?? null;
    return (
      <ZoneWidget
        widget={widget}
        zone={zone}
        equipments={equipments}
      />
    );
  }
  return null;
}

// Family types for zone widget filtering
const ZONE_FAMILY_TYPES: Record<string, string[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
  water: ["water_valve"],
  pool: ["pool_pump", "pool_cover"],
};

function getDescendantZoneIds(zone: ZoneWithChildren): string[] {
  const ids = [zone.id];
  for (const child of zone.children) {
    ids.push(...getDescendantZoneIds(child));
  }
  return ids;
}

// Compact zone card for mobile
function MobileZoneCard({
  widget,
  zone,
  equipments,
  onClick,
  editMode,
}: {
  widget: DashboardWidget;
  zone: ZoneWithChildren | null;
  equipments: EquipmentWithDetails[];
  onClick?: () => void;
  editMode?: boolean;
}) {
  const { t } = useTranslation();
  const label = widget.label || zone?.name || t("dashboard.unknownZone");
  const family = widget.family;

  // Filter equipments for this zone + family
  const zoneIds = zone ? new Set(getDescendantZoneIds(zone)) : new Set<string>();
  const familyTypes = family ? ZONE_FAMILY_TYPES[family] ?? [] : [];
  const filtered = equipments.filter(
    (eq) => zoneIds.has(eq.zoneId) && familyTypes.includes(eq.type),
  );

  // Compute icon with live state
  const { icon, stateText } = (() => {
    if (family === "lights") {
      let onCount = 0;
      for (const eq of filtered) {
        const s = eq.dataBindings.find((b) => b.category === "light_state");
        if (s && (s.value === true || s.value === "ON" || s.value === 1)) onCount++;
      }
      const anyOn = onCount > 0;
      return {
        icon: <LightBulbIcon on={anyOn} />,
        stateText: filtered.length > 0 ? `${onCount}/${filtered.length}` : null,
      };
    }
    if (family === "shutters") {
      const positions: number[] = [];
      for (const eq of filtered) {
        const b = eq.dataBindings.find((d) => d.category === "shutter_position");
        if (b && typeof b.value === "number") positions.push(b.value);
      }
      const avg = positions.length > 0
        ? Math.round(positions.reduce((a, b) => a + b, 0) / positions.length)
        : null;
      const level = avg !== null ? shutterLevel(avg) : null;
      const text = avg === 100 ? t("controls.opened")
        : avg === 0 ? t("controls.closed")
        : avg !== null ? `${avg}%`
        : null;
      return { icon: <ShutterWidgetIcon level={level} />, stateText: text };
    }
    if (family === "heating") {
      const temps: number[] = [];
      let anyOn = false;
      for (const eq of filtered) {
        const temp = eq.dataBindings.find((b) => b.alias === "temperature");
        if (temp && typeof temp.value === "number") temps.push(temp.value);
        const power = eq.dataBindings.find((b) => b.alias === "power");
        if (power?.value === true) anyOn = true;
      }
      const avg = temps.length > 0
        ? temps.reduce((a, b) => a + b, 0) / temps.length
        : null;
      return {
        icon: <ThermometerIcon warm={anyOn} />,
        stateText: avg !== null ? `${avg.toFixed(1)}°C` : null,
      };
    }
    if (family === "sensors") {
      return { icon: <MultiSensorIcon />, stateText: null };
    }
    return { icon: null, stateText: null };
  })();

  return (
    <button
      onClick={onClick}
      className={`bg-surface border border-border rounded-[8px] p-2 flex flex-col items-center h-[120px] overflow-hidden w-full text-left ${
        editMode ? "" : "cursor-pointer active:scale-[0.98]"
      } transition-transform`}
    >
      {/* Label */}
      <span className={`text-[12px] font-semibold text-text truncate w-full text-center ${
        editMode ? "pl-5 pr-8" : ""
      }`}>
        {label}
      </span>

      {/* Icon */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div className="scale-50 origin-center">{icon}</div>
      </div>

      {/* State */}
      {stateText && (
        <span className="text-[11px] text-text-secondary truncate max-w-full">
          {stateText}
        </span>
      )}
    </button>
  );
}

// Determine the click action for a mobile equipment widget card
function getMobileClickAction(
  equipment: EquipmentWithDetails,
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>,
  onOpenDetail?: () => void,
): (() => void) | undefined {
  const type = equipment.type;

  // Complex widgets → open detail sheet
  if (needsDetailSheet(type)) return onOpenDetail;

  // Gate: single action = direct toggle, multiple = detail sheet
  if (type === "gate") {
    const commandBinding = equipment.orderBindings.find((ob) => ob.alias === "command");
    const enumValues = commandBinding?.enumValues ?? [];
    if (commandBinding && enumValues.length <= 1) {
      return () => { onExecuteOrder(equipment.id, "command", null); };
    }
    return onOpenDetail;
  }

  // Simple on/off (light_onoff, switch) → direct toggle
  if (type === "light_onoff" || type === "switch") {
    const stateBinding = equipment.orderBindings.find(
      (ob) => ob.alias === "state" && (ob.type === "enum" || ob.type === "boolean"),
    );
    if (stateBinding) {
      const dataBinding = equipment.dataBindings.find((db) => db.category === "light_state");
      const isOn = dataBinding
        ? dataBinding.value === true || dataBinding.value === "ON" || dataBinding.value === 1
        : false;
      return () => {
        const onVal = stateBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
        const offVal = stateBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
        onExecuteOrder(equipment.id, "state", isOn ? offVal : onVal);
      };
    }
  }

  // Sensor / weather → open detail sheet to see all data
  if (type === "sensor" || type === "weather") {
    return onOpenDetail;
  }

  return undefined;
}
