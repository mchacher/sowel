import { useEffect, useState } from "react";
import {
  Thermometer,
  Droplets,
  Sun,
  PersonStanding,
  Lightbulb,
  DoorOpen,
  SquareStack,
  Droplet,
  Flame,
  Activity,
} from "lucide-react";
import type { ZoneAggregatedData } from "../../types";

interface ZoneAggregationHeaderProps {
  data: ZoneAggregatedData;
}

export function ZoneAggregationHeader({ data }: ZoneAggregationHeaderProps) {
  const pills: React.ReactNode[] = [];
  const duration = useRelativeTime(data.motionSince);

  // Temperature
  if (data.temperature !== null) {
    pills.push(
      <Pill key="temp" icon={<Thermometer size={14} strokeWidth={1.5} />} color="text-primary">
        {data.temperature}°C
      </Pill>,
    );
  }

  // Humidity
  if (data.humidity !== null) {
    pills.push(
      <Pill key="hum" icon={<Droplets size={14} strokeWidth={1.5} />} color="text-primary">
        {data.humidity}%
      </Pill>,
    );
  }

  // Luminosity
  if (data.luminosity !== null) {
    pills.push(
      <Pill key="lux" icon={<Sun size={14} strokeWidth={1.5} />} color="text-primary">
        {data.luminosity} lx
      </Pill>,
    );
  }

  // Motion (shown when zone has motion sensors)
  if (data.motionSensors > 0) {
    const label = data.motion ? "Mouvement" : "Calme";
    const suffix = duration ? ` · ${duration}` : "";
    pills.push(
      data.motion ? (
        <Pill key="motion" icon={<PersonStanding size={14} strokeWidth={1.5} />} color="text-amber-500" active>
          {label}{suffix}
        </Pill>
      ) : (
        <Pill key="motion" icon={<PersonStanding size={14} strokeWidth={1.5} />} color="text-text-tertiary">
          {label}{suffix}
        </Pill>
      ),
    );
  }

  // Lights
  if (data.lightsTotal > 0) {
    const isOn = data.lightsOn > 0;
    pills.push(
      <Pill
        key="lights"
        icon={<Lightbulb size={14} strokeWidth={1.5} />}
        color={isOn ? "text-amber-500" : "text-text-tertiary"}
        active={isOn}
      >
        {data.lightsOn}/{data.lightsTotal}
      </Pill>,
    );
  }

  // Open doors
  if (data.openDoors > 0) {
    pills.push(
      <Pill key="doors" icon={<DoorOpen size={14} strokeWidth={1.5} />} color="text-amber-500" active>
        {data.openDoors} ouverte{data.openDoors > 1 ? "s" : ""}
      </Pill>,
    );
  }

  // Open windows
  if (data.openWindows > 0) {
    pills.push(
      <Pill key="windows" icon={<SquareStack size={14} strokeWidth={1.5} />} color="text-amber-500" active>
        {data.openWindows} ouverte{data.openWindows > 1 ? "s" : ""}
      </Pill>,
    );
  }

  // Water leak alert
  if (data.waterLeak) {
    pills.push(
      <Pill key="water" icon={<Droplet size={14} strokeWidth={1.5} />} color="text-error" alert>
        Fuite eau
      </Pill>,
    );
  }

  // Smoke alert
  if (data.smoke) {
    pills.push(
      <Pill key="smoke" icon={<Flame size={14} strokeWidth={1.5} />} color="text-error" alert>
        Fumée
      </Pill>,
    );
  }

  if (pills.length === 0) return null;

  return (
    <div className="mb-6 rounded-[10px] border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Activity size={14} strokeWidth={1.5} className="text-text-tertiary" />
        <span className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">
          Statut
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pills}
      </div>
    </div>
  );
}

// ============================================================
// Relative time hook — refreshes every 30s, zero CPU when no timestamp
// ============================================================

function useRelativeTime(since: string | null): string | null {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [since]);

  if (!since) return null;
  return formatDuration(since);
}

function formatDuration(since: string): string {
  const ms = Date.now() - new Date(since).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "< 1 min";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) {
    return remainMinutes > 0 ? `${hours}h${String(remainMinutes).padStart(2, "0")}` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}j`;
}

// ============================================================
// Pill component
// ============================================================

interface PillProps {
  icon: React.ReactNode;
  color: string;
  active?: boolean;
  alert?: boolean;
  children: React.ReactNode;
}

function Pill({ icon, color, active, alert, children }: PillProps) {
  const bg = alert
    ? "bg-error/10"
    : active
      ? "bg-amber-400/10"
      : "bg-border-light/60";

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        text-[13px] font-medium tabular-nums
        ${bg} ${color}
      `}
    >
      {icon}
      {children}
    </span>
  );
}
