import { fetchJSON, API_BASE } from "./client";

// ============================================================
// Web Push (spec 127)
// ============================================================

export async function getVapidPublicKey(): Promise<{ publicKey: string }> {
  return fetchJSON(`${API_BASE}/push/vapid-public-key`);
}

export async function getPushSubscriptions(): Promise<import("../types").PushSubscription[]> {
  return fetchJSON(`${API_BASE}/push/subscriptions`);
}

export async function subscribePush(body: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}): Promise<import("../types").PushSubscription> {
  return fetchJSON(`${API_BASE}/push/subscriptions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/push/subscriptions`, {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

// Spec 199 — name or remove one of the caller's own devices.
export async function renamePushSubscription(
  id: string,
  label: string | null,
): Promise<import("../types").PushSubscription> {
  return fetchJSON(`${API_BASE}/push/subscriptions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });
}

export async function deletePushSubscription(id: string): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/push/subscriptions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
