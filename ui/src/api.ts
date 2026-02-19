import type { Device, DeviceData, DeviceWithDetails } from "./types";

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
