import { create } from "zustand";
import type { EngineEvent } from "../types";
import { useDevices } from "./useDevices";
import { useZones } from "./useZones";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface WebSocketState {
  status: ConnectionStatus;
  mqttConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30_000;

function getWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function getReconnectDelay(): number {
  const base = 1000;
  const delay = Math.min(base * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  return delay + Math.random() * 500; // jitter
}

function handleEvent(event: EngineEvent): void {
  const devices = useDevices.getState();

  switch (event.type) {
    case "device.discovered":
      devices.addDevice(event.device);
      break;
    case "device.removed":
      devices.removeDevice(event.deviceId);
      break;
    case "device.status_changed":
      devices.updateDeviceStatus(event.deviceId, event.status);
      break;
    case "device.data.updated":
      devices.updateDeviceDataValue(
        event.deviceId,
        event.key,
        event.value,
        event.timestamp
      );
      break;
    case "zone.created":
      useZones.getState().handleZoneCreated(event.zone);
      break;
    case "zone.updated":
      useZones.getState().handleZoneUpdated(event.zone);
      break;
    case "zone.removed":
      useZones.getState().handleZoneRemoved(event.zoneId);
      break;
    case "group.created":
      useZones.getState().handleGroupCreated(event.group);
      break;
    case "group.updated":
      useZones.getState().handleGroupUpdated(event.group);
      break;
    case "group.removed":
      useZones.getState().handleGroupRemoved(event.groupId);
      break;
    case "system.mqtt.connected":
      useWebSocket.setState({ mqttConnected: true });
      break;
    case "system.mqtt.disconnected":
      useWebSocket.setState({ mqttConnected: false });
      break;
  }
}

export const useWebSocket = create<WebSocketState>((set) => ({
  status: "disconnected",
  mqttConnected: false,

  connect: () => {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    set({ status: "connecting" });
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      set({ status: "connected" });
      reconnectAttempts = 0;

      // Fetch initial MQTT status from health endpoint
      fetch("/api/v1/health")
        .then((r) => r.json())
        .then((data: { mqtt?: { connected?: boolean } }) => {
          if (data.mqtt?.connected !== undefined) {
            set({ mqttConnected: data.mqtt.connected });
          }
        })
        .catch(() => {
          // Ignore — will be updated by WS events
        });
    };

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as EngineEvent;
        handleEvent(event);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      set({ status: "disconnected" });
      ws = null;
      // Auto-reconnect
      reconnectTimer = setTimeout(() => {
        reconnectAttempts++;
        useWebSocket.getState().connect();
      }, getReconnectDelay());
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  },

  disconnect: () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    set({ status: "disconnected", mqttConnected: false });
  },
}));
