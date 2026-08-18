import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { useWebSocket as UseWsStore } from "./useWebSocket";

// ── Mock every downstream store the dispatcher/connect touches ──────────────
const S = vi.hoisted(() => ({
  devices: {
    addDevice: vi.fn(),
    removeDevice: vi.fn(),
    updateDeviceStatus: vi.fn(),
    updateDeviceDataValue: vi.fn(),
    updateDeviceHeartbeat: vi.fn(),
    fetchDevices: vi.fn(),
  },
  zones: {
    handleZoneCreated: vi.fn(),
    handleZoneUpdated: vi.fn(),
    handleZoneRemoved: vi.fn(),
    fetchZones: vi.fn(),
  },
  equipments: {
    handleEquipmentCreated: vi.fn(),
    handleEquipmentUpdated: vi.fn(),
    handleEquipmentRemoved: vi.fn(),
    handleEquipmentDataChanged: vi.fn(),
    handleEquipmentStatusChanged: vi.fn(),
    fetchEquipments: vi.fn(),
  },
  zoneAgg: { handleZoneDataChanged: vi.fn(), fetchAggregation: vi.fn() },
  recipes: { handleInstanceChanged: vi.fn(), fetchRecipes: vi.fn(), fetchInstances: vi.fn() },
  modes: {
    handleModeEvent: vi.fn(),
    handleModeActivated: vi.fn(),
    handleModeDeactivated: vi.fn(),
    fetchModes: vi.fn(),
  },
  activity: { addItem: vi.fn(), retry: vi.fn() },
  arbiter: { patchStatus: vi.fn(), refreshSoon: vi.fn(), fetch: vi.fn() },
}));

vi.mock("./useDevices", () => ({ useDevices: { getState: () => S.devices } }));
vi.mock("./useZones", () => ({ useZones: { getState: () => S.zones } }));
vi.mock("./useEquipments", () => ({ useEquipments: { getState: () => S.equipments } }));
vi.mock("./useZoneAggregation", () => ({ useZoneAggregation: { getState: () => S.zoneAgg } }));
vi.mock("./useRecipes", () => ({ useRecipes: { getState: () => S.recipes } }));
vi.mock("./useModes", () => ({ useModes: { getState: () => S.modes } }));
vi.mock("./useActivity", () => ({ useActivity: { getState: () => S.activity } }));
vi.mock("./useArbiter", () => ({ useArbiter: { getState: () => S.arbiter } }));

// The only ../api call in this store is getBatteryAlerts (banner restore path).
// Default to an empty list so the health-restore test is unaffected.
const api = vi.hoisted(() => ({ getBatteryAlerts: vi.fn(async () => [] as unknown[]) }));
vi.mock("../api", () => api);

// ── Fake WebSocket ──────────────────────────────────────────────────────────
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  protocol?: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string, protocol?: string) {
    this.url = url;
    this.protocol = protocol;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // test helpers
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  simulateClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

let useWebSocket: typeof UseWsStore;

function latestWs(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

async function loadStore(): Promise<void> {
  vi.resetModules();
  ({ useWebSocket } = await import("./useWebSocket"));
}

beforeEach(async () => {
  vi.clearAllMocks();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("window", {
    location: { hostname: "localhost", host: "localhost:5173", protocol: "http:" },
  });
  vi.stubGlobal("localStorage", makeStorage());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })),
  );
  vi.spyOn(Math, "random").mockReturnValue(0); // deterministic backoff (no jitter)
  await loadStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** connect() and return the freshly created fake socket. */
function connect(): FakeWebSocket {
  useWebSocket.getState().connect();
  return latestWs();
}

