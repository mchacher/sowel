import { create } from "zustand";
import type { BatteryAlert, EngineEvent } from "../types";
import { getBatteryAlerts, getPvHealthAlerts, type PvHealthAlert } from "../api";
import { dayParam, type AlarmWording } from "../lib/alarm-message";
import { useDevices } from "./useDevices";
import { useZones } from "./useZones";
import { useEquipments } from "./useEquipments";
import { useZoneAggregation } from "./useZoneAggregation";
import { useRecipes } from "./useRecipes";
import { useModes } from "./useModes";
import { useActivity } from "./useActivity";
import { useArbiter } from "./useArbiter";

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

export interface SystemAlarm extends AlarmWording {
  alarmId: string;
  level: "warning" | "error";
  source: string;
}

export interface UpdateAvailableInfo {
  current: string;
  latest: string;
  releaseUrl: string;
}

/**
 * A self-update or a restart that stopped without swapping the container.
 *
 * `message` is free-form server text, so the WebSocket layer replaces it with
 * "[redacted]" for a non-admin client (see FREE_FORM_SYSTEM_FIELDS in
 * src/api/websocket.ts). `operation` survives that, which is why the copy hangs
 * off it and not off the message.
 */
export interface UpdateFailure {
  message: string;
  operation: "update" | "restart";
}

interface WebSocketState {
  status: ConnectionStatus;
  integrationStatuses: Record<string, string>;
  alarms: Map<string, SystemAlarm>;
  /** Active low-battery alerts (spec 143) — drives the equipment indicator. */
  batteryAlerts: BatteryAlert[];
  updateAvailable: UpdateAvailableInfo | null;
  updateInProgress: boolean;
  /** Why the last self-update or restart stopped, when it stopped without swapping. */
  updateFailure: UpdateFailure | null;
  restartRequired: string | null; // reason, e.g. "home_location_changed"
  setUpdateAvailable: (info: UpdateAvailableInfo | null) => void;
  setUpdateInProgress: (inProgress: boolean) => void;
  setUpdateFailure: (failure: UpdateFailure | null) => void;
  setRestartRequired: (reason: string | null) => void;
  connect: () => void;
  disconnect: () => void;
  subscribe: (topics: WsTopic[]) => void;
}

const BATTERY_ALARM_PREFIX = "battery-low:";

/**
 * Battery alarms carry no device id (the alarm event shape is generic), so the
 * authoritative list is refetched whenever one moves. Rare event, one small GET.
 *
 * A live raise arrives with the engine's English message; the refetched
 * snapshot carries the structured fields the banner words itself from, so the
 * standing alarm is re-worded here (#720) the way pv-health alarms are.
 */
function refreshBatteryAlertsIfNeeded(alarmId: string): void {
  if (!alarmId.startsWith(BATTERY_ALARM_PREFIX)) return;
  void fetchBatteryAlerts().then((alerts) => {
    useWebSocket.setState((s) => {
      const alarms = new Map(s.alarms);
      for (const alert of alerts) {
        const id = `${BATTERY_ALARM_PREFIX}${alert.deviceDataId}`;
        // A resolved alarm is already gone from the map; do not resurrect it.
        if (!alarms.has(id)) continue;
        alarms.set(id, batteryAlarm(alert));
      }
      return { alarms };
    });
  });
}

/**
 * Banner alarm for a low-battery alert (spec 143), worded from the snapshot's
 * structured fields. The equipment name(s) headline the alarm; the device name
 * stays in the message, and an unbound device keeps the device name as source.
 */
export function batteryAlarm(alert: BatteryAlert): SystemAlarm {
  const equipmentNames = alert.equipmentNames ?? [];
  const bound = equipmentNames.length > 0;
  const num = Number(alert.value);
  const isPercentage = alert.value.trim() !== "" && Number.isFinite(num) && num >= 0 && num <= 100;
  return {
    alarmId: `${BATTERY_ALARM_PREFIX}${alert.deviceDataId}`,
    level: "warning",
    source: bound ? equipmentNames.join(", ") : alert.deviceName,
    messageKey: isPercentage
      ? bound
        ? "alarms.battery.lowPctOnDevice"
        : "alarms.battery.lowPct"
      : bound
        ? "alarms.battery.lowOnDevice"
        : "alarms.battery.low",
    messageParams: { value: alert.value, device: alert.deviceName },
  };
}

