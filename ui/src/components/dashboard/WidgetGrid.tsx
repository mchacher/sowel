import { useCallback } from "react";
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
import { GripVertical, X } from "lucide-react";
import type { DashboardWidget, EquipmentWithDetails, ZoneWithChildren } from "../../types";
import { EquipmentWidget } from "./EquipmentWidget";
import { ZoneWidget } from "./ZoneWidget";

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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 z-10 p-1 cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-secondary"
      >
        <GripVertical size={14} strokeWidth={1.5} />
      </div>
      {/* Delete button */}
      <button
        onClick={() => onDelete(widget.id)}
        className="absolute top-1 right-1 z-10 p-1 text-text-tertiary hover:text-error transition-colors cursor-pointer"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
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