describe("connect", () => {
  it("sets status to connecting and opens a socket", () => {
    const ws = connect();
    expect(useWebSocket.getState().status).toBe("connecting");
    expect(ws).toBeDefined();
    expect(ws.url).toContain("/ws");
  });

  it("passes a bearer subprotocol when an access token is stored", async () => {
    localStorage.setItem("sowel_access_token", "tok-123");
    await loadStore();
    const ws = connect();
    expect(ws.protocol).toBe("bearer.tok-123");
  });

  it("does not open a second socket while one is connecting/open", () => {
    connect();
    useWebSocket.getState().connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("on open: marks connected, subscribes, and refetches the stores", () => {
    const ws = connect();
    ws.simulateOpen();

    expect(useWebSocket.getState().status).toBe("connected");
    expect(ws.sent[0]).toContain('"type":"subscribe"');
    // Every WS-driven store refetches so nothing missed while disconnected is stale.
    expect(S.devices.fetchDevices).toHaveBeenCalled();
    expect(S.equipments.fetchEquipments).toHaveBeenCalled();
    expect(S.zones.fetchZones).toHaveBeenCalled();
    expect(S.zoneAgg.fetchAggregation).toHaveBeenCalled();
    expect(S.recipes.fetchRecipes).toHaveBeenCalled();
    expect(S.recipes.fetchInstances).toHaveBeenCalled();
    expect(S.modes.fetchModes).toHaveBeenCalled();
  });

  it("on open: re-syncs the arbiter and the activity feed (issue #589)", () => {
    const ws = connect();
    ws.simulateOpen();

    // Both are fed only by live events after their mount fetch, so the reconnect
    // recovery must refetch them or they stay frozen until the panel remounts.
    expect(S.arbiter.fetch).toHaveBeenCalled();
    expect(S.arbiter.refreshSoon).toHaveBeenCalled();
    expect(S.activity.retry).toHaveBeenCalled();
  });

  it("on open: restores integration statuses and error alarms from the health endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          integrations: { zigbee2mqtt: { status: "connected" }, panasonic: { status: "error" } },
        }),
      })),
    );
    const ws = connect();
    ws.simulateOpen();

    // The health handler resolves through a fetch().then().then() chain.
    await vi.waitFor(() => {
      expect(useWebSocket.getState().integrationStatuses.zigbee2mqtt).toBe("connected");
    });

    const s = useWebSocket.getState();
    expect(s.integrationStatuses.panasonic).toBe("error");
    expect(s.alarms.get("poll-fail:panasonic")?.level).toBe("error");
  });

  it("on open: restores a battery banner headlined by the equipment name (spec 143/#472)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
    api.getBatteryAlerts.mockResolvedValue([
      { deviceDataId: "dd-1", deviceName: "Capteur porte", value: "12", equipmentNames: ["Détecteur salon"] },
      { deviceDataId: "dd-2", deviceName: "Capteur cave", value: "8", equipmentNames: [] },
    ]);

    const ws = connect();
    ws.simulateOpen();

    await vi.waitFor(() => {
      expect(useWebSocket.getState().alarms.get("battery-low:dd-1")).toBeDefined();
    });

    const bound = useWebSocket.getState().alarms.get("battery-low:dd-1");
    expect(bound?.source).toBe("Détecteur salon");
    expect(bound?.message).toBe("Low battery: 12% (Capteur porte)");

    // Unbound device falls back to the device name, no equipment in the message.
    const unbound = useWebSocket.getState().alarms.get("battery-low:dd-2");
    expect(unbound?.source).toBe("Capteur cave");
    expect(unbound?.message).toBe("Low battery: 8%");
  });
});

