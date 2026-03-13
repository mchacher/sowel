import { AlertTriangle } from "lucide-react";
import { useWebSocket } from "../../store/useWebSocket";

export function AlarmBanner() {
  const alarms = useWebSocket((s) => s.alarms);

  if (alarms.size === 0) return null;

  const alarmList = Array.from(alarms.values());

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 text-[13px] font-medium">
      <AlertTriangle size={14} strokeWidth={1.5} />
      <span>
        {alarmList.length === 1
          ? `${alarmList[0].source} : ${alarmList[0].message}`
          : `${alarmList.length} alarmes actives`}
      </span>
    </div>
  );
}
