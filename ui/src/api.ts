import type {
  Device, DeviceData, DeviceWithDetails,
  ZoneWithChildren, Zone, ZoneAggregatedData,
  Equipment, EquipmentType, EquipmentWithDetails,
  DataBinding, OrderBinding,
  RecipeInfo, RecipeInstance, RecipeLogEntry,
  User, UserPreferences, ApiToken, AuthTokens,
  Mode, ModeWithDetails,
  ZoneModeImpact, ZoneModeImpactAction,
  ButtonActionBinding, ButtonEffectType,
  CalendarProfile, CalendarSlot, CalendarModeAction,
  IntegrationInfo,
  LogsResponse, LogLevel,
  HistoryStatus, HistoryBindingState, HistoryQueryResult,
  SavedChart, SavedChartConfig,
  MqttBroker,
  MqttPublisher, MqttPublisherMapping, MqttPublisherWithMappings,
  DashboardWidget, WidgetConfig, WidgetFamily,
  EnergyHistoryResponse, EnergyStatus, TariffConfig,
} from "./types";

const API_BASE = "/api/v1";

// Token management — used by useAuth store
let _accessToken: string | null = null;
let _onUnauthorized: (() => Promise<boolean>) | null = null;
let _refreshing: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function setOnUnauthorized(handler: () => Promise<boolean>): void {
  _onUnauthorized = handler;
}