describe("handleEvent dispatch", () => {
  it("routes device events to the devices store", () => {
    const ws = connect();
    ws.simulateMessage({ type: "device.discovered", device: { id: "d1" } });
    ws.simulateMessage({ type: "device.removed", deviceId: "d1" });
    ws.simulateMessage({ type: "device.status_changed", deviceId: "d1", status: "online" });

    expect(S.devices.addDevice).toHaveBeenCalledWith({ id: "d1" });
    expect(S.devices.removeDevice).toHaveBeenCalledWith("d1");
    expect(S.devices.updateDeviceStatus).toHaveBeenCalledWith("d1", "online");
  });

  it("routes equipment.data.changed with id/alias/value", () => {
    const ws = connect();
    ws.simulateMessage({
      type: "equipment.data.changed",
      equipmentId: "eq-1",
      alias: "temperature",
      value: 21.5,
    });
    expect(S.equipments.handleEquipmentDataChanged).toHaveBeenCalledWith("eq-1", "temperature", 21.5);
  });

  it("routes zone.data.changed to the aggregation store", () => {
    const ws = connect();
    ws.simulateMessage({ type: "zone.data.changed", zoneId: "z1", aggregatedData: { temp: 20 } });
    expect(S.zoneAgg.handleZoneDataChanged).toHaveBeenCalledWith("z1", { temp: 20 });
  });

  it("routes mode.activated and recipe/activity events", () => {
    const ws = connect();
    ws.simulateMessage({ type: "mode.activated", modeId: "m1", modeName: "Night" });
    ws.simulateMessage({ type: "recipe.instance.started" });
    ws.simulateMessage({ type: "activity.added", item: { id: "a1" } });

    expect(S.modes.handleModeActivated).toHaveBeenCalledWith("m1");
    expect(S.recipes.handleInstanceChanged).toHaveBeenCalled();
    expect(S.activity.addItem).toHaveBeenCalledWith({ id: "a1" });
  });

  it("routes energy.arbiter.status to patchStatus + refreshSoon", () => {
    const ws = connect();
    ws.simulateMessage({ type: "energy.arbiter.status", state: "active", availableSurplusW: 1200 });
    expect(S.arbiter.patchStatus).toHaveBeenCalledWith("active", 1200);
    expect(S.arbiter.refreshSoon).toHaveBeenCalled();
  });

  it("unpacks a batched array of events", () => {
    const ws = connect();
    ws.simulateMessage([
      { type: "device.removed", deviceId: "d1" },
      { type: "device.removed", deviceId: "d2" },
    ]);
    expect(S.devices.removeDevice).toHaveBeenCalledTimes(2);
    expect(S.devices.removeDevice).toHaveBeenNthCalledWith(1, "d1");
    expect(S.devices.removeDevice).toHaveBeenNthCalledWith(2, "d2");
  });

  it("ignores a malformed (non-JSON) message without throwing", () => {
    const ws = connect();
    expect(() => ws.simulateMessage("this is not json")).not.toThrow();
    expect(S.devices.addDevice).not.toHaveBeenCalled();
  });

  it("routes the remaining device / zone / equipment / mode cases", () => {
    const ws = connect();
    ws.simulateMessage({
      type: "device.data.updated",
      deviceId: "d1",
      key: "temp",
      value: 20,
      timestamp: "t",
    });
    ws.simulateMessage({ type: "device.heartbeat", deviceId: "d1", timestamp: "t" });
    ws.simulateMessage({ type: "zone.created", zone: { id: "z1" } });
    ws.simulateMessage({ type: "zone.updated", zone: { id: "z1" } });
    ws.simulateMessage({ type: "zone.removed", zoneId: "z1" });
    ws.simulateMessage({ type: "equipment.created" });
    ws.simulateMessage({ type: "equipment.removed" });
    ws.simulateMessage({ type: "equipment.status.changed", equipmentId: "eq-1", newStatus: "offline" });
    ws.simulateMessage({ type: "mode.created" });
    ws.simulateMessage({ type: "mode.deactivated", modeId: "m1" });

    expect(S.devices.updateDeviceDataValue).toHaveBeenCalledWith("d1", "temp", 20, "t");
    expect(S.devices.updateDeviceHeartbeat).toHaveBeenCalledWith("d1", "t");
    expect(S.zones.handleZoneCreated).toHaveBeenCalledWith({ id: "z1" });
    expect(S.zones.handleZoneUpdated).toHaveBeenCalledWith({ id: "z1" });
    expect(S.zones.handleZoneRemoved).toHaveBeenCalledWith("z1");
    expect(S.equipments.handleEquipmentCreated).toHaveBeenCalled();
    expect(S.equipments.handleEquipmentRemoved).toHaveBeenCalled();
    expect(S.equipments.handleEquipmentStatusChanged).toHaveBeenCalledWith("eq-1", "offline");
    expect(S.modes.handleModeEvent).toHaveBeenCalled();
    expect(S.modes.handleModeDeactivated).toHaveBeenCalledWith("m1");
  });

  it("refreshes the arbiter on every capacity event", () => {
    const ws = connect();
    for (const type of [
      "energy.capacity.granted",
      "energy.capacity.revoked",
      "energy.capacity.denied",
      "energy.capacity.released",
    ]) {
      ws.simulateMessage({ type });
    }
    expect(S.arbiter.refreshSoon).toHaveBeenCalledTimes(4);
  });
});