const POLL_FAIL_ALARM_PREFIX = "poll-fail:";

/**
 * Banner alarm for a raise event.
 *
 * Integration plugins raise `poll-fail:<pluginId>` themselves, and they do it
 * with their own wording, in their own language ("Poll en échec : ETIMEDOUT"),
 * headlined by a display label rather than the plugin id. Two things follow,
 * both fixed here rather than in four plugin repos (#720):
 *
 *  - the banner spoke French to an English household. The failure is already
 *    something the UI knows how to word, so the plugin's sentence is replaced
 *    by the same key the integration status uses. The driver's error text is
 *    dropped, as it is on the status path; it stays in the logs and the feed.
 *  - headlining with the label made the alarm and the `integrationStatuses`
 *    entry for the same failure dedup under two different sources, so it
 *    rendered twice. Normalising the source to the plugin id, which the alarm
 *    id carries, makes the two collide as intended.
 */
function alarmFromEvent(event: {
  alarmId: string;
  level: "warning" | "error";
  source: string;
  message: string;
}): SystemAlarm {
  if (event.alarmId.startsWith(POLL_FAIL_ALARM_PREFIX)) {
    return {
      alarmId: event.alarmId,
      level: event.level,
      source: event.alarmId.slice(POLL_FAIL_ALARM_PREFIX.length),
      messageKey: "alarms.integration.error",
    };
  }
  return {
    alarmId: event.alarmId,
    level: event.level,
    source: event.source,
    message: event.message,
  };
}

const PV_HEALTH_ALARM_PREFIX = "pv-health:";

/**
 * Banner alarm for a standing PV health alert (spec 162).
 *
 * Worded client-side from the snapshot's structured fields, NOT taken from the
 * engine's message: engine events are English by repo convention, but the
 * banner is user-facing UI and has to speak the user's language. One function
 * for both the on-open seeding and the live-raise refresh, so the two can
 * never word the same alert differently.
 */
export function pvHealthAlarm(alert: PvHealthAlert): SystemAlarm {
  return {
    alarmId: `${PV_HEALTH_ALARM_PREFIX}${alert.equipmentId}`,
    level: "warning",
    source: alert.equipmentName,
    messageKey: "equipments.pvHealth.alarmBanner",
    messageParams: { pct: Math.round(alert.deficit * 100), since: dayParam(alert.since) },
  };
}

/**
 * A live pv-health raise arrives with the engine's English message; replace it
 * with the localised one from the snapshot, the way battery alerts refresh.
 */
