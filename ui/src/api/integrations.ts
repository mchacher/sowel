import type {
  IntegrationInfo,
  PluginInfo,
  PluginManifest,
  PluginSource,
} from "../types";
import { fetchJSON, API_BASE, getAccessToken } from "./client";

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

export async function getPluginOAuthUrl(pluginId: string): Promise<{ url: string }> {
  return fetchJSON<{ url: string }>(`${API_BASE}/plugins/${pluginId}/oauth/url`);
}

// ============================================================
// Plugins (admin)
// ============================================================

export async function getPlugins(): Promise<PluginInfo[]> {
  return fetchJSON<PluginInfo[]>(`${API_BASE}/plugins`);
}

export async function getPluginStore(): Promise<PluginManifest[]> {
  return fetchJSON<PluginManifest[]>(`${API_BASE}/plugins/store`);
}

export async function refreshPluginStore(): Promise<{ count: number; source: "remote" | "local" }> {
  return fetchJSON<{ count: number; source: "remote" | "local" }>(
    `${API_BASE}/plugins/store/refresh`,
    { method: "POST" },
  );
}

/** Thrown by installPlugin when the server requires explicit confirmation for a community plugin (spec 089). */
export class CommunityPluginConfirmationRequiredError extends Error {
  readonly owner: string;
  constructor(owner: string) {
    super("CommunityPluginConfirmationRequired");
    this.name = "CommunityPluginConfirmationRequiredError";
    this.owner = owner;
  }
}

/**
 * Thrown by installPlugin/updatePlugin when the server requires the TOFU
 * confirmation step for a personal-source plugin (spec 136). Carries the
 * identity of what would be installed so the UI can display it.
 */
export class PersonalPluginConfirmationRequiredError extends Error {
  readonly repo: string;
  readonly owner: string;
  readonly version: string;
  readonly sha256: string;
  constructor(repo: string, owner: string, version: string, sha256: string) {
    super("PersonalPluginConfirmationRequired");
    this.name = "PersonalPluginConfirmationRequiredError";
    this.repo = repo;
    this.owner = owner;
    this.version = version;
    this.sha256 = sha256;
  }
}

function throwOnConfirmationRequired(status: number, body: unknown): void {
  if (status !== 409) return;
  const b = body as {
    error?: string;
    owner?: string;
    repo?: string;
    version?: string;
    sha256?: string;
  };
  if (b.error === "CommunityPluginConfirmationRequired") {
    throw new CommunityPluginConfirmationRequiredError(b.owner ?? "unknown");
  }
  if (b.error === "PersonalPluginConfirmationRequired") {
    throw new PersonalPluginConfirmationRequiredError(
      b.repo ?? "unknown",
      b.owner ?? "unknown",
      b.version ?? "?",
      b.sha256 ?? "",
    );
  }
}

/**
 * Install a plugin. `confirmed` must be `true` for community plugins
 * (those whose registry `owner` is not in the OFFICIAL_OWNERS list). The
 * server returns 409 `CommunityPluginConfirmationRequired` when this is
 * needed — this function throws `CommunityPluginConfirmationRequiredError`
 * in that case so the caller can surface a confirm dialog and retry with
 * `confirmed: true`. See spec 089.
 * Personal-source plugins (spec 136) additionally require the
 * `expectedSha256` shown by the 409 `PersonalPluginConfirmationRequired`
 * response, surfaced here as `PersonalPluginConfirmationRequiredError`.
 */
export async function installPlugin(
  repo: string,
  confirmed = false,
  expectedSha256?: string,
): Promise<PluginManifest> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}/plugins/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({ repo, confirmed, ...(expectedSha256 ? { expectedSha256 } : {}) }),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    throwOnConfirmationRequired(response.status, body);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string; message?: string }).message ??
        (body as { error?: string }).error ??
        `HTTP ${response.status}: ${response.statusText}`,
    );
  }
  return (await response.json()) as PluginManifest;
}

export async function uninstallPlugin(id: string): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/plugins/${id}/uninstall`, { method: "POST" });
}

export async function enablePlugin(id: string): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/plugins/${id}/enable`, { method: "POST" });
}

export async function disablePlugin(id: string): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/plugins/${id}/disable`, { method: "POST" });
}

/**
 * Update a plugin. Personal-source packages (spec 136) answer 409
 * `PersonalPluginConfirmationRequired` on the first call — retry with
 * `{ confirmed: true, expectedSha256 }` after the user approves.
 */
export async function updatePlugin(
  id: string,
  opts: { confirmed?: boolean; expectedSha256?: string } = {},
): Promise<{ success: boolean; manifest?: PluginManifest }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}/plugins/${id}/update`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    throwOnConfirmationRequired(response.status, body);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string; message?: string }).message ??
        (body as { error?: string }).error ??
        `HTTP ${response.status}: ${response.statusText}`,
    );
  }
  return (await response.json()) as { success: boolean; manifest?: PluginManifest };
}

// ============================================================
// Personal plugin sources (spec 136, admin)
// ============================================================

export async function getPluginSources(): Promise<PluginSource[]> {
  return fetchJSON<PluginSource[]>(`${API_BASE}/plugins/sources`);
}

export async function addPluginSource(repo: string): Promise<PluginSource> {
  return fetchJSON<PluginSource>(`${API_BASE}/plugins/sources`, {
    method: "POST",
    body: JSON.stringify({ repo }),
  });
}

export async function removePluginSource(repo: string): Promise<{ success: boolean }> {
  return fetchJSON(`${API_BASE}/plugins/sources/remove`, {
    method: "POST",
    body: JSON.stringify({ repo }),
  });
}
