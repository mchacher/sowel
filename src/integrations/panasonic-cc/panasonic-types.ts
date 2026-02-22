// ============================================================
// Panasonic Comfort Cloud — Bridge response types + enum values
// ============================================================

/** Successful bridge response for get_devices */
export interface BridgeDevicesResponse {
  ok: true;
  devices: BridgeDevice[];
}

/** Successful bridge response for get_device */
export interface BridgeDeviceResponse {
  ok: true;
  device: BridgeDevice;
}

/** Successful bridge response for login */
export interface BridgeLoginResponse {
  ok: true;
  deviceCount: number;
}

/** Successful bridge response for control */
export interface BridgeControlResponse {
  ok: true;
}

/** Error response from bridge */
export interface BridgeErrorResponse {
  ok: false;
  error: string;
}

/** Union of all bridge responses */
export type BridgeResponse =
  | BridgeDevicesResponse
  | BridgeDeviceResponse
  | BridgeLoginResponse
  | BridgeControlResponse
  | BridgeErrorResponse;

/** A device as returned by the Python bridge */
export interface BridgeDevice {
  id: string;
  name: string;
  group: string;
  model: string;
  parameters: BridgeDeviceParameters;
  features: BridgeDeviceFeatures;
}

/** Device parameters from bridge */
export interface BridgeDeviceParameters {
  power: string | null;
  mode: string | null;
  targetTemperature: number | null;
  insideTemperature: number | null;
  outsideTemperature: number | null;
  fanSpeed: string | null;
  airSwingUD: string | null;
  airSwingLR: string | null;
  ecoMode: string | null;
  nanoe: string | null;
}

/** Device feature flags from bridge */
export interface BridgeDeviceFeatures {
  nanoe?: boolean;
  autoMode?: boolean;
  heatMode?: boolean;
  dryMode?: boolean;
  coolMode?: boolean;
  fanMode?: boolean;
  airSwingLR?: boolean;
}

// ============================================================
// Enum value lists (for DeviceOrder enumValues)
// ============================================================

export const POWER_VALUES = ["off", "on"] as const;

export const OPERATION_MODE_VALUES = ["auto", "dry", "cool", "heat", "fan"] as const;

export const FAN_SPEED_VALUES = ["auto", "low", "lowMid", "mid", "highMid", "high"] as const;

export const AIR_SWING_UD_VALUES = ["up", "down", "mid", "upMid", "downMid"] as const;

export const AIR_SWING_LR_VALUES = ["left", "right", "mid", "rightMid", "leftMid"] as const;

export const ECO_MODE_VALUES = ["auto", "powerful", "quiet"] as const;

export const NANOE_VALUES = ["unavailable", "off", "on", "modeG", "all"] as const;

/**
 * Filter operation mode values based on device features.
 */
export function getAvailableModes(features: BridgeDeviceFeatures): string[] {
  const modes: string[] = [];
  if (features.autoMode !== false) modes.push("auto");
  if (features.dryMode !== false) modes.push("dry");
  if (features.coolMode !== false) modes.push("cool");
  if (features.heatMode !== false) modes.push("heat");
  if (features.fanMode !== false) modes.push("fan");
  return modes;
}
