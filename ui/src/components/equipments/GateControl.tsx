import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DoorOpen, DoorClosed, HelpCircle, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface GateControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

/**
 * Derive gate state from reed-switch data bindings.
 * RS=0 → open (no contact), RS=1 → closed (contact), "unknown" → transitioning.
 */
function deriveGateState(equipment: EquipmentWithDetails): "open" | "closed" | "unknown" {
  const rsBindings = equipment.dataBindings.filter(
    (db) => db.alias.startsWith("RS") || db.key.startsWith("RS"),
  );

  if (rsBindings.length === 0) return "unknown";

  // If any binding is "unknown", the gate is transitioning
  if (rsBindings.some((b) => b.value === "unknown")) return "unknown";

  // RS=1 means closed (contact), RS=0 means open (no contact)
  // If any RS is 0 → gate is open (at least partially)
  const allClosed = rsBindings.every((b) => b.value === 1 || b.value === true);
  if (allClosed) return "closed";

  return "open";
}

export function GateControl({ equipment, onExecuteOrder, compact }: GateControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const toggleBinding = equipment.orderBindings.find((ob) => ob.alias === "toggle");
  const hasToggle = !!toggleBinding;
  const enumValues = toggleBinding?.enumValues ?? [];
  const gateState = deriveGateState(equipment);

  const handleToggle = async (value?: string) => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      // Use provided value, first enum value, or "latch" as fallback
      const sendValue = value ?? enumValues[0] ?? "latch";
      await onExecuteOrder("toggle", sendValue);
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

        {/* Toggle button */}
        {hasToggle && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggle(); }}
            disabled={executing}
            className={`
              p-2 rounded-[6px] transition-colors duration-150 cursor-pointer
              bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={t("controls.gate.toggle")}
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
        <div>
          <div className="text-[16px] font-medium text-text">
            {t(`controls.gate.${gateState}`)}
          </div>
          {/* Reed switch details */}
          <div className="flex items-center gap-3 text-[12px] text-text-tertiary mt-0.5">
            {equipment.dataBindings
              .filter((db) => db.alias.startsWith("RS") || db.key.startsWith("RS"))
              .map((db) => (
                <span key={db.id} className="font-mono">
                  {db.alias}: {db.value === "unknown" ? "?" : db.value === 1 || db.value === true ? t("controls.closed") : t("controls.opened")}
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Toggle buttons */}
      {hasToggle && (
        <div className="flex items-center gap-2">
          {enumValues.length > 1 ? (
            // Multiple enum values — show a button for each
            enumValues.map((val) => (
              <button
                key={val}
                onClick={() => handleToggle(val)}
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
            // Single value or no enum — show one toggle button
            <button
              onClick={() => handleToggle()}
              disabled={executing}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium
                transition-colors duration-150
                bg-border-light text-text-secondary hover:bg-border hover:text-text
                disabled:opacity-50
              `}
            >
              <DoorOpen size={16} strokeWidth={1.5} />
              {executing ? "..." : t("controls.gate.toggle")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
