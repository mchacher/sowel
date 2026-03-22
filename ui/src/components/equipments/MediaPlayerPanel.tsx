import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Power, Monitor, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface MediaPlayerPanelProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

export function MediaPlayerPanel({ equipment, onExecuteOrder }: MediaPlayerPanelProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<string | null>(null);

  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const sourceBinding = equipment.dataBindings.find((b) => b.alias === "input_source");
  const pictureModeBinding = equipment.dataBindings.find((b) => b.alias === "picture_mode");

  const isOn = powerBinding?.value === true;
  const currentSource = typeof sourceBinding?.value === "string" ? sourceBinding.value : "—";
  const pictureMode = typeof pictureModeBinding?.value === "string" ? pictureModeBinding.value : null;

  const hasPowerOrder = equipment.orderBindings.some((o) => o.alias === "power");
  const hasSourceOrder = equipment.orderBindings.some((o) => o.alias === "input_source");

  const exec = async (alias: string, value: unknown) => {
    if (executing) return;
    setExecuting(alias);
    try {
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <h3 className="text-[14px] font-semibold text-text mb-4">
        <Monitor size={16} strokeWidth={1.5} className="inline mr-2 text-text-tertiary" />
        {t("equipments.controls")}
      </h3>

      <div className="space-y-4">
        {/* Power + Source */}
        <div className="flex items-center gap-4">
          {hasPowerOrder && (
            <button
              onClick={() => exec("power", !isOn)}
              disabled={executing !== null}
              className={`w-10 h-10 flex items-center justify-center rounded-[8px] transition-all cursor-pointer border ${
                isOn
                  ? "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10"
                  : "border-border text-text-tertiary hover:border-primary/30 hover:text-primary"
              } disabled:opacity-40`}
            >
              {executing === "power" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Power size={18} strokeWidth={1.5} />
              )}
            </button>
          )}

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-[20px] font-semibold ${isOn ? "text-text" : "text-text-tertiary"}`}>
                {isOn ? currentSource : "OFF"}
              </span>
              {isOn && pictureMode && (
                <span className="text-[11px] px-1.5 py-0.5 bg-border-light rounded text-text-tertiary">
                  {pictureMode}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Source selector */}
        {isOn && hasSourceOrder && (
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-text-secondary w-16">Source</span>
            <div className="flex gap-1.5 flex-wrap">
              {["TV", "HDMI1", "HDMI2", "HDMI3", "HDMI4"].map((src) => (
                <button
                  key={src}
                  onClick={() => exec("input_source", src)}
                  disabled={executing !== null}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-[5px] transition-colors cursor-pointer ${
                    currentSource === src
                      ? "bg-primary text-white"
                      : "bg-border-light text-text-secondary hover:bg-primary/10 hover:text-primary"
                  } disabled:opacity-40`}
                >
                  {src}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
