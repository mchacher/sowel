import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import { BottomSheet } from "./BottomSheet";
import { SlideToConfirm } from "./SlideToConfirm";

/**
 * Spec 146 — minimal confirmation sheet for a sensitive gate action on the
 * mobile dashboard (issue #320, UX variant B). Just the question and a
 * slide-to-confirm; completing the slide actuates and closes the sheet.
 */
export function ConfirmActionSheet({
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
  const closeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const stateBinding = equipment.dataBindings.find((db) => db.category === "gate_state");
  const gateState = (stateBinding?.value as string) ?? "unknown";
  const subtitleParts = [
    zoneName,
    t(`controls.gate.${gateState}`, { defaultValue: "" }),
  ].filter(Boolean);

  const handleConfirm = () => {
    onConfirm();
    // Keep the confirmed (green) state visible briefly, then dismiss.
    closeTimer.current = window.setTimeout(onClose, 500);
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t("controls.gate.confirmSheetTitle", { name: equipment.name })}
    >
      <div className="flex flex-col gap-5 pt-1">
        {subtitleParts.length > 0 && (
          <p className="text-[12px] text-text-tertiary text-center -mt-1">
            {subtitleParts.join(" · ")}
          </p>
        )}
        <SlideToConfirm
          label={t("controls.gate.slideToOpen")}
          confirmedLabel={t("controls.gate.actuated")}
          onConfirm={handleConfirm}
        />
        <button
          onClick={onClose}
          className="w-full text-center text-[13px] text-text-tertiary hover:text-text-secondary py-1.5 cursor-pointer"
        >
          {t("common.cancel")}
        </button>
      </div>
    </BottomSheet>
  );
}
