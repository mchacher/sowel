import type {
  Mode,
  ModeWithDetails,
  ZoneModeImpact,
  ZoneModeImpactAction,
  ButtonActionBinding,
  ButtonEffectType,
  CalendarProfile,
  CalendarSlot,
  CalendarModeAction,
} from "../types";
import { fetchJSON, API_BASE } from "./client";

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

export async function getActiveCalendar(): Promise<{
  profile: CalendarProfile;
  slots: CalendarSlot[];
}> {
  return fetchJSON(`${API_BASE}/calendar/active`);
}

export async function setActiveProfile(
  profileId: string,
): Promise<{ profile: CalendarProfile; slots: CalendarSlot[] }> {
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
  return fetchJSON<ButtonActionBinding>(
    `${API_BASE}/equipments/${equipmentId}/action-bindings/${bindingId}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
}

export async function removeButtonActionBinding(
  equipmentId: string,
  bindingId: string,
): Promise<void> {
  return fetchJSON<void>(`${API_BASE}/equipments/${equipmentId}/action-bindings/${bindingId}`, {
    method: "DELETE",
  });
}
