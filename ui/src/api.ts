import type { Device, DeviceData, DeviceWithDetails, ZoneWithChildren, Zone, EquipmentGroup } from "./types";

const API_BASE = "/api/v1";

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        `HTTP ${response.status}: ${response.statusText}`
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface DeviceWithData extends Device {
  data: DeviceData[];
}

export async function getDevices(): Promise<DeviceWithData[]> {
  return fetchJSON<DeviceWithData[]>(`${API_BASE}/devices`);
}

export async function getDevice(id: string): Promise<DeviceWithDetails> {
  return fetchJSON<DeviceWithDetails>(`${API_BASE}/devices/${id}`);
}

export async function updateDevice(
  id: string,
  updates: { name?: string; zoneId?: string | null }
): Promise<Device> {
  return fetchJSON<Device>(`${API_BASE}/devices/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function getDeviceRawExpose(
  id: string
): Promise<{ deviceId: string; name: string; mqttName: string; expose: unknown }> {
  return fetchJSON(`${API_BASE}/devices/${id}/raw`);
}

// ============================================================
// Zones
// ============================================================

export async function getZones(): Promise<ZoneWithChildren[]> {
  return fetchJSON<ZoneWithChildren[]>(`${API_BASE}/zones`);
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
  updates: { name?: string; parentId?: string | null; icon?: string | null; description?: string | null; displayOrder?: number }
): Promise<Zone> {
  return fetchJSON<Zone>(`${API_BASE}/zones/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteZone(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/zones/${id}`, { method: "DELETE" });
}

// ============================================================
// Equipment Groups
// ============================================================

export async function getGroups(zoneId: string): Promise<EquipmentGroup[]> {
  return fetchJSON<EquipmentGroup[]>(`${API_BASE}/zones/${zoneId}/groups`);
}

export async function createGroup(
  zoneId: string,
  data: { name: string; icon?: string; description?: string }
): Promise<EquipmentGroup> {
  return fetchJSON<EquipmentGroup>(`${API_BASE}/zones/${zoneId}/groups`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateGroup(
  id: string,
  updates: { name?: string; icon?: string | null; description?: string | null; displayOrder?: number }
): Promise<EquipmentGroup> {
  return fetchJSON<EquipmentGroup>(`${API_BASE}/groups/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteGroup(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/groups/${id}`, { method: "DELETE" });
}