async function fetchJSON<T>(url: string, options?: RequestInit, isRetry = false): Promise<T> {
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

  if (response.status === 401 && _onUnauthorized && !isRetry) {
    // Deduplicate concurrent refresh attempts
    if (!_refreshing) {
      _refreshing = _onUnauthorized().finally(() => { _refreshing = null; });
    }
    const success = await _refreshing;
    if (success) {
      // Retry with new token
      return fetchJSON<T>(url, options, true);
    }
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

export async function createMyToken(name: string, expiresAt?: string): Promise<{ token: string; id: string }> {
  return fetchJSON(`${API_BASE}/me/tokens`, {
    method: "POST",
    body: JSON.stringify({ name, expiresAt }),
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

export async function sendRecipeInstanceAction(
  instanceId: string,
  action: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/recipe-instances/${instanceId}/actions`, {
    method: "POST",
    body: JSON.stringify({ action, payload }),
  });
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

export async function restartIntegration(
  id: string,
): Promise<{ success: boolean; status: string }> {
  return fetchJSON(`${API_BASE}/integrations/${id}/restart`, { method: "POST" });
}

export async function refreshIntegration(id: string): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/integrations/${id}/refresh`, { method: "POST" });
}

// ============================================================
// Backup (admin)
// ============================================================

export async function exportBackup(): Promise<{ blob: Blob; isZip: boolean }> {
  const headers: Record<string, string> = {};
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }
  const response = await fetch(`${API_BASE}/backup`, { headers });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  const blob = await response.blob();
  return { blob, isZip: contentType.includes("zip") };
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

export async function getModeTriggers(modeId: string): Promise<ButtonActionBinding[]> {
  return fetchJSON<ButtonActionBinding[]>(`${API_BASE}/modes/${modeId}/triggers`);
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
  data: { days: number[]; time: string; modeActions: CalendarModeAction[] },
): Promise<CalendarSlot> {
  return fetchJSON<CalendarSlot>(`${API_BASE}/calendar/profiles/${profileId}/slots`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateCalendarSlot(
  slotId: string,
  data: { days?: number[]; time?: string; modeActions?: CalendarModeAction[] },
): Promise<CalendarSlot> {
  return fetchJSON<CalendarSlot>(`${API_BASE}/calendar/slots/${slotId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteCalendarSlot(slotId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/calendar/slots/${slotId}`, { method: "DELETE" });
}

// ============================================================
// Button Action Bindings
// ============================================================

export async function getButtonActionBindings(equipmentId: string): Promise<ButtonActionBinding[]> {
  return fetchJSON<ButtonActionBinding[]>(`${API_BASE}/equipments/${equipmentId}/action-bindings`);
}

export async function addButtonActionBinding(
  equipmentId: string,
  data: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> },
): Promise<ButtonActionBinding> {
  return fetchJSON<ButtonActionBinding>(`${API_BASE}/equipments/${equipmentId}/action-bindings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateButtonActionBinding(
  equipmentId: string,
  bindingId: string,
  data: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> },
): Promise<ButtonActionBinding> {
  return fetchJSON<ButtonActionBinding>(`${API_BASE}/equipments/${equipmentId}/action-bindings/${bindingId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function removeButtonActionBinding(equipmentId: string, bindingId: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${equipmentId}/action-bindings/${bindingId}`, {
    method: "DELETE",
  });
}

// ============================================================
// Logs (admin)
// ============================================================

export async function fetchLogs(params?: {
  limit?: number;
  level?: string;
  module?: string;
  search?: string;
  since?: string;
}): Promise<LogsResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.level) query.set("level", params.level);
  if (params?.module) query.set("module", params.module);
  if (params?.search) query.set("search", params.search);
  if (params?.since) query.set("since", params.since);
  const qs = query.toString();
  return fetchJSON<LogsResponse>(`${API_BASE}/logs${qs ? `?${qs}` : ""}`);
}

export async function getLogLevel(): Promise<{ level: string }> {
  return fetchJSON<{ level: string }>(`${API_BASE}/logs/level`);
}

export async function setLogLevel(level: LogLevel): Promise<{ level: string; previous: string }> {
  return fetchJSON(`${API_BASE}/logs/level`, {
    method: "PUT",
    body: JSON.stringify({ level }),
  });
}

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
  return fetchJSON<{ values: number[] }>(
    `${API_BASE}/history/sparkline/${equipmentId}/${alias}`,
  );
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

export async function createChart(data: { name: string; config: SavedChartConfig }): Promise<SavedChart> {
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

// ============================================================
// MQTT Brokers
// ============================================================

export async function getMqttBrokers(): Promise<MqttBroker[]> {
  return fetchJSON<MqttBroker[]>(`${API_BASE}/mqtt-brokers`);
}

export async function createMqttBroker(data: {
  name: string;
  url: string;
  username?: string;
  password?: string;
}): Promise<MqttBroker> {
  return fetchJSON<MqttBroker>(`${API_BASE}/mqtt-brokers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateMqttBroker(
  id: string,
  data: { name?: string; url?: string; username?: string; password?: string },
): Promise<MqttBroker> {
  return fetchJSON<MqttBroker>(`${API_BASE}/mqtt-brokers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteMqttBroker(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/mqtt-brokers/${id}`, { method: "DELETE" });
}

// ============================================================
// MQTT Publishers
// ============================================================

export async function getMqttPublishers(): Promise<MqttPublisherWithMappings[]> {
  return fetchJSON<MqttPublisherWithMappings[]>(`${API_BASE}/mqtt-publishers`);
}

export async function getMqttPublisher(id: string): Promise<MqttPublisherWithMappings> {
  return fetchJSON<MqttPublisherWithMappings>(`${API_BASE}/mqtt-publishers/${id}`);
}

export async function createMqttPublisher(data: {
  name: string;
  brokerId: string;
  topic: string;
  enabled?: boolean;
}): Promise<MqttPublisher> {
  return fetchJSON<MqttPublisher>(`${API_BASE}/mqtt-publishers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateMqttPublisher(
  id: string,
  data: { name?: string; brokerId?: string; topic?: string; enabled?: boolean },
): Promise<MqttPublisher> {
  return fetchJSON<MqttPublisher>(`${API_BASE}/mqtt-publishers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteMqttPublisher(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/mqtt-publishers/${id}`, { method: "DELETE" });
}

export async function addMqttPublisherMapping(
  publisherId: string,
  data: {
    publishKey: string;
    sourceType: "equipment" | "zone" | "recipe";
    sourceId: string;
    sourceKey: string;
  },
): Promise<MqttPublisherMapping> {
  return fetchJSON<MqttPublisherMapping>(`${API_BASE}/mqtt-publishers/${publisherId}/mappings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateMqttPublisherMapping(
  publisherId: string,
  mappingId: string,
  data: {
    publishKey?: string;
    sourceType?: "equipment" | "zone" | "recipe";
    sourceId?: string;
    sourceKey?: string;
  },
): Promise<MqttPublisherMapping> {
  return fetchJSON<MqttPublisherMapping>(
    `${API_BASE}/mqtt-publishers/${publisherId}/mappings/${mappingId}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
}

export async function removeMqttPublisherMapping(
  publisherId: string,
  mappingId: string,
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/mqtt-publishers/${publisherId}/mappings/${mappingId}`, {
    method: "DELETE",
  });
}

export async function testMqttPublisher(publisherId: string): Promise<{ published: number }> {
  return fetchJSON<{ published: number }>(`${API_BASE}/mqtt-publishers/${publisherId}/test`, {
    method: "POST",
  });
}

// ── Notification Publishers ──────────────────────────────────

export async function getNotificationPublishers(): Promise<
  import("./types").NotificationPublisherWithMappings[]
> {
  return fetchJSON(`${API_BASE}/notification-publishers`);
}

export async function createNotificationPublisher(data: {
  name: string;
  channelType: "telegram";
  channelConfig: import("./types").TelegramChannelConfig;
  enabled?: boolean;
}): Promise<import("./types").NotificationPublisher> {
  return fetchJSON(`${API_BASE}/notification-publishers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateNotificationPublisher(
  id: string,
  data: {
    name?: string;
    channelType?: "telegram";
    channelConfig?: import("./types").TelegramChannelConfig;
    enabled?: boolean;
  },
): Promise<import("./types").NotificationPublisher> {
  return fetchJSON(`${API_BASE}/notification-publishers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteNotificationPublisher(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/notification-publishers/${id}`, { method: "DELETE" });
}

export async function testNotificationChannel(publisherId: string): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/notification-publishers/${publisherId}/test-channel`, {
    method: "POST",
  });
}

export async function testNotificationPublisher(
  publisherId: string,
): Promise<{ sent: number }> {
  return fetchJSON(`${API_BASE}/notification-publishers/${publisherId}/test`, {
    method: "POST",
  });
}

export async function addNotificationPublisherMapping(
  publisherId: string,
  data: {
    message: string;
    sourceType: "equipment" | "zone" | "recipe";
    sourceId: string;
    sourceKey: string;
    throttleMs?: number;
  },
): Promise<import("./types").NotificationPublisherMapping> {
  return fetchJSON(`${API_BASE}/notification-publishers/${publisherId}/mappings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateNotificationPublisherMapping(
  publisherId: string,
  mappingId: string,
  data: {
    message?: string;
    sourceType?: "equipment" | "zone" | "recipe";
    sourceId?: string;
    sourceKey?: string;
    throttleMs?: number;
  },
): Promise<import("./types").NotificationPublisherMapping> {
  return fetchJSON(`${API_BASE}/notification-publishers/${publisherId}/mappings/${mappingId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function removeNotificationPublisherMapping(
  publisherId: string,
  mappingId: string,
): Promise<void> {
  return fetchJSON<void>(
    `${API_BASE}/notification-publishers/${publisherId}/mappings/${mappingId}`,
    { method: "DELETE" },
  );
}

// ============================================================
// Dashboard Widgets
// ============================================================

export async function getDashboardWidgets(): Promise<DashboardWidget[]> {
  return fetchJSON(`${API_BASE}/dashboard/widgets`);
}

export async function createDashboardWidget(data: {
  type: "equipment" | "zone";
  equipmentId?: string;
  zoneId?: string;
  family?: WidgetFamily;
  label?: string;
  icon?: string;
}): Promise<DashboardWidget> {
  return fetchJSON(`${API_BASE}/dashboard/widgets`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateDashboardWidget(
  id: string,
  data: { label?: string | null; icon?: string | null; config?: WidgetConfig | null },
): Promise<DashboardWidget> {
  return fetchJSON(`${API_BASE}/dashboard/widgets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteDashboardWidget(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/dashboard/widgets/${id}`, {
    method: "DELETE",
  });
}

export async function reorderDashboardWidgets(order: string[]): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/dashboard/widgets/order`, {
    method: "PUT",
    body: JSON.stringify({ order }),
  });
}

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

export async function getTariffConfig(): Promise<TariffConfig> {
  return fetchJSON<TariffConfig>(`${API_BASE}/settings/energy/tariff`);
}

export async function saveTariffConfig(config: TariffConfig): Promise<void> {
  await fetchJSON(`${API_BASE}/settings/energy/tariff`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}
