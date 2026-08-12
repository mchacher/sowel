import { create } from "zustand";
import type { BatteryAlert, EngineEvent } from "../types";
import { getBatteryAlerts } from "../api";
import { useDevices } from "./useDevices";
import { useZones } from "./useZones";
import { useEquipments } from "./useEquipments";
import { useZoneAggregation } from "./useZoneAggregation";
import { useRecipes } from "./useRecipes";
import { useModes } from "./useModes";
import { useActivity } from "./useActivity";
import { useArbiter } from "./useArbiter";
import { INTEGRATION_LABELS } from "../constants";

export type WsTopic =
  | "devices"
  | "equipments"
  | "zones"
  | "modes"
  | "recipes"
  | "calendar"
  | "system"
  | "activity"
  | "energy";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface SystemAlarm {
  alarmId: string;
  level: "warning" | "error";
  source: string;
  message: string;
}

export interface UpdateAvailableInfo {
  current: string;
  latest: string;
  releaseUrl: string;
}

interface WebSocketState {
  status: ConnectionStatus;
  integrationStatuses: Record<string, string>;
  alarms: Map<string, SystemAlarm>;
  /** Active low-battery alerts (spec 143) — drives the equipment indicator. */
  batteryAlerts: BatteryAlert[];
  updateAvailable: UpdateAvailableInfo | null;
  updateInProgress: boolean;
  restartRequired: string | null; // reason, e.g. "home_location_changed"
  setUpdateAvailable: (info: UpdateAvailableInfo | null) => void;
  setUpdateInProgress: (inProgress: boolean) => void;
  setRestartRequired: (reason: string | null) => void;
  connect: () => void;
  disconnect: () => void;
  subscribe: (topics: WsTopic[]) => void;
}

const BATTERY_ALARM_PREFIX = "battery-low:";

/**
 * Battery alarms carry no device id (the alarm event shape is generic), so the
 * authoritative list is refetched whenever one moves. Rare event, one small GET.
 */
function refreshBatteryAlertsIfNeeded(alarmId: string): void {
  if (!alarmId.startsWith(BATTERY_ALARM_PREFIX)) return;
  void fetchBatteryAlerts();
}

/** Same wording as the engine alarm, so a restored banner reads identically. */
export function batteryAlarmMessage(value: string): string {
  const num = Number(value);
  const isPercentage = value.trim() !== "" && Number.isFinite(num) && num >= 0 && num <= 100;
  return isPercentage ? `Low battery: ${value}%` : "Low battery";
}