function refreshPvHealthAlertsIfNeeded(alarmId: string): void {
  if (!alarmId.startsWith(PV_HEALTH_ALARM_PREFIX)) return;
  void getPvHealthAlerts()
    .then((alerts) => {
      useWebSocket.setState((s) => {
        const alarms = new Map(s.alarms);
        for (const alert of alerts) {
          const id = `${PV_HEALTH_ALARM_PREFIX}${alert.equipmentId}`;
          if (!alarms.has(id)) continue;
          alarms.set(id, pvHealthAlarm(alert));
        }
        return { alarms };
      });
    })
    .catch(() => {
      // The English live message stays; better than nothing.
    });
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
let foregroundHooksInstalled = false;
const MAX_RECONNECT_DELAY = 30_000;

/**
 * Re-sync the two surfaces that are fed only by live events after their mount
 * fetch (the capacity arbiter, issue #589, and the activity feed). Every other
 * WS-driven store recovers through its own `fetch*` in the `onopen` block; these
 * two have no such recovery, so they must be refetched explicitly whenever the
 * connection is (re)established or the tab returns to foreground.
 */
function recoverLiveOnlyStores(): void {
  useArbiter.getState().fetch();
  useArbiter.getState().refreshSoon(); // bump timelineRev so the timeline refetches
  useActivity.getState().retry(); // replay the last loadForZone (no-op if none)
}

/**
 * Foreground / network-back recovery. Mobile browsers freeze timers and silently
 * drop the socket while the PWA is backgrounded, and the `onclose` reconnect timer
 * is throttled until the tab is visible again. On resume:
 *  - reconnect if the socket is gone (`connect()` is a no-op when already OPEN or
 *    CONNECTING, so it only fires when the browser actually dropped it); the
 *    following `onopen` then resyncs every store.
 *  - if the socket still claims OPEN, the browser may have torn it down while
 *    frozen (a "zombie" whose `readyState` is stuck at OPEN), so `connect()`
 *    no-ops and no `onopen` runs. Refetch the live-only surfaces directly so
 *    foregrounding always refreshes them.
 * A logged-out tab must stay quiet: the listeners outlive `disconnect()`, so guard
 * on a stored access token before resurrecting a socket.
 */
function wakeReconnect(): void {
  if (!localStorage.getItem("sowel_access_token")) return;
  useWebSocket.getState().connect();
  if (ws?.readyState === WebSocket.OPEN) recoverLiveOnlyStores();
}

/** Installed once, on first connect. */
function installForegroundReconnect(): void {
  if (foregroundHooksInstalled) return;
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  foregroundHooksInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wakeReconnect();
  });
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", wakeReconnect);
  }
}

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
    // Spec 174 — the window opening, closing or failing changes what every
    // surface must draw, and it is not an equipment.updated: the row is not
    // touched, only the deadline it carries.
    case "equipment.timed_action.armed":
    case "equipment.timed_action.reverted":
    case "equipment.timed_action.disarmed":
    case "equipment.timed_action.failed":
      useEquipments.getState().handleEquipmentUpdated();
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
        alarms.set(event.alarmId, alarmFromEvent(event));
        return { alarms };
      });
      refreshBatteryAlertsIfNeeded(event.alarmId);
      refreshPvHealthAlertsIfNeeded(event.alarmId);
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
      useWebSocket.setState({ updateInProgress: true, updateFailure: null });
      break;
    case "system.update.error":
      useWebSocket.setState({
        updateInProgress: false,
        updateFailure: {
          message: event.error,
          // A restart helper reports through the same event, and the two
          // failures do not say the same thing to the user.
          operation: event.operation === "restart" ? "restart" : "update",
        },
      });
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
  updateFailure: null,
  restartRequired: null,

  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  setUpdateInProgress: (inProgress) => set({ updateInProgress: inProgress }),
  setUpdateFailure: (failure) => set({ updateFailure: failure }),
  setRestartRequired: (reason) => set({ restartRequired: reason }),

  connect: () => {
    installForegroundReconnect();
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
      // The arbiter (issue #589) and the activity feed are fed only by live
      // `energy.*` / `activity.added` events after their mount fetch, so a
      // reconnect would otherwise leave them frozen until the panel remounts.
      recoverLiveOnlyStores();

      // Rebuild the alarm banner from server state: integration health, plus
      // the low-battery alerts (spec 143), which outlive both a page reload and
      // a Sowel restart. Resolved together so neither clobbers the other.
      Promise.all([
        fetch("/api/v1/health")
          .then((r) => r.json() as Promise<{ integrations?: Record<string, { status: string }> }>)
          .catch(() => ({}) as { integrations?: Record<string, { status: string }> }),
        fetchBatteryAlerts(),
        // Spec 162 — standing PV health alerts. Raised exactly once and then
        // persisted server-side, so a session opened after the raise (or after
        // any restart, which every self-update causes) has no event to catch.
        getPvHealthAlerts().catch(() => []),
      ])
        .then(([health, batteryAlerts, pvHealthAlerts]) => {
          const statuses: Record<string, string> = {};
          const alarms = new Map<string, SystemAlarm>();

          // No alarm is restored for an integration in error: the status alone
          // is turned into a translated issue by `useAggregatedIssues`, and a
          // plugin that is still failing re-raises its own `poll-fail:` alarm
          // on its next cycle. Rebuilding one here restated the same failure
          // in hardcoded French, under the display label where the status path
          // keys on the plugin id, so the dedup by source never caught it and
          // the sheet listed it twice (#720).
          for (const [id, info] of Object.entries(health.integrations ?? {})) {
            statuses[id] = info.status;
          }

          for (const alert of batteryAlerts) {
            alarms.set(`${BATTERY_ALARM_PREFIX}${alert.deviceDataId}`, batteryAlarm(alert));
          }

          for (const alert of pvHealthAlerts) {
            alarms.set(`${PV_HEALTH_ALARM_PREFIX}${alert.equipmentId}`, pvHealthAlarm(alert));
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
