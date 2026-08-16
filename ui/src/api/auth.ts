import type {
  BatteryAlert,
  Device,
  DeviceData,
  DeviceOrder,
  DeviceWithDetails,
  User,
  UserPreferences,
  ApiToken,
  AuthTokens,
  MfaStatus,
  MfaSetupResponse,
  MfaConfirmResponse,
  MfaTrustedDevice,
  MfaChallenge,
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

export async function authLogin(
  username: string,
  password: string,
  trustedDeviceToken?: string,
): Promise<AuthTokens | MfaChallenge> {
  return fetchPublic(`${API_BASE}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ username, password, trustedDeviceToken }),
  });
}

/** Spec 151 — login second factor. `trustDevice` issues a trustedDeviceToken
 *  in the response, valid for the account's configured duration (default 30 days). */
export async function authMfaVerify(
  mfaToken: string,
  code: string,
  options?: { isBackupCode?: boolean; trustDevice?: boolean },
): Promise<AuthTokens & { trustedDeviceToken?: string; trustedDeviceExpiresAt?: string }> {
  return fetchPublic(`${API_BASE}/auth/mfa/verify`, {
    method: "POST",
    body: JSON.stringify({
      mfaToken,
      code,
      isBackupCode: options?.isBackupCode,
      trustDevice: options?.trustDevice,
    }),
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
// Two-factor authentication (spec 151)
// ============================================================

export async function getMyMfaStatus(): Promise<MfaStatus> {
  return fetchJSON<MfaStatus>(`${API_BASE}/me/mfa`);
}

export async function beginMfaEnrollment(): Promise<MfaSetupResponse> {
  return fetchJSON<MfaSetupResponse>(`${API_BASE}/me/mfa/totp/setup`, { method: "POST" });
}

export async function confirmMfaEnrollment(code: string): Promise<MfaConfirmResponse> {
  return fetchJSON<MfaConfirmResponse>(`${API_BASE}/me/mfa/totp/confirm`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function disableMfa(
  password: string,
  code: string,
  isBackupCode?: boolean,
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/me/mfa/totp`, {
    method: "DELETE",
    body: JSON.stringify({ password, code, isBackupCode }),
  });
}

export async function regenerateMfaBackupCodes(
  password: string,
  code: string,
  isBackupCode?: boolean,
): Promise<MfaConfirmResponse> {
  return fetchJSON<MfaConfirmResponse>(`${API_BASE}/me/mfa/backup-codes/regenerate`, {
    method: "POST",
    body: JSON.stringify({ password, code, isBackupCode }),
  });
}

export async function getMyMfaTrustedDevices(): Promise<MfaTrustedDevice[]> {
  return fetchJSON<MfaTrustedDevice[]>(`${API_BASE}/me/mfa/trusted-devices`);
}

export async function revokeMyMfaTrustedDevice(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/me/mfa/trusted-devices/${id}`, { method: "DELETE" });
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

/** Spec 151 FR6 — admin-assisted MFA reset for another user's account. */
export async function adminResetUserMfa(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/users/${id}/mfa`, { method: "DELETE" });
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

/** Active low-battery alerts (spec 143). */
export async function getBatteryAlerts(): Promise<BatteryAlert[]> {
  return fetchJSON<BatteryAlert[]>(`${API_BASE}/devices/battery-alerts`);
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
