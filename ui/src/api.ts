import type {
  Device, DeviceData, DeviceWithDetails,
  ZoneWithChildren, Zone, ZoneAggregatedData,
  Equipment, EquipmentType, EquipmentWithDetails,
  DataBinding, OrderBinding,
  RecipeInfo, RecipeInstance, RecipeLogEntry,
  User, UserPreferences, ApiToken, AuthTokens,
} from "./types";

const API_BASE = "/api/v1";

// Token management — used by useAuth store
let _accessToken: string | null = null;
let _onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function setOnUnauthorized(handler: () => void): void {
  _onUnauthorized = handler;
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    headers,
    ...options,
  });

  if (response.status === 401 && _onUnauthorized) {
    _onUnauthorized();
    throw new Error("Session expired");
  }

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

// Unauthenticated fetch (for auth endpoints)
async function fetchPublic<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { headers, ...options });
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

// ============================================================
// Auth
// ============================================================

export async function getAuthStatus(): Promise<{ setupRequired: boolean }> {
  return fetchPublic(`${API_BASE}/auth/status`);
}

export async function authSetup(data: {
  username: string;
  password: string;
  displayName: string;
  language?: "fr" | "en";
}): Promise<AuthTokens> {
  return fetchPublic(`${API_BASE}/auth/setup`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function authLogin(username: string, password: string): Promise<AuthTokens> {
  return fetchPublic(`${API_BASE}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function authRefresh(refreshToken: string): Promise<AuthTokens> {
  return fetchPublic(`${API_BASE}/auth/refresh`, {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export async function authLogout(refreshToken: string): Promise<void> {
  return fetchPublic(`${API_BASE}/auth/logout`, {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

// ============================================================
// Current user (me)
// ============================================================

export async function getMe(): Promise<User> {
  return fetchJSON<User>(`${API_BASE}/me`);
}

export async function updateMe(data: { displayName: string }): Promise<User> {
  return fetchJSON<User>(`${API_BASE}/me`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function updateMyPreferences(preferences: UserPreferences): Promise<User> {
  return fetchJSON<User>(`${API_BASE}/me/preferences`, {
    method: "PUT",
    body: JSON.stringify({ preferences }),
  });
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/me/password`, {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function getMyTokens(): Promise<ApiToken[]> {
  return fetchJSON<ApiToken[]>(`${API_BASE}/me/tokens`);
}

export async function createMyToken(name: string): Promise<{ token: string; id: string }> {
  return fetchJSON(`${API_BASE}/me/tokens`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteMyToken(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/me/tokens/${id}`, { method: "DELETE" });
}

// ============================================================
// User management (admin)
// ============================================================

export async function getUsers(): Promise<User[]> {
  return fetchJSON<User[]>(`${API_BASE}/users`);
}

export async function createUser(data: {
  username: string;
  password: string;
  displayName: string;
  role: string;
}): Promise<User> {
  return fetchJSON<User>(`${API_BASE}/users`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateUser(id: string, data: {
  displayName?: string;
  role?: string;
  enabled?: boolean;
}): Promise<User> {
  return fetchJSON<User>(`${API_BASE}/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/users/${id}`, { method: "DELETE" });
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

export async function reorderZones(parentId: string | null, orderedIds: string[]): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/zones/reorder`, {
    method: "PUT",
    body: JSON.stringify({ parentId, orderedIds }),
  });
}

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
  }
): Promise<Equipment> {
  return fetchJSON<Equipment>(`${API_BASE}/equipments/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteEquipment(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${id}`, { method: "DELETE" });
}

export async function executeEquipmentOrder(
  equipmentId: string,
  alias: string,
  value: unknown
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${equipmentId}/orders/${alias}`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

// ============================================================
// DataBindings
// ============================================================

export async function addDataBinding(
  equipmentId: string,
  data: { deviceDataId: string; alias: string }
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
  data: { deviceOrderId: string; alias: string }
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

// ============================================================
// Recipes
// ============================================================

export async function getRecipes(): Promise<RecipeInfo[]> {
  return fetchJSON<RecipeInfo[]>(`${API_BASE}/recipes`);
}

export async function getRecipeInstances(): Promise<RecipeInstance[]> {
  return fetchJSON<RecipeInstance[]>(`${API_BASE}/recipe-instances`);
}

export async function createRecipeInstance(
  recipeId: string,
  params: Record<string, unknown>,
): Promise<RecipeInstance> {
  return fetchJSON<RecipeInstance>(`${API_BASE}/recipe-instances`, {
    method: "POST",
    body: JSON.stringify({ recipeId, params }),
  });
}

export async function updateRecipeInstance(
  instanceId: string,
  params: Record<string, unknown>,
): Promise<RecipeInstance> {
  return fetchJSON<RecipeInstance>(`${API_BASE}/recipe-instances/${instanceId}`, {
    method: "PUT",
    body: JSON.stringify({ params }),
  });
}

export async function deleteRecipeInstance(instanceId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/recipe-instances/${instanceId}`, {
    method: "DELETE",
  });
}

export async function getRecipeInstanceLog(
  instanceId: string,
  limit = 50,
): Promise<RecipeLogEntry[]> {
  return fetchJSON<RecipeLogEntry[]>(`${API_BASE}/recipe-instances/${instanceId}/log?limit=${limit}`);
}
