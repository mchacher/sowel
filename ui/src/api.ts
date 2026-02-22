import type {
  Device, DeviceData, DeviceWithDetails,
  ZoneWithChildren, Zone, ZoneAggregatedData,
  Equipment, EquipmentType, EquipmentWithDetails,
  DataBinding, OrderBinding,
  RecipeInfo, RecipeInstance, RecipeLogEntry,
  User, UserPreferences, ApiToken, AuthTokens,
  Mode, ModeWithDetails, ModeEventTrigger,
  ZoneModeImpact, ZoneModeImpactAction,
  CalendarProfile, CalendarSlot,
  IntegrationInfo,
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

export async function deleteDevice(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/devices/${id}`, { method: "DELETE" });
}

export async function getDeviceRawExpose(
  id: string
): Promise<{ deviceId: string; name: string; sourceDeviceId: string; expose: unknown }> {
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

export async function enableRecipeInstance(instanceId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/recipe-instances/${instanceId}/enable`, { method: "POST" });
}

export async function disableRecipeInstance(instanceId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/recipe-instances/${instanceId}/disable`, { method: "POST" });
}

export async function getRecipeInstanceLog(
  instanceId: string,
  limit = 50,
): Promise<RecipeLogEntry[]> {
  return fetchJSON<RecipeLogEntry[]>(`${API_BASE}/recipe-instances/${instanceId}/log?limit=${limit}`);
}

// ============================================================
// Settings (admin)
// ============================================================

export async function getSettings(): Promise<Record<string, string>> {
  return fetchJSON<Record<string, string>>(`${API_BASE}/settings`);
}

export async function updateSettings(entries: Record<string, string>): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/settings`, {
    method: "PUT",
    body: JSON.stringify(entries),
  });
}

// ============================================================
// Integrations (admin)
// ============================================================

export async function getIntegrations(): Promise<IntegrationInfo[]> {
  return fetchJSON<IntegrationInfo[]>(`${API_BASE}/integrations`);
}

export async function startIntegration(id: string): Promise<{ success: boolean; status: string }> {
  return fetchJSON(`${API_BASE}/integrations/${id}/start`, { method: "POST" });
}

export async function stopIntegration(id: string): Promise<{ success: boolean; status: string }> {
  return fetchJSON(`${API_BASE}/integrations/${id}/stop`, { method: "POST" });
}

// ============================================================
// Backup (admin)
// ============================================================

export async function exportBackup(): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }
  const response = await fetch(`${API_BASE}/backup`, { headers });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }
  return response.blob();
}

export async function importBackup(file: File): Promise<{ success: boolean }> {
  const text = await file.text();
  const payload = JSON.parse(text);
  return fetchJSON(`${API_BASE}/backup`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ============================================================
// Modes
// ============================================================

export async function getModes(): Promise<ModeWithDetails[]> {
  return fetchJSON<ModeWithDetails[]>(`${API_BASE}/modes`);
}

export async function getMode(id: string): Promise<ModeWithDetails> {
  return fetchJSON<ModeWithDetails>(`${API_BASE}/modes/${id}`);
}

export async function activateMode(id: string): Promise<Mode> {
  return fetchJSON<Mode>(`${API_BASE}/modes/${id}/activate`, { method: "POST" });
}

export async function deactivateMode(id: string): Promise<Mode> {
  return fetchJSON<Mode>(`${API_BASE}/modes/${id}/deactivate`, { method: "POST" });
}

export async function createMode(data: {
  name: string;
  icon?: string;
  description?: string;
}): Promise<ModeWithDetails> {
  return fetchJSON<ModeWithDetails>(`${API_BASE}/modes`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateMode(
  id: string,
  data: { name?: string; icon?: string; description?: string },
): Promise<ModeWithDetails> {
  return fetchJSON<ModeWithDetails>(`${API_BASE}/modes/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteMode(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/modes/${id}`, { method: "DELETE" });
}

export async function addModeTrigger(
  modeId: string,
  data: { equipmentId: string; alias: string; value: unknown },
): Promise<ModeEventTrigger> {
  return fetchJSON<ModeEventTrigger>(`${API_BASE}/modes/${modeId}/triggers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function removeModeTrigger(modeId: string, triggerId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/modes/${modeId}/triggers/${triggerId}`, {
    method: "DELETE",
  });
}

export async function getZoneModeImpacts(zoneId: string): Promise<ZoneModeImpact[]> {
  return fetchJSON<ZoneModeImpact[]>(`${API_BASE}/zones/${zoneId}/mode-impacts`);
}

export async function setModeImpact(
  modeId: string,
  zoneId: string,
  actions: ZoneModeImpactAction[],
): Promise<ZoneModeImpact> {
  return fetchJSON<ZoneModeImpact>(`${API_BASE}/modes/${modeId}/impacts/${zoneId}`, {
    method: "PUT",
    body: JSON.stringify({ actions }),
  });
}

export async function applyModeToZone(modeId: string, zoneId: string): Promise<{ ok: boolean }> {
  return fetchJSON<{ ok: boolean }>(`${API_BASE}/modes/${modeId}/apply-to-zone/${zoneId}`, {
    method: "POST",
  });
}

export async function removeModeImpact(modeId: string, zoneId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/modes/${modeId}/impacts/${zoneId}`, {
    method: "DELETE",
  });
}

// ============================================================
// Calendar
// ============================================================

export async function getCalendarProfiles(): Promise<CalendarProfile[]> {
  return fetchJSON<CalendarProfile[]>(`${API_BASE}/calendar/profiles`);
}

export async function getActiveCalendar(): Promise<{ profile: CalendarProfile; slots: CalendarSlot[] }> {
  return fetchJSON(`${API_BASE}/calendar/active`);
}

export async function setActiveProfile(profileId: string): Promise<{ profile: CalendarProfile; slots: CalendarSlot[] }> {
  return fetchJSON(`${API_BASE}/calendar/active`, {
    method: "PUT",
    body: JSON.stringify({ profileId }),
  });
}

export async function getProfileSlots(profileId: string): Promise<CalendarSlot[]> {
  return fetchJSON<CalendarSlot[]>(`${API_BASE}/calendar/profiles/${profileId}/slots`);
}

export async function addCalendarSlot(
  profileId: string,
  data: { days: number[]; time: string; modeIds: string[] },
): Promise<CalendarSlot> {
  return fetchJSON<CalendarSlot>(`${API_BASE}/calendar/profiles/${profileId}/slots`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateCalendarSlot(
  slotId: string,
  data: { days?: number[]; time?: string; modeIds?: string[] },
): Promise<CalendarSlot> {
  return fetchJSON<CalendarSlot>(`${API_BASE}/calendar/slots/${slotId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteCalendarSlot(slotId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/calendar/slots/${slotId}`, { method: "DELETE" });
}
