import type {
  HistoryStatus,
  HistoryBindingState,
  HistoryQueryResult,
  SavedChart,
  SavedChartConfig,
} from "../types";
import { fetchJSON, API_BASE } from "./client";

// ============================================================
// History (InfluxDB)
// ============================================================

export async function getHistoryStatus(): Promise<HistoryStatus> {
  return fetchJSON<HistoryStatus>(`${API_BASE}/history/status`);
}

export async function getHistoryBindings(equipmentId: string): Promise<HistoryBindingState[]> {
  return fetchJSON<HistoryBindingState[]>(`${API_BASE}/history/bindings/${equipmentId}`);
}

export async function setHistorize(
  equipmentId: string,
  bindingId: string,
  historize: number | null,
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/history/bindings/${equipmentId}/${bindingId}`, {
    method: "PUT",
    body: JSON.stringify({ historize }),
  });
}

export async function getHistoryAliases(equipmentId: string): Promise<{ aliases: string[] }> {
  return fetchJSON<{ aliases: string[] }>(`${API_BASE}/history/${equipmentId}`);
}

export async function getSparklineData(
  equipmentId: string,
  alias: string,
): Promise<{ values: number[] }> {
  return fetchJSON<{ values: number[] }>(`${API_BASE}/history/sparkline/${equipmentId}/${alias}`);
}

export async function getZoneSparklineData(
  zoneId: string,
  category: string,
): Promise<{ values: number[] }> {
  return fetchJSON<{ values: number[] }>(
    `${API_BASE}/history/sparkline/zone/${zoneId}/${category}`,
  );
}

export async function getHistoryData(
  equipmentId: string,
  alias: string,
  params?: { from?: string; to?: string; aggregation?: string },
): Promise<HistoryQueryResult> {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.aggregation) query.set("aggregation", params.aggregation);
  const qs = query.toString();
  return fetchJSON<HistoryQueryResult>(
    `${API_BASE}/history/${equipmentId}/${alias}${qs ? `?${qs}` : ""}`,
  );
}

// ============================================================
// Saved Charts
// ============================================================

export async function getCharts(): Promise<SavedChart[]> {
  return fetchJSON<SavedChart[]>(`${API_BASE}/charts`);
}

export async function getChart(id: string): Promise<SavedChart> {
  return fetchJSON<SavedChart>(`${API_BASE}/charts/${id}`);
}

export async function createChart(data: {
  name: string;
  config: SavedChartConfig;
}): Promise<SavedChart> {
  return fetchJSON<SavedChart>(`${API_BASE}/charts`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateChart(
  id: string,
  data: { name?: string; config?: SavedChartConfig },
): Promise<SavedChart> {
  return fetchJSON<SavedChart>(`${API_BASE}/charts/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteChart(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/charts/${id}`, { method: "DELETE" });
}
