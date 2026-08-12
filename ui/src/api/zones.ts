import type {
  ZoneWithChildren,
  Zone,
  ZoneAggregatedData,
} from "../types";
import { fetchJSON, API_BASE } from "./client";

// ============================================================
// Zones
// ============================================================

export async function getZones(): Promise<ZoneWithChildren[]> {
  return fetchJSON<ZoneWithChildren[]>(`${API_BASE}/zones`);
}

export async function getZoneAggregation(): Promise<Record<string, ZoneAggregatedData>> {
  return fetchJSON<Record<string, ZoneAggregatedData>>(`${API_BASE}/zones/aggregation`);
}

export async function getZone(id: string): Promise<ZoneWithChildren> {
  return fetchJSON<ZoneWithChildren>(`${API_BASE}/zones/${id}`);
}

export async function createZone(data: {
  name: string;
  parentId?: string | null;
  icon?: string;
  description?: string;
}): Promise<Zone> {
  return fetchJSON<Zone>(`${API_BASE}/zones`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateZone(
  id: string,
  updates: {
    name?: string;
    parentId?: string | null;
    icon?: string | null;
    description?: string | null;
    displayOrder?: number;
  },
): Promise<Zone> {
  return fetchJSON<Zone>(`${API_BASE}/zones/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteZone(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/zones/${id}`, { method: "DELETE" });
}

export async function reorderZones(parentId: string | null, orderedIds: string[]): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/zones/reorder`, {
    method: "PUT",
    body: JSON.stringify({ parentId, orderedIds }),
  });
}

export async function executeZoneOrder(
  zoneId: string,
  orderKey: string,
  value?: unknown,
): Promise<{ executed: number; errors: number }> {
  return fetchJSON<{ executed: number; errors: number }>(
    `${API_BASE}/zones/${zoneId}/orders/${orderKey}`,
    {
      method: "POST",
      ...(value !== undefined && {
        body: JSON.stringify({ value }),
      }),
    },
  );
}
