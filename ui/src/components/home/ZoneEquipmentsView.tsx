import {
  Box,
  CircleDot,
  Droplet,
  Gauge,
  Lightbulb,
  Monitor,
  Thermometer,
  ToggleRight,
  Tv,
  WashingMachine,
  Zap,
} from "lucide-react";
import { ShutterClosedIcon } from "../icons/ShutterIcons";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import { SECTIONS, sectionOf, type SectionId } from "../../lib/equipment-family";
import { CompactEquipmentCard } from "./CompactEquipmentCard";
import { SliceHeader } from "./Panel";

// Spec 208 — one section per equipment family (coloured title) or neutral
// section, in the order of SECTIONS; the membership rule lives in
// lib/equipment-family.ts.
const SECTION_ICONS: Record<SectionId, React.ReactNode> = {
  lighting: <Lightbulb size={16} strokeWidth={1.5} />,
  openings: <ShutterClosedIcon size={16} strokeWidth={1.5} />,
  climate: <Thermometer size={16} strokeWidth={1.5} />,
  water: <Droplet size={16} strokeWidth={1.5} />,
  energy: <Zap size={16} strokeWidth={1.5} />,
  sensors: <Gauge size={16} strokeWidth={1.5} />,
  media: <Tv size={16} strokeWidth={1.5} />,
  appliances: <WashingMachine size={16} strokeWidth={1.5} />,
  plugs: <ToggleRight size={16} strokeWidth={1.5} />,
  controls: <CircleDot size={16} strokeWidth={1.5} />,
  displays: <Monitor size={16} strokeWidth={1.5} />,
  other: <Box size={16} strokeWidth={1.5} />,
};

interface ZoneEquipmentsViewProps {
  zoneName: string;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  onAdd?: () => void;
}

export function ZoneEquipmentsView({
  zoneName,
  equipments,
  onExecuteOrder,
  onAdd,
}: ZoneEquipmentsViewProps) {
  const { t } = useTranslation();

  if (equipments.length === 0) {
    return <EmptyZone zoneName={zoneName} onAdd={onAdd} />;
  }

  const grouped = SECTIONS.map((section) => ({
    ...section,
    equipments: equipments.filter((eq) => sectionOf(eq) === section.id),
  })).filter((g) => g.equipments.length > 0);

  // Each section is a slice of the panel body (spec 196, slice 7c): the
  // fragment's children are the direct children of the Panel's `slices`.
  return (
    <>
      {grouped.map((group) => (
        <div key={group.id}>
          <SliceHeader
            icon={SECTION_ICONS[group.id]}
            label={t(group.labelKey)}
            count={group.equipments.length}
            family={group.family}
          />
          <div className="slice-rows">
            {group.equipments.map((eq) => (
              <CompactEquipmentCard
                key={eq.id}
                equipment={eq}
                onExecuteOrder={onExecuteOrder}
                zoneName={zoneName}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyZone({ zoneName, onAdd }: { zoneName: string; onAdd?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-border-light flex items-center justify-center mb-3">
        <Box size={24} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-lead font-medium text-text mb-1">{t("equipments.noEquipments")}</h3>
      <p className="text-small text-text-secondary max-w-[280px]">
        {t("equipments.noEquipmentsMessage", { name: zoneName })}
      </p>
      {onAdd && (
        <button
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-small font-medium text-white bg-primary-fill rounded-sm hover:bg-primary-fill-hover transition-colors duration-150"
        >
          {t("equipments.createEquipment")}
        </button>
      )}
    </div>
  );
}
