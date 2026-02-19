import { useWebSocket } from "../../store/useWebSocket";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";

export function ConnectionStatus() {
  const status = useWebSocket((s) => s.status);
  const mqttConnected = useWebSocket((s) => s.mqttConnected);

  if (status === "disconnected") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-error/10 text-error">
        <WifiOff size={14} strokeWidth={1.5} />
        <span className="text-[12px] font-medium">Disconnected</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 text-warning">
        <Wifi size={14} strokeWidth={1.5} className="animate-pulse" />
        <span className="text-[12px] font-medium">Connecting...</span>
      </div>
    );
  }

  // status === "connected"
  if (!mqttConnected) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 text-warning">
        <AlertTriangle size={14} strokeWidth={1.5} />
        <span className="text-[12px] font-medium">MQTT disconnected</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
      </span>
      <span className="text-[12px] font-medium">Connected</span>
    </div>
  );
}
