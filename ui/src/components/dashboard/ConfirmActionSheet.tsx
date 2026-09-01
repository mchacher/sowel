import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import { BottomSheet } from "./BottomSheet";
import { SlideToConfirm } from "./SlideToConfirm";

/**
 * Spec 146 — minimal confirmation sheet for a sensitive action on the mobile
 * dashboard (issue #320, UX variant B). Just the question and a
 * slide-to-confirm; completing the slide actuates and closes the sheet.
 *
 * Presentational since spec 171: a recipe tile guards the same physical gate
 * with no equipment of its own to describe it, so the wording comes from the
 * caller. `GateConfirmSheet` below keeps the equipment-shaped call site.
 */
export function ConfirmActionSheet({
  title,
  subtitle,
  slideLabel,
  confirmedLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  subtitle?: string;
  slideLabel: string;
  confirmedLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const closeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const handleConfirm = () => {
    onConfirm();
    // Keep the confirmed (green) state visible briefly, then dismiss.
    closeTimer.current = window.setTimeout(onClose, 500);
  };

  return (
    <BottomSheet open onClose={onClose} title={title}>
      {/* The slide has to sit in the thumb's arc, not on the phone's chin, and
          the height above the bottom edge is bought with content rather than
          with empty space: cancel is a real button instead of a text link, and
          the stack breathes. Growing the sheet or floating it were both tried
          and both read as a hole in the layout (#858). Cancel is deliberately
          narrower and lighter than the slide: primary action, secondary exit.
          These are dimensions, not decoration — the extraction of spec 171 lost
          them once, which is why a test now pins them. */}
      <div className="flex flex-col gap-6 pt-2 pb-8">
        {subtitle && (
          <p className="text-[12px] text-text-tertiary text-center -mt-1">{subtitle}</p>
        )}
        <SlideToConfirm
          label={slideLabel}
          confirmedLabel={confirmedLabel}
          onConfirm={handleConfirm}
        />
        <button
          onClick={onClose}
          className="w-[150px] mx-auto mt-4 text-center text-[13px] text-text-secondary border border-border rounded-[9px] py-2 hover:bg-border-light cursor-pointer"
        >
          {t("common.cancel")}
        </button>
      </div>
    </BottomSheet>
  );
}

/** Spec 146 wording: the gate's name, its zone and the state it reads now. */
export function GateConfirmSheet({
  equipment,
  zoneName,
  onConfirm,
  onClose,
}: {
  equipment: EquipmentWithDetails;
  zoneName?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const stateBinding = equipment.dataBindings.find((db) => db.category === "gate_state");
  const gateState = (stateBinding?.value as string) ?? "unknown";
  const subtitleParts = [
    zoneName,
    t(`controls.gate.${gateState}`, { defaultValue: "" }),
  ].filter(Boolean);

  return (
    <ConfirmActionSheet
      title={t("controls.gate.confirmSheetTitle", { name: equipment.name })}
      subtitle={subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined}
      slideLabel={t("controls.gate.slideToOpen")}
      confirmedLabel={t("controls.gate.actuated")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
