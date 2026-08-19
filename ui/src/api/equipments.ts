import type {
  Equipment,
  EquipmentType,
  EnergyLoadProfile,
  ArbiterPublicState,
  ArbiterTimeline,
  EquipmentWithDetails,
  DataBinding,
  OrderBinding,
} from "../types";
import { fetchJSON, API_BASE, getAccessToken } from "./client";

// ============================================================
// Equipments
// ============================================================

export async function getEquipments(): Promise<EquipmentWithDetails[]> {
  return fetchJSON<EquipmentWithDetails[]>(`${API_BASE}/equipments`);
}

export async function getEquipment(id: string): Promise<EquipmentWithDetails> {
  return fetchJSON<EquipmentWithDetails>(`${API_BASE}/equipments/${id}`);
}

export async function createEquipment(data: {
  name: string;
  type: EquipmentType;
  zoneId: string;
  icon?: string;
  description?: string;
}): Promise<Equipment> {
  return fetchJSON<Equipment>(`${API_BASE}/equipments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateEquipment(
  id: string,
  updates: {
    name?: string;
    type?: EquipmentType;
    zoneId?: string;
    icon?: string | null;
    description?: string | null;
    enabled?: boolean;
    /** Spec 140 — flexible-load declaration; null clears it. */
    energyProfile?: EnergyLoadProfile | null;
    /** Spec 146 — opt-in confirmation before actuating (gate v1). */
    requireConfirmation?: boolean;
    /** Spec 154 — invert shutter-family command direction. */
    invertDirection?: boolean;
  },
): Promise<Equipment> {
  return fetchJSON<Equipment>(`${API_BASE}/equipments/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

// ============================================================
// Energy capacity arbiter (spec 140)
// ============================================================

export async function getArbiterState(): Promise<ArbiterPublicState> {
  return fetchJSON<ArbiterPublicState>(`${API_BASE}/energy/arbiter`);
}

// Spec 148 (Phase B) — arbitrage timeline for a 6h window, paged back to 48h.
export async function getArbiterTimeline(
  hours = 6,
  offset = 0,
  step = 15,
): Promise<ArbiterTimeline> {
  return fetchJSON<ArbiterTimeline>(
    `${API_BASE}/energy/arbiter/timeline?hours=${hours}&offset=${offset}&step=${step}`,
  );
}

export async function resumeArbiterEquipment(equipmentId: string): Promise<void> {
  await fetchJSON(`${API_BASE}/energy/arbiter/resume/${equipmentId}`, { method: "POST" });
}

export async function deleteEquipment(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${id}`, { method: "DELETE" });
}

export async function executeEquipmentOrder(
  equipmentId: string,
  alias: string,
  value: unknown,
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${equipmentId}/orders/${alias}`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

// ============================================================
// Camera media proxy (spec 133)
// ============================================================

/**
 * Fetch the current snapshot for a camera equipment as a Blob — used to
 * build an object URL for an <img>. A plain <img src="..."> can't carry
 * the Authorization header, so the caller must fetch + createObjectURL.
 */
export async function fetchCameraSnapshot(equipmentId: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}/equipments/${equipmentId}/camera/snapshot`, {
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${response.status}: ${response.statusText}`,
    );
  }
  return response.blob();
}

/** Same-origin path for the live stream — consumed by hls.js, which
 * attaches the Authorization header per-request via xhrSetup (see
 * CameraPanel.tsx). Not fetched directly here. */
export function getCameraStreamUrl(equipmentId: string): string {
  return `${API_BASE}/equipments/${equipmentId}/camera/stream`;
}

// getAccessToken (used by hls.js's xhrSetup, see CameraPanel.tsx) lives in ./client.

// ============================================================
// DataBindings
// ============================================================

export async function addDataBinding(
  equipmentId: string,
  data: { deviceDataId: string; alias: string },
): Promise<DataBinding> {
  return fetchJSON<DataBinding>(`${API_BASE}/equipments/${equipmentId}/data-bindings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function removeDataBinding(equipmentId: string, bindingId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${equipmentId}/data-bindings/${bindingId}`, {
    method: "DELETE",
  });
}

// ============================================================
// OrderBindings
// ============================================================

export async function addOrderBinding(
  equipmentId: string,
  data: { deviceOrderId: string; alias: string },
): Promise<OrderBinding> {
  return fetchJSON<OrderBinding>(`${API_BASE}/equipments/${equipmentId}/order-bindings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function removeOrderBinding(equipmentId: string, bindingId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${equipmentId}/order-bindings/${bindingId}`, {
    method: "DELETE",
  });
}