async function fetchBatteryAlerts(): Promise<BatteryAlert[]> {
  try {
    const alerts = await getBatteryAlerts();
    useWebSocket.setState({ batteryAlerts: alerts });
    return alerts;
  } catch {
    return [];
  }
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let currentTopics: WsTopic[] = ["system"];
const MAX_RECONNECT_DELAY = 30_000;

function getWsUrl(): string {
  // In dev mode, connect directly to the backend to avoid Vite proxy EPIPE issues
  const wsHost = import.meta.env.DEV ? `${window.location.hostname}:3000` : window.location.host;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${wsHost}/ws`;
}

function getWsSubprotocol(): string | undefined {
  const token = localStorage.getItem("sowel_access_token");
  return token ? `bearer.${token}` : undefined;
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
    case "equipment.status.changed":
      useEquipments.getState().handleEquipmentStatusChanged(
        event.equipmentId,
        event.newStatus
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
    case "system.alarm.raised":
      useWebSocket.setState((s) => {
        const alarms = new Map(s.alarms);
        alarms.set(event.alarmId, {
          alarmId: event.alarmId,
          level: event.level,
          source: event.source,
          message: event.message,
        });
        return { alarms };
      });
      refreshBatteryAlertsIfNeeded(event.alarmId);
      break;
    case "system.alarm.resolved":
      useWebSocket.setState((s) => {
        const alarms = new Map(s.alarms);
        alarms.delete(event.alarmId);
        return { alarms };
      });
      refreshBatteryAlertsIfNeeded(event.alarmId);
      break;
    case "system.update.available":
      useWebSocket.setState({
        updateAvailable: {
          current: event.current,
          latest: event.latest,
          releaseUrl: event.releaseUrl,
        },
      });
      break;
    case "system.update.progress":
      useWebSocket.setState({ updateInProgress: true });
      break;
    case "system.update.error":
      useWebSocket.setState({ updateInProgress: false });
      break;
    case "system.restart_required":
      useWebSocket.setState({ restartRequired: event.reason });
      break;
    case "activity.added":
      useActivity.getState().addItem(event.item);
      break;
    // Spec 140 — capacity arbiter: patch the live number instantly, then
    // refetch the full read model. A status event also fires when suspensions
    // change (which the status value doesn't carry), so a debounced full
    // refresh is needed for the suspension chip to appear/clear live.
    case "energy.arbiter.status":
      useArbiter.getState().patchStatus(event.state, event.availableSurplusW);
      useArbiter.getState().refreshSoon();
      break;
    case "energy.capacity.granted":
    case "energy.capacity.revoked":
    case "energy.capacity.denied":
    case "energy.capacity.released":
      useArbiter.getState().refreshSoon();
      break;
  }
}

export const useWebSocket = create<WebSocketState>((set) => ({
  status: "disconnected",
  integrationStatuses: {},
  alarms: new Map(),
  batteryAlerts: [],
  updateAvailable: null,
  updateInProgress: false,
  restartRequired: null,

  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  setUpdateInProgress: (inProgress) => set({ updateInProgress: inProgress }),
  setRestartRequired: (reason) => set({ restartRequired: reason }),

  connect: () => {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    set({ status: "connecting" });
    const subprotocol = getWsSubprotocol();
    ws = subprotocol ? new WebSocket(getWsUrl(), subprotocol) : new WebSocket(getWsUrl());

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

      // Rebuild the alarm banner from server state: integration health, plus
      // the low-battery alerts (spec 143), which outlive both a page reload and
      // a Sowel restart. Resolved together so neither clobbers the other.
      Promise.all([
        fetch("/api/v1/health")
          .then((r) => r.json() as Promise<{ integrations?: Record<string, { status: string }> }>)
          .catch(() => ({}) as { integrations?: Record<string, { status: string }> }),
        fetchBatteryAlerts(),
      ])
        .then(([health, batteryAlerts]) => {
          const statuses: Record<string, string> = {};
          const alarms = new Map<string, SystemAlarm>();

          for (const [id, info] of Object.entries(health.integrations ?? {})) {
            statuses[id] = info.status;
            // Restore alarm banner for integrations in error state
            if (info.status === "error") {
              const label = INTEGRATION_LABELS[id] ?? id;
              alarms.set(`poll-fail:${id}`, {
                alarmId: `poll-fail:${id}`,
                level: "error",
                source: label,
                message: "Communication en échec",
              });
            }
          }

          for (const alert of batteryAlerts) {
            const alarmId = `${BATTERY_ALARM_PREFIX}${alert.deviceDataId}`;
            // Mirror the engine's live alarm (spec 143/#472): the equipment
            // name(s) headline the banner, the device name stays in the message.
            const equipmentNames = alert.equipmentNames ?? [];
            const bound = equipmentNames.length > 0;
            alarms.set(alarmId, {
              alarmId,
              level: "warning",
              source: bound ? equipmentNames.join(", ") : alert.deviceName,
              message: bound
                ? `${batteryAlarmMessage(alert.value)} (${alert.deviceName})`
                : batteryAlarmMessage(alert.value),
            });
          }

          set({ integrationStatuses: statuses, alarms });
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
    set({ status: "disconnected", integrationStatuses: {}, alarms: new Map() });
  },

  subscribe: (topics) => {
    currentTopics = topics;
    sendSubscribe(topics);
  },
}));
