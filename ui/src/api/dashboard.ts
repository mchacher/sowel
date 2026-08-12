import type {
  DashboardWidget,
  WidgetConfig,
  WidgetFamily,
} from "../types";
import { fetchJSON, API_BASE } from "./client";

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
