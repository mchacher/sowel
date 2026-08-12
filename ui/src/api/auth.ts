import type {
  Device,
  DeviceData,
  DeviceOrder,
  DeviceWithDetails,
  User,
  UserPreferences,
  ApiToken,
  AuthTokens,
} from "../types";
import { fetchJSON, fetchPublic, API_BASE } from "./client";

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

export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/me/password`, {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function getMyTokens(): Promise<ApiToken[]> {
  return fetchJSON<ApiToken[]>(`${API_BASE}/me/tokens`);
}

export async function createMyToken(
  name: string,
  expiresAt?: string,
): Promise<{ token: string; id: string }> {
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

export async function updateUser(
  id: string,
  data: {
    displayName?: string;
    role?: string;
    enabled?: boolean;
  },
): Promise<User> {
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
  /** Orders are always returned by the list endpoint — keep backward-compat
   * with callers that only read `data`. */
  orders?: DeviceOrder[];
}

export async function getDevices(): Promise<DeviceWithData[]> {
  return fetchJSON<DeviceWithData[]>(`${API_BASE}/devices`);
}

export async function getDevice(id: string): Promise<DeviceWithDetails> {
  return fetchJSON<DeviceWithDetails>(`${API_BASE}/devices/${id}`);
}

export async function updateDevice(
  id: string,
  updates: { name?: string; zoneId?: string | null },
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
  id: string,
): Promise<{ deviceId: string; name: string; sourceDeviceId: string; expose: unknown }> {
  return fetchJSON(`${API_BASE}/devices/${id}/raw`);
}
