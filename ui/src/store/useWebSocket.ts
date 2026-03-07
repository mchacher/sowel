import { create } from "zustand";
import type { EngineEvent } from "../types";
import { useDevices } from "./useDevices";
import { useZones } from "./useZones";
import { useEquipments } from "./useEquipments";
import { useZoneAggregation } from "./useZoneAggregation";
import { useRecipes } from "./useRecipes";
import { useModes } from "./useModes";

export type WsTopic = "devices" | "equipments" | "zones" | "modes" | "recipes" | "calendar" | "system";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface WebSocketState {
  status: ConnectionStatus;
  integrationStatuses: Record<string, string>;
  connect: () => void;
  disconnect: () => void;
  subscribe: (topics: WsTopic[]) => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let currentTopics: WsTopic[] = ["system"];
const MAX_RECONNECT_DELAY = 30_000;

function getWsUrl(): string {
  const token = localStorage.getItem("sowel_access_token");
  // In dev mode, connect directly to the backend to avoid Vite proxy EPIPE issues
  const wsHost = import.meta.env.DEV ? `${window.location.hostname}:3000` : window.location.host;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${protocol}//${wsHost}/ws`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function getReconnectDelay(): number {
  const base = 1000;
  const delay = Math.min(base * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  return delay + Math.random() * 500; // jitter
}

function sendSubscribe(topics: WsTopic[]): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "subscribe", topics }));
  }
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
    case "device.heartbeat":
      devices.updateDeviceHeartbeat(event.deviceId, event.timestamp);
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
    case "zone.data.changed":
      useZoneAggregation.getState().handleZoneDataChanged(event.zoneId, event.aggregatedData);
      break;
    case "equipment.created":
      useEquipments.getState().handleEquipmentCreated();
      break;
    case "equipment.updated":
      useEquipments.getState().handleEquipmentUpdated();
      break;
    case "equipment.removed":
      useEquipments.getState().handleEquipmentRemoved();
      break;
    case "equipment.data.changed":
      useEquipments.getState().handleEquipmentDataChanged(
        event.equipmentId,
        event.alias,
        event.value
      );
      break;
    case "recipe.instance.created":
    case "recipe.instance.removed":
    case "recipe.instance.started":
    case "recipe.instance.stopped":
    case "recipe.instance.error":
    case "recipe.instance.state.changed":
      useRecipes.getState().handleInstanceChanged();
      break;
    case "mode.created":
    case "mode.updated":
    case "mode.removed":
      useModes.getState().handleModeEvent();
      break;
    case "mode.activated":
      useModes.getState().handleModeActivated(event.modeId);
      break;
    case "mode.deactivated":
      useModes.getState().handleModeDeactivated(event.modeId);
      break;
    case "system.integration.connected":
      useWebSocket.setState((s) => ({
        integrationStatuses: { ...s.integrationStatuses, [event.integrationId]: "connected" },
      }));
      break;
    case "system.integration.disconnected":
      useWebSocket.setState((s) => ({
        integrationStatuses: { ...s.integrationStatuses, [event.integrationId]: "disconnected" },
      }));
      break;
  }
}

export const useWebSocket = create<WebSocketState>((set) => ({
  status: "disconnected",
  integrationStatuses: {},

  connect: () => {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    set({ status: "connecting" });
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      set({ status: "connected" });
      reconnectAttempts = 0;

      // Re-send current subscriptions after (re)connect
      sendSubscribe(currentTopics);

      // Refetch all stores to recover data missed while disconnected
      useDevices.getState().fetchDevices();
      useEquipments.getState().fetchEquipments();
      useZones.getState().fetchZones();
      useZoneAggregation.getState().fetchAggregation();
      useRecipes.getState().fetchRecipes();
      useRecipes.getState().fetchInstances();
      useModes.getState().fetchModes();

      // Fetch integration statuses from health endpoint
      fetch("/api/v1/health")
        .then((r) => r.json())
        .then((data: { integrations?: Record<string, { status: string }> }) => {
          if (data.integrations) {
            const statuses: Record<string, string> = {};
            for (const [id, info] of Object.entries(data.integrations)) {
              statuses[id] = info.status;
            }
            set({ integrationStatuses: statuses });
          }
        })
        .catch(() => {
          // Ignore — will be updated by WS events
        });
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as EngineEvent | EngineEvent[];
        // Backend sends batched arrays
        const events = Array.isArray(data) ? data : [data];
        for (const event of events) {
          handleEvent(event);
        }
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
    set({ status: "disconnected", integrationStatuses: {} });
  },

  subscribe: (topics) => {
    currentTopics = topics;
    sendSubscribe(topics);
  },
}));