describe("system events update the store", () => {
  it("tracks integration connect/disconnect", () => {
    const ws = connect();
    ws.simulateMessage({ type: "system.integration.connected", integrationId: "z2m" });
    expect(useWebSocket.getState().integrationStatuses.z2m).toBe("connected");
    ws.simulateMessage({ type: "system.integration.disconnected", integrationId: "z2m" });
    expect(useWebSocket.getState().integrationStatuses.z2m).toBe("disconnected");
  });

  it("adds and removes alarms", () => {
    const ws = connect();
    ws.simulateMessage({
      type: "system.alarm.raised",
      alarmId: "al-1",
      level: "error",
      source: "PAC",
      message: "down",
    });
    expect(useWebSocket.getState().alarms.get("al-1")?.message).toBe("down");
    ws.simulateMessage({ type: "system.alarm.resolved", alarmId: "al-1" });
    expect(useWebSocket.getState().alarms.has("al-1")).toBe(false);
  });

  it("records an available update and a restart-required reason", () => {
    const ws = connect();
    ws.simulateMessage({
      type: "system.update.available",
      current: "1.0.0",
      latest: "1.1.0",
      releaseUrl: "http://x",
    });
    expect(useWebSocket.getState().updateAvailable).toEqual({
      current: "1.0.0",
      latest: "1.1.0",
      releaseUrl: "http://x",
    });
    ws.simulateMessage({ type: "system.restart_required", reason: "home_location_changed" });
    expect(useWebSocket.getState().restartRequired).toBe("home_location_changed");
  });

  it("toggles updateInProgress on update progress then error", () => {
    const ws = connect();
    ws.simulateMessage({ type: "system.update.progress" });
    expect(useWebSocket.getState().updateInProgress).toBe(true);
    ws.simulateMessage({ type: "system.update.error" });
    expect(useWebSocket.getState().updateInProgress).toBe(false);
  });
});

describe("subscribe / disconnect", () => {
  it("sends a subscribe frame when the socket is open", () => {
    const ws = connect();
    ws.simulateOpen();
    ws.sent.length = 0; // drop the auto-subscribe from onopen
    useWebSocket.getState().subscribe(["devices", "zones"]);
    expect(ws.sent[0]).toBe(JSON.stringify({ type: "subscribe", topics: ["devices", "zones"] }));
  });

  it("re-sends the last topics after a reconnect", () => {
    vi.useFakeTimers();
    const ws1 = connect();
    ws1.simulateOpen();
    useWebSocket.getState().subscribe(["energy"]);

    ws1.simulateClose();
    vi.runOnlyPendingTimers(); // fire the reconnect timer → new socket
    const ws2 = latestWs();
    ws2.simulateOpen();

    expect(ws2.sent.some((m) => m.includes('"energy"'))).toBe(true);
  });

  it("disconnect closes the socket and clears status/alarms", () => {
    const ws = connect();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "system.alarm.raised",
      alarmId: "al-1",
      level: "warning",
      source: "x",
      message: "m",
    });
    useWebSocket.getState().disconnect();

    const s = useWebSocket.getState();
    expect(s.status).toBe("disconnected");
    expect(s.alarms.size).toBe(0);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });
});

