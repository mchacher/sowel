import type {
  MqttBroker,
  MqttPublisher,
  MqttPublisherMapping,
  MqttPublisherWithMappings,
} from "../types";
import { fetchJSON, API_BASE } from "./client";

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
  onChangeOnly?: boolean;
}): Promise<MqttPublisher> {
  return fetchJSON<MqttPublisher>(`${API_BASE}/mqtt-publishers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateMqttPublisher(
  id: string,
  data: {
    name?: string;
    brokerId?: string;
    topic?: string;
    enabled?: boolean;
    onChangeOnly?: boolean;
  },
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
    enabled?: boolean;
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
    enabled?: boolean;
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
  import("../types").NotificationPublisherWithMappings[]
> {
  return fetchJSON(`${API_BASE}/notification-publishers`);
}

export async function createNotificationPublisher(data: {
  name: string;
  channelType: import("../types").NotificationChannelType;
  channelConfig: import("../types").NotificationChannelConfig;
  enabled?: boolean;
}): Promise<import("../types").NotificationPublisher> {
  return fetchJSON(`${API_BASE}/notification-publishers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateNotificationPublisher(
  id: string,
  data: {
    name?: string;
    channelType?: import("../types").NotificationChannelType;
    channelConfig?: import("../types").NotificationChannelConfig;
    enabled?: boolean;
  },
): Promise<import("../types").NotificationPublisher> {
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

export async function testNotificationPublisher(publisherId: string): Promise<{ sent: number }> {
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
    repeatMs?: number | null;
    repeatMax?: number | null;
  },
): Promise<import("../types").NotificationPublisherMapping> {
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
    repeatMs?: number | null;
    repeatMax?: number | null;
  },
): Promise<import("../types").NotificationPublisherMapping> {
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
