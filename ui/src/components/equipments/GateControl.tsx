import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DoorOpen, DoorClosed, HelpCircle, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { findOrderByCategory } from "./bindingUtils";
import { gateStateOf, gateValueLabel } from "../dashboard/gate-confirm";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface GateControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function GateControl({ equipment, onExecuteOrder, compact }: GateControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  // Spec 196 — the Maison row, the equipment list and the equipment page actuate on
  // one press too: a guarded gate asks first.
  const { guardGate, element: confirmElement } = useGuardedAction();

  // Category first, like the dashboard tile and the mobile tap (spec 110): a gate
  // bound under another alias than `command` used to get a button on the dashboard
  // and none here or in the Maison row.
  const commandBinding = findOrderByCategory(
    equipment.orderBindings,
    ["gate_trigger"],
    ["command"],
  );
  const hasCommand = !!commandBinding;
  const enumValues = commandBinding?.enumValues ?? [];
  const gateState = gateStateOf(equipment);

  const send = async (value: string | null) => {
    if (!commandBinding) return;
    setExecuting(true);
    try {
      await onExecuteOrder(commandBinding.alias, value);
    } finally {
      setExecuting(false);
    }
  };
  const handleCommand = (value?: string) => {
    if (executing || !commandBinding) return;
    guardGate(equipment, value ?? null, () => void send(value ?? null));
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* State badge */}
        <span
          className={`
            text-micro font-medium px-2 py-0.5 rounded-full flex-shrink-0
            ${
              gateState === "open" || gateState === "closed"
                ? "bg-border-light text-text-secondary"
                : "bg-text-tertiary/10 text-text-tertiary"
            }
          `}
        >
          {t(`controls.gate.${gateState}`)}
        </span>

        {/* Command button */}
        {hasCommand && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCommand();
            }}
            disabled={executing}
            className={`
              p-2 rounded-sm transition-colors duration-150 cursor-pointer
              bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={t("controls.gate.command")}
          >
            {executing ? (
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <DoorOpen size={16} strokeWidth={1.5} />
            )}
          </button>
        )}
        {confirmElement}
      </div>
    );
  }

  // Full view
  return (
    <div className="space-y-4">
      {/* State display */}
      <div className="flex items-center gap-3">
        <div
          className={`
            w-10 h-10 rounded-md flex items-center justify-center
            ${
              gateState === "open" || gateState === "closed"
                ? "bg-border-light text-text-secondary"
                : "bg-text-tertiary/10 text-text-tertiary"
            }
          `}
        >
          {gateState === "open" ? (
            <DoorOpen size={22} strokeWidth={1.5} />
          ) : gateState === "closed" ? (
            <DoorClosed size={22} strokeWidth={1.5} />
          ) : (
            <HelpCircle size={22} strokeWidth={1.5} />
          )}
        </div>
        <div className="text-lead font-medium text-text">{t(`controls.gate.${gateState}`)}</div>
      </div>

      {/* Command buttons */}
      {hasCommand && (
        <div className="flex items-center gap-2">
          {enumValues.length > 1 ? (
            // Multiple enum values — show a button for each
            enumValues.map((val) => (
              <button
                key={val}
                onClick={() => handleCommand(val)}
                disabled={executing}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-sm text-small font-medium
                  transition-colors duration-150
                  bg-border-light text-text-secondary hover:bg-border hover:text-text
                  disabled:opacity-50
                `}
              >
                <DoorOpen size={16} strokeWidth={1.5} />
                {executing ? "..." : gateValueLabel(val, t)}
              </button>
            ))
          ) : (
            // Single value or no enum — show one command button
            <button
              onClick={() => handleCommand()}
              disabled={executing}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-sm text-small font-medium
                transition-colors duration-150
                bg-border-light text-text-secondary hover:bg-border hover:text-text
                disabled:opacity-50
              `}
            >
              <DoorOpen size={16} strokeWidth={1.5} />
              {executing ? "..." : t("controls.gate.command")}
            </button>
          )}
        </div>
      )}
      {confirmElement}
    </div>
  );
}
