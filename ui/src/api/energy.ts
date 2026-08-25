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

export async function getPvForecast(equipmentId: string): Promise<PvForecastResponse> {
  return fetchJSON<PvForecastResponse>(`${API_BASE}/energy/pv-forecast/${equipmentId}`);
}

/** Re-estimate the gain now. The hourly shape, which describes the site, is kept. */
export async function recalibratePvForecast(
  equipmentId: string,
): Promise<{ gain: number; fittedAt: string; samples: number }> {
  return fetchJSON(`${API_BASE}/energy/pv-forecast/${equipmentId}/recalibrate`, {
    method: "POST",
  });
}
