import { useCallback, useState, useRef, useEffect } from "react";
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
import { useDashboard } from "../../store/useDashboard";
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
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

  if (!editMode) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {widgets.map((widget) => (
          <WidgetRenderer
            key={widget.id}
            widget={widget}
            equipmentMap={equipmentMap}
            zoneMap={zoneMap}
            equipments={equipments}
            onExecuteOrder={onExecuteOrder}
          />
        ))}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {widgets.map((widget) => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              equipmentMap={equipmentMap}
              zoneMap={zoneMap}
              equipments={equipments}
              onExecuteOrder={onExecuteOrder}
              onDelete={onDelete}
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
}: {
  widget: DashboardWidget;
  equipmentMap: Map<string, EquipmentWithDetails>;
  zoneMap: Map<string, ZoneWithChildren>;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  onDelete: (id: string) => void;
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 z-20 p-1 cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-secondary"
      >
        <GripVertical size={14} strokeWidth={1.5} />
      </div>
      {/* Bindings config button (sensor widgets only) */}
      {isSensorWidget && sensorBindings.length > 0 && (
        <button
          onClick={() => setShowBindingsPicker(!showBindingsPicker)}
          className="absolute top-1 right-13 z-20 p-1 text-text-tertiary hover:text-primary transition-colors cursor-pointer"
        >
          <SlidersHorizontal size={14} strokeWidth={1.5} />
        </button>
      )}
      {/* Icon picker button */}
      <button
        onClick={() => setShowIconPicker(!showIconPicker)}
        className="absolute top-1 right-7 z-20 p-1 text-text-tertiary hover:text-primary transition-colors cursor-pointer"
      >
        <Palette size={14} strokeWidth={1.5} />
      </button>
      {/* Delete button */}
      <button
        onClick={() => onDelete(widget.id)}
        className="absolute top-1 right-1 z-20 p-1 text-text-tertiary hover:text-error transition-colors cursor-pointer"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
      {/* Rename overlay on title area */}
      {renaming ? (
        <div className="absolute top-[10px] left-3 right-3 z-10">
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameCommit();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="w-full text-[17px] font-semibold text-text text-center bg-surface border border-primary/40 rounded-[5px] px-1 py-0 outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      ) : (
        <button
          onClick={handleRenameStart}
          className="absolute top-[10px] left-7 right-7 z-10 h-[24px] cursor-text rounded hover:bg-primary/5 transition-colors"
        />
      )}
      {/* Bindings picker popover */}
      {showBindingsPicker && sensorBindings.length > 0 && (
        <div className="absolute top-7 left-0 right-0 z-20">
          <BindingsPicker
            bindings={sensorBindings}
            visibleAliases={widget.config?.visibleBindings}
            onUpdate={(aliases) => {
              updateWidget(widget.id, {
                config: aliases.length > 0 ? { ...widget.config, visibleBindings: aliases } : null,
              });
            }}
            onClose={() => setShowBindingsPicker(false)}
          />
        </div>
      )}
      {/* Icon picker popover */}
      {showIconPicker && (
        <div className="absolute top-7 left-0 right-0 z-20">
          <IconPicker
            currentIcon={widget.icon}
            equipmentType={eqType}
            onSelect={(iconName) => {
              updateWidget(widget.id, { icon: iconName });
            }}
            onClose={() => setShowIconPicker(false)}
          />
        </div>
      )}
      <WidgetRenderer
        widget={widget}
        equipmentMap={equipmentMap}
        zoneMap={zoneMap}
        equipments={equipments}
        onExecuteOrder={onExecuteOrder}
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
}: {
  widget: DashboardWidget;
  equipmentMap: Map<string, EquipmentWithDetails>;
  zoneMap: Map<string, ZoneWithChildren>;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}) {
  if (widget.type === "equipment" && widget.equipmentId) {
    const equipment = equipmentMap.get(widget.equipmentId);
    if (!equipment) return null;
    return (
      <EquipmentWidget
        widget={widget}
        equipment={equipment}
        onExecuteOrder={onExecuteOrder}
      />
    );
  }
  if (widget.type === "zone" && widget.zoneId) {
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
