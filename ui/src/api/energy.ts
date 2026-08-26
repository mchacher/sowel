import type {
  EnergyHistoryResponse,
  EnergyStatus,
  TariffConfig,
  EnergyByUsageResponse,
  ActivityItem,
} from "../types";
import type { PvForecastResponse } from "../types";
import { fetchJSON, API_BASE } from "./client";

// ============================================================
// Energy
// ============================================================

export async function getEnergyStatus(): Promise<EnergyStatus> {
  return fetchJSON<EnergyStatus>(`${API_BASE}/energy/status`);
}

export async function getEnergyHistory(
  period: string,
  date: string,
): Promise<EnergyHistoryResponse> {
  return fetchJSON<EnergyHistoryResponse>(
    `${API_BASE}/energy/history?period=${period}&date=${date}`,
  );
}

export async function getEnergyByUsage(
  period: string,
  date: string,
): Promise<EnergyByUsageResponse> {
  return fetchJSON<EnergyByUsageResponse>(
    `${API_BASE}/energy/by-usage?period=${period}&date=${date}`,
  );
}

export async function getTariffConfig(): Promise<TariffConfig> {
  return fetchJSON<TariffConfig>(`${API_BASE}/settings/energy/tariff`);
}

export async function saveTariffConfig(config: TariffConfig): Promise<void> {
  await fetchJSON(`${API_BASE}/settings/energy/tariff`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

// ============================================================
// Activity (spec 101)
// ============================================================

export async function getActivity(
  zoneId: string,
  options: { includeDescendants?: boolean; limit?: number } = {},
): Promise<{ items: ActivityItem[] }> {
  const { includeDescendants = false, limit = 50 } = options;
  return fetchJSON<{ items: ActivityItem[] }>(
    `${API_BASE}/activity?zoneId=${encodeURIComponent(zoneId)}&includeDescendants=${includeDescendants}&limit=${limit}`,
  );
}

// ============================================================
// PV production forecast (spec 160)
// ============================================================

/**
 * @param accuracyDays how far back the forecast-versus-actual comparison looks.
 *   Bounded server-side by the retention of the measured series.
 */
export async function getPvForecast(
  equipmentId: string,
  accuracyDays?: number,
): Promise<PvForecastResponse> {
  const query = accuracyDays ? `?days=${accuracyDays}` : "";
  return fetchJSON<PvForecastResponse>(`${API_BASE}/energy/pv-forecast/${equipmentId}${query}`);
}

/** Spec 161 — fit the model from history that already exists. */
export interface PvBackfillResult {
  hoursPaired: number;
  windowFrom?: string;
  windowTo?: string;
  boundedBy?: "window" | "declaration";
  reason?: string;
  model: { gain: number; samples: number; fittedAt: string } | null;
}

export async function backfillPvForecast(equipmentId: string): Promise<PvBackfillResult> {
  return fetchJSON(`${API_BASE}/energy/pv-forecast/${equipmentId}/backfill`, {
    method: "POST",
  });
}

/** Spec 162 — is the array still performing? */
export interface PvHealthDay {
  day: string;
  ratio: number;
  hours: number;
}

export interface PvHealthResponse {
  /** False when no array is declared: the feature is silent, not waiting. */
  active: boolean;
  days: PvHealthDay[];
  /** The reference the days are judged against. Null until there is one. */
  normal: number | null;
  latest: PvHealthDay | null;
  alert: { since: string; deficit: number } | null;
  /**
   * Null when no day qualified in the recent window — the detector has had
   * nothing to judge on, which the card must say rather than showing a weeks-old
   * figure as current.
   */
  detection: {
    /** Smallest loss the rule can confirm at all, as a fraction. */
    minDetectableLoss: number;
    calendarDays: number;
    qualifyingDays: number;
    windowDays: number;
  } | null;
}

/** Spec 162 — a standing health alert, for the alarm banner rebuild. */
export interface PvHealthAlert {
  equipmentId: string;
  equipmentName: string;
  since: string;
  deficit: number;
  zoneId: string | null;
  /** Composed server-side with the same wording and constants as the live raise. */
  message: string;
}

export async function getPvHealthAlerts(): Promise<PvHealthAlert[]> {
  return fetchJSON<PvHealthAlert[]>(`${API_BASE}/energy/pv-health-alerts`);
}

export async function getPvHealth(equipmentId: string): Promise<PvHealthResponse> {
  return fetchJSON<PvHealthResponse>(`${API_BASE}/energy/pv-health/${equipmentId}`);
}
