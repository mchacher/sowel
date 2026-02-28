import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DoorOpen, DoorClosed, HelpCircle, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface GateControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function GateControl({ equipment, onExecuteOrder, compact }: GateControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const commandBinding = equipment.orderBindings.find((ob) => ob.alias === "command");
  const hasCommand = !!commandBinding;
  const enumValues = commandBinding?.enumValues ?? [];
  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" && db.category === "gate_state",
  );
  const gateState = (stateBinding?.value as string) ?? "unknown";

  const handleCommand = async (value?: string) => {
    if (executing || !commandBinding) return;
    setExecuting(true);
    try {
      await onExecuteOrder("command", value ?? null);
    } finally {
      setExecuting(false);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* State badge */}
        <span
          className={`
            text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0
            ${gateState === "open"
              ? "bg-warning/10 text-warning"
              : gateState === "closed"
                ? "bg-success/10 text-success"
                : "bg-text-tertiary/10 text-text-tertiary"
            }
          `}
        >
          {t(`controls.gate.${gateState}`)}
        </span>

        {/* Command button */}
        {hasCommand && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCommand(); }}
            disabled={executing}
            className={`
              p-2 rounded-[6px] transition-colors duration-150 cursor-pointer
              bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={t("controls.gate.command")}
          >
            {executing
              ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
              : <DoorOpen size={16} strokeWidth={1.5} />
            }
          </button>
        )}
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
            w-10 h-10 rounded-[8px] flex items-center justify-center
            ${gateState === "open"
              ? "bg-warning/10 text-warning"
              : gateState === "closed"
                ? "bg-success/10 text-success"
                : "bg-text-tertiary/10 text-text-tertiary"
            }
          `}
        >
          {gateState === "open"
            ? <DoorOpen size={22} strokeWidth={1.5} />
            : gateState === "closed"
              ? <DoorClosed size={22} strokeWidth={1.5} />
              : <HelpCircle size={22} strokeWidth={1.5} />
          }
        </div>
        <div className="text-[16px] font-medium text-text">
          {t(`controls.gate.${gateState}`)}
        </div>
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
                  flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium
                  transition-colors duration-150
                  bg-border-light text-text-secondary hover:bg-border hover:text-text
                  disabled:opacity-50
                `}
              >
                <DoorOpen size={16} strokeWidth={1.5} />
                {executing ? "..." : val}
              </button>
            ))
          ) : (
            // Single value or no enum — show one command button
            <button
              onClick={() => handleCommand()}
              disabled={executing}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium
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
    </div>
  );
}
