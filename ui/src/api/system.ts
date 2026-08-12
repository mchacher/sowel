import type {
  LogsResponse,
  LogLevel,
} from "../types";
import { fetchJSON, API_BASE, getAccessToken } from "./client";

// ============================================================
// System
// ============================================================

export interface SystemVersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  dockerAvailable: boolean;
  composeManaged: boolean;
}

export async function getSystemVersion(): Promise<SystemVersionInfo> {
  return fetchJSON(`${API_BASE}/system/version`);
}

export async function checkSystemVersion(): Promise<SystemVersionInfo> {
  return fetchJSON(`${API_BASE}/system/version/check`, { method: "POST" });
}

export async function triggerSystemUpdate(): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${API_BASE}/system/update`, { method: "POST" });
}

export interface SystemTimezoneInfo {
  tz: string;
  source: "env" | "auto" | "fallback";
  offsetHours: number;
}

export async function getSystemTimezone(): Promise<SystemTimezoneInfo> {
  return fetchJSON(`${API_BASE}/system/timezone`);
}

// Spec 124 — surfaces the shadowMode flag for the ShadowBanner.
// Issue #401 — takeoverPending drives the TakeoverBanner.
export async function getSystemMode(): Promise<{
  shadowMode: boolean;
  takeoverPending?: boolean;
}> {
  return fetchJSON(`${API_BASE}/system/mode`);
}

// Issue #401 — adopt a database restored from another deployment. The
// backend writes the local marker and restarts itself.
export async function confirmTakeover(): Promise<{ ok: boolean; restarting: boolean }> {
  return fetchJSON(`${API_BASE}/system/takeover`, { method: "POST" });
}

export async function triggerSystemRestart(): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${API_BASE}/system/restart`, { method: "POST" });
}

// ============================================================
// Local backups
// ============================================================

export interface LocalBackup {
  filename: string;
  size: number;
  createdAt: string;
}

export async function listLocalBackups(): Promise<{ backups: LocalBackup[] }> {
  return fetchJSON(`${API_BASE}/backup/local`);
}

export async function restoreLocalBackup(filename: string): Promise<{
  success: boolean;
  restoredAt: string;
  influxPointsRestored: number;
  filesRestored: number;
  restartRequired: boolean;
}> {
  return fetchJSON(`${API_BASE}/backup/restore-local`, {
    method: "POST",
    body: JSON.stringify({ filename }),
  });
}


// ============================================================
// Settings (admin)
// ============================================================

export async function getSettings(): Promise<Record<string, string>> {
  return fetchJSON<Record<string, string>>(`${API_BASE}/settings`);
}

export async function updateSettings(
  entries: Record<string, string>,
): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/settings`, {
    method: "PUT",
    body: JSON.stringify(entries),
  });
}


// ============================================================
// Backup (admin)
// ============================================================

export async function exportBackup(): Promise<{ blob: Blob }> {
  const headers: Record<string, string> = {};
  if (getAccessToken()) {
    headers["Authorization"] = `Bearer ${getAccessToken()}`;
  }
  const response = await fetch(`${API_BASE}/backup`, { headers });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }
  const blob = await response.blob();
  return { blob };
}

export async function importBackup(file: File): Promise<{ success: boolean }> {
  const formData = new FormData();
  formData.append("file", file);
  const headers: Record<string, string> = {};
  if (getAccessToken()) {
    headers["Authorization"] = `Bearer ${getAccessToken()}`;
  }
  const response = await fetch(`${API_BASE}/backup`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? response.statusText);
  }
  return response.json() as Promise<{ success: boolean }>;
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