describe("reconnect backoff", () => {
  it("schedules reconnects with exponential delay (jitter stubbed to 0)", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const ws1 = connect();
    ws1.simulateOpen(); // resets reconnectAttempts to 0
    ws1.simulateClose(); // schedules attempt #1
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1000);

    vi.runOnlyPendingTimers(); // reconnectAttempts -> 1, new socket
    latestWs().simulateClose(); // schedules attempt #2
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2000);

    vi.runOnlyPendingTimers();
    latestWs().simulateClose(); // attempt #3
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 4000);
  });
});

describe("foreground reconnect (issue #589)", () => {
  const docHandlers: Record<string, () => void> = {};
  const winHandlers: Record<string, () => void> = {};
  let visibility: "hidden" | "visible";

  async function setupWithForegroundHooks(): Promise<void> {
    for (const k of Object.keys(docHandlers)) delete docHandlers[k];
    for (const k of Object.keys(winHandlers)) delete winHandlers[k];
    visibility = "hidden";
    vi.stubGlobal("document", {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (type: string, h: () => void) => {
        docHandlers[type] = h;
      },
    });
    vi.stubGlobal("window", {
      location: { hostname: "localhost", host: "localhost:5173", protocol: "http:" },
      addEventListener: (type: string, h: () => void) => {
        winHandlers[type] = h;
      },
    });
    // wakeReconnect() guards on a stored token so a logged-out tab stays quiet.
    localStorage.setItem("sowel_access_token", "tok");
    await loadStore(); // fresh module so the once-only install guard is reset
  }

  it("reconnects when the tab returns to foreground after the socket dropped", async () => {
    vi.useFakeTimers();
    await setupWithForegroundHooks();

    const ws1 = connect();
    ws1.simulateOpen();
    expect(typeof docHandlers.visibilitychange).toBe("function");

    ws1.simulateClose(); // socket dropped while backgrounded
    const before = FakeWebSocket.instances.length;

    visibility = "visible";
    docHandlers.visibilitychange();
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it("reconnects when the network comes back online", async () => {
    vi.useFakeTimers();
    await setupWithForegroundHooks();

    const ws1 = connect();
    ws1.simulateOpen();
    ws1.simulateClose();
    const before = FakeWebSocket.instances.length;

    winHandlers.online();
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it("stays put while the tab is still hidden", async () => {
    vi.useFakeTimers();
    await setupWithForegroundHooks();

    const ws1 = connect();
    ws1.simulateOpen();
    ws1.simulateClose();
    const before = FakeWebSocket.instances.length;

    // visibility stays "hidden" — the handler must not force a reconnect.
    docHandlers.visibilitychange();
    expect(FakeWebSocket.instances.length).toBe(before);
  });

  it("recovers the live-only surfaces without a new socket when foregrounded while OPEN", async () => {
    vi.useFakeTimers();
    await setupWithForegroundHooks();

    const ws1 = connect();
    ws1.simulateOpen(); // still OPEN (possibly a zombie the OS silently killed)
    const before = FakeWebSocket.instances.length;
    vi.clearAllMocks(); // drop the arbiter/activity refetch from onopen

    visibility = "visible";
    docHandlers.visibilitychange();

    // connect() is a no-op while OPEN, so no new socket is created...
    expect(FakeWebSocket.instances.length).toBe(before);
    // ...but the live-only surfaces still refetch, so a zombie socket can't
    // leave the arbiter/activity frozen (issue #589).
    expect(S.arbiter.fetch).toHaveBeenCalled();
    expect(S.activity.retry).toHaveBeenCalled();
  });

  it("stays quiet when the tab has no stored access token (logged out)", async () => {
    vi.useFakeTimers();
    await setupWithForegroundHooks();

    const ws1 = connect();
    ws1.simulateOpen();
    ws1.simulateClose();
    const before = FakeWebSocket.instances.length;
    localStorage.removeItem("sowel_access_token");

    visibility = "visible";
    docHandlers.visibilitychange();
    winHandlers.online();
    // No token → no resurrection of the socket for a logged-out tab.
    expect(FakeWebSocket.instances.length).toBe(before);
  });
});
