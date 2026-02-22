/**
 * MCZ Maestro protocol types, register maps, and command definitions.
 *
 * Protocol: pipe-delimited hex frames received via Socket.IO from app.mcz.it:9000.
 * Reference: https://github.com/henribi/jeedom-plugin-mczremote
 */

// ---------------------------------------------------------------------------
// Status frame — parsed from the 61-register hex response
// ---------------------------------------------------------------------------

export interface MczStatusFrame {
  /** [1] Raw stove state code */
  stoveState: number;
  /** [6] Ambient temperature (already ÷2) */
  ambientTemperature: number;
  /** [26] Target temperature setpoint (already ÷2) */
  targetTemperature: number;
  /** [18] Profile code */
  profile: number;
  /** [23] ECO mode (0=off, 1=on) */
  ecoMode: number;
  /** [47] Pellet sensor raw value */
  pelletSensor: number;
  /** [45] Total ignition count */
  ignitionCount: number;
  /** [10] Spark plug state (0=ok, 1=worn) */
  sparkPlug: number;
}

// ---------------------------------------------------------------------------
// Register indices in the RecuperoInfo response (type "01")
// ---------------------------------------------------------------------------

export const REGISTER_INDEX = {
  STOVE_STATE: 1,
  FAN_AMBIENT: 2,
  SMOKE_TEMPERATURE: 5,
  AMBIENT_TEMPERATURE: 6,
  PUFFER_TEMPERATURE: 7,
  BOILER_TEMPERATURE: 8,
  SPARK_PLUG: 10,
  SMOKE_RPM: 12,
  PROFILE: 18,
  ACTIVE_MODE: 20,
  REGULATION_MODE: 22,
  ECO_MODE: 23,
  SILENCE_MODE: 24,
  CHRONO_MODE: 25,
  TARGET_TEMPERATURE: 26,
  BOARD_TEMPERATURE: 28,
  ACTIVE_POWER: 29,
  IGNITION_COUNT: 45,
  PELLET_SENSOR: 47,
  SLEEP_MODE: 50,
  SEASON_MODE: 51,
  ANTIFREEZE: 60,
} as const;

// ---------------------------------------------------------------------------
// Stove state mapping
// ---------------------------------------------------------------------------

export function stoveStateToString(raw: number): string {
  if (raw === 0) return "off";
  if (raw === 1) return "checking";
  if (raw >= 2 && raw <= 9) return `ignition_phase_${raw - 1}`;
  if (raw === 10) return "stabilizing";
  if (raw >= 11 && raw <= 15) return `running_p${raw - 10}`;
  if (raw === 30) return "diagnostic";
  if (raw === 31) return "running";
  if (raw >= 40 && raw <= 49) return `shutdown_phase_${raw - 39}`;
  if (raw >= 50 && raw <= 69) return `error_A${String(raw - 49).padStart(2, "0")}`;
  return `unknown_${raw}`;
}

// ---------------------------------------------------------------------------
// Profile mapping
// ---------------------------------------------------------------------------

export const PROFILE_VALUES = ["manual", "dynamic", "overnight", "comfort"] as const;
export type MczProfile = (typeof PROFILE_VALUES)[number];

export function profileToString(raw: number): string {
  return PROFILE_VALUES[raw] ?? `unknown_${raw}`;
}

export function profileToRaw(profile: string): number {
  const idx = PROFILE_VALUES.indexOf(profile as MczProfile);
  return idx >= 0 ? idx : 0;
}

/** Profiles exposed as orders (excludes "manual") */
export const ORDER_PROFILE_VALUES: string[] = ["dynamic", "overnight", "comfort"];

// ---------------------------------------------------------------------------
// Pellet sensor mapping
// ---------------------------------------------------------------------------

export function pelletSensorToString(raw: number): string {
  if (raw === 0) return "inactive";
  if (raw === 10) return "sufficient";
  if (raw === 11) return "almost_empty";
  return `unknown_${raw}`;
}

export const PELLET_SENSOR_VALUES = ["inactive", "sufficient", "almost_empty"] as const;

// ---------------------------------------------------------------------------
// Spark plug mapping
// ---------------------------------------------------------------------------

export function sparkPlugToString(raw: number): string {
  return raw === 0 ? "ok" : "worn";
}

export const SPARK_PLUG_VALUES = ["ok", "worn"] as const;

// ---------------------------------------------------------------------------
// Command IDs for WriteParametri
// ---------------------------------------------------------------------------

export const COMMAND_ID = {
  POWER: 34,
  POWER_LEVEL: 36,
  FAN_AMBIENT: 37,
  REGULATION_MODE: 40,
  ECO_MODE: 41,
  TARGET_TEMPERATURE: 42,
  SILENCE_MODE: 45,
  PROFILE: 149,
  RESET_ALARM: 1,
} as const;

/** Special values */
export const POWER_ON_VALUE = 1;
export const POWER_OFF_VALUE = 40;
export const RESET_ALARM_VALUE = 255;

// ---------------------------------------------------------------------------
// Frame parsing
// ---------------------------------------------------------------------------

/** Message type codes (first field of response frame) */
export const FRAME_TYPE = {
  PARAMETERS: "00",
  INFO: "01",
  DATABASE: "02",
  ALARMS: "0A",
  PING: "PING",
} as const;

/**
 * Parse a pipe-delimited hex response frame into an array of integer values.
 * Returns null if the frame is not a valid INFO frame.
 */
export function parseInfoFrame(raw: string): number[] | null {
  const parts = raw.split("|");
  if (parts.length < 2) return null;

  const frameType = parts[0];
  if (frameType !== FRAME_TYPE.INFO) return null;

  // Convert hex strings to integers (skip the type field)
  return parts.slice(1).map((hex) => parseInt(hex, 16));
}

/**
 * Extract an MczStatusFrame from a parsed register array.
 */
export function extractStatusFrame(registers: number[]): MczStatusFrame {
  return {
    stoveState: registers[REGISTER_INDEX.STOVE_STATE] ?? 0,
    ambientTemperature: (registers[REGISTER_INDEX.AMBIENT_TEMPERATURE] ?? 0) / 2,
    targetTemperature: (registers[REGISTER_INDEX.TARGET_TEMPERATURE] ?? 0) / 2,
    profile: registers[REGISTER_INDEX.PROFILE] ?? 0,
    ecoMode: registers[REGISTER_INDEX.ECO_MODE] ?? 0,
    pelletSensor: registers[REGISTER_INDEX.PELLET_SENSOR] ?? 0,
    ignitionCount: registers[REGISTER_INDEX.IGNITION_COUNT] ?? 0,
    sparkPlug: registers[REGISTER_INDEX.SPARK_PLUG] ?? 0,
  };
}
