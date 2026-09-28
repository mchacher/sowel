import type {
  SharedAccessJournalEntry,
  SharedAccessPhoneView,
  SharedAccessProfileView,
  SharedAccessProfileWrite,
  SharedAccessState,
  SharedAccessView,
  SharedAccessWrite,
} from "../types";
import { fetchJSON, API_BASE } from "./client";

// ============================================================
// Shared access (spec 181) — the owner's routes, admin-only. Every one of them
// answers 404 while the feature is off (R1.2).
// ============================================================

const BASE = `${API_BASE}/shared-access`;

export async function getSharedAccessState(): Promise<SharedAccessState> {
  return fetchJSON<SharedAccessState>(`${BASE}/state`);
}

export async function getSharedAccessJournal(
  accessId?: string,
  limit = 200,
): Promise<SharedAccessJournalEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (accessId) params.set("accessId", accessId);
  const res = await fetchJSON<{ entries: SharedAccessJournalEntry[] }>(`${BASE}/journal?${params}`);
  return res.entries;
}

export async function createSharedAccess(body: SharedAccessWrite): Promise<SharedAccessView> {
  return fetchJSON<SharedAccessView>(`${BASE}/accesses`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateSharedAccess(
  id: string,
  body: SharedAccessWrite,
): Promise<SharedAccessView> {
  return fetchJSON<SharedAccessView>(`${BASE}/accesses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function sharedAccessAction(
  id: string,
  action: "suspend" | "resume" | "revoke",
): Promise<SharedAccessView> {
  return fetchJSON<SharedAccessView>(`${BASE}/accesses/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
  });
}

export async function changeSharedAccessCode(
  id: string,
  cutPhones: boolean,
): Promise<SharedAccessView> {
  return fetchJSON<SharedAccessView>(`${BASE}/accesses/${encodeURIComponent(id)}/code`, {
    method: "POST",
    body: JSON.stringify({ cutPhones }),
  });
}

export async function getSharedAccessPhones(id: string): Promise<SharedAccessPhoneView[]> {
  const res = await fetchJSON<{ phones: SharedAccessPhoneView[] }>(
    `${BASE}/accesses/${encodeURIComponent(id)}/phones`,
  );
  return res.phones;
}

export async function cutSharedAccessPhone(id: string, phoneId: string): Promise<void> {
  return fetchJSON<void>(
    `${BASE}/accesses/${encodeURIComponent(id)}/phones/${encodeURIComponent(phoneId)}`,
    { method: "DELETE" },
  );
}

export async function deleteSharedAccess(id: string): Promise<void> {
  return fetchJSON<void>(`${BASE}/accesses/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getSharedAccessGatePanel(
  equipmentId: string,
): Promise<{ armed: boolean; people: number }> {
  return fetchJSON(`${BASE}/equipment/${encodeURIComponent(equipmentId)}`);
}

export async function setSharedAccessArmed(
  equipmentId: string,
  armed: boolean,
): Promise<{ armed: boolean; people: number }> {
  return fetchJSON(`${BASE}/equipment/${encodeURIComponent(equipmentId)}`, {
    method: "PUT",
    body: JSON.stringify({ armed }),
  });
}

export async function createSharedAccessProfile(
  body: SharedAccessProfileWrite,
): Promise<SharedAccessProfileView> {
  return fetchJSON<SharedAccessProfileView>(`${BASE}/profiles`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateSharedAccessProfile(
  id: string,
  body: SharedAccessProfileWrite,
): Promise<SharedAccessProfileView> {
  return fetchJSON<SharedAccessProfileView>(`${BASE}/profiles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteSharedAccessProfile(id: string): Promise<void> {
  return fetchJSON<void>(`${BASE}/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** R5.24 — the visitor's page as an app on the home screen. */
export interface SharedAccessAppView {
  name: string;
  customIcon: boolean;
  version: string;
}

export async function getSharedAccessApp(): Promise<SharedAccessAppView> {
  return fetchJSON<SharedAccessAppView>(`${BASE}/app`);
}

/** `icons`: base64 PNGs keyed by size (180, 192, 512), or null for the default mark. */
export async function updateSharedAccessApp(body: {
  name?: string;
  icons?: Record<"180" | "192" | "512", string> | null;
}): Promise<SharedAccessAppView> {
  return fetchJSON<SharedAccessAppView>(`${BASE}/app`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
