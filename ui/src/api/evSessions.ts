import type { EvAttributionChoice, EvChargeSession, EvVehicleMonthSummary } from "../types";
import { fetchJSON, API_BASE } from "./client";

// ============================================================
// EV charge sessions (spec 191)
// ============================================================

export async function getEvSessions(
  scope: { chargerId: string } | { vehicleId: string },
  month: string,
): Promise<EvChargeSession[]> {
  const params = new URLSearchParams({ ...scope, month });
  const res = await fetchJSON<{ sessions: EvChargeSession[] }>(
    `${API_BASE}/ev-sessions?${params.toString()}`,
  );
  return res.sessions;
}

export async function getEvVehicleSummary(
  vehicleId: string,
  month: string,
): Promise<EvVehicleMonthSummary> {
  const params = new URLSearchParams({ vehicleId, month });
  return fetchJSON<EvVehicleMonthSummary>(`${API_BASE}/ev-sessions/summary?${params.toString()}`);
}

export async function setEvSessionAttribution(
  sessionId: string,
  choice: EvAttributionChoice,
): Promise<EvChargeSession> {
  return fetchJSON<EvChargeSession>(`${API_BASE}/ev-sessions/${sessionId}/attribution`, {
    method: "PUT",
    body: JSON.stringify(choice),
  });
}
