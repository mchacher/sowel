import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Observe channel sends by mocking the channel modules.
const telegramSend = vi.fn().mockResolvedValue(undefined);
vi.mock("./channels/telegram.js", () => ({
  TelegramChannel: class {
    send = telegramSend;
    testConnection = vi.fn();
  },
}));
const webPushSend = vi.fn().mockResolvedValue(undefined);
vi.mock("./channels/web-push.js", () => ({
  WebPushChannel: class {
    send = webPushSend;
    testConnection = vi.fn();
  },
}));

import { NotificationPublishService, isActiveValue } from "./notification-publish-service.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

const logger = createLogger("silent").logger;

describe("isActiveValue", () => {
  it("treats true / non-zero / meaningful strings / timestamps as active", () => {
    for (const v of [true, 1, -3, "open", "true", "2026-07-04T21:00:00.000Z"]) {
      expect(isActiveValue(v)).toBe(true);
    }
  });
  it("treats false / 0 / null / empty / 'false' / '0' as inactive", () => {
    for (const v of [false, 0, null, undefined, "", "  ", "false", "FALSE", "0"]) {
      expect(isActiveValue(v)).toBe(false);
    }
  });
});

// ── Repeat lifecycle harness ─────────────────────────────────

const INSTANCE = "inst-1";

function makeService(mapping: {
  sourceKey: string;
  repeatMs?: number | null;
  repeatMax?: number | null;
  throttleMs?: number;
}) {
  const state: Record<string, unknown> = { alarm: false, alarmSince: null };
  let handler: ((e: EngineEvent) => void) | null = null;

  const publisher = {
    id: "pub-1",
    name: "Test",
    channelType: "telegram",
    channelConfig: { botToken: "t", chatId: "c" },
    enabled: true,
    mappings: [
      {
        id: "map-1",
        publisherId: "pub-1",
        message: "Alarm",
        sourceType: "recipe" as const,
        sourceId: INSTANCE,
        sourceKey: mapping.sourceKey,
        throttleMs: mapping.throttleMs ?? 300_000,
        repeatMs: mapping.repeatMs ?? null,
        repeatMax: mapping.repeatMax ?? null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  const deps = [
    { on: (h: (e: EngineEvent) => void) => ((handler = h), () => {}) }, // eventBus
    {
      getAllWithMappings: () => [publisher],
      getById: () => publisher,
      getByIdWithMappings: () => publisher,
    }, // publisherManager
    { getDataBindingsWithValues: () => [] }, // equipmentManager
    { getAll: () => ({}) }, // zoneAggregator
    { getInstanceState: () => ({ ...state }) }, // recipeManager
    {}, // pushSubscriptionManager
    { publicKey: "p", privateKey: "k", subject: "mailto:a@b.c" }, // vapid
    logger,
  ] as unknown as ConstructorParameters<typeof NotificationPublishService>;

  const svc = new NotificationPublishService(...deps);
  svc.init();

  return {
    svc,
    setState(key: string, value: unknown) {
      state[key] = value;
    },
    fire() {
      handler?.({ type: "recipe.instance.state.changed", instanceId: INSTANCE, recipeId: "r" });
    },
  };
}

describe("re-notify lifecycle (spec 128)", () => {
  beforeEach(() => {
    telegramSend.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T10:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("forever: initial send + a reminder every repeatMs, silent stop on deactivation", () => {
    const h = makeService({ sourceKey: "alarm", repeatMs: 1000 });

    h.setState("alarm", true);
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(1); // activation

    vi.advanceTimersByTime(1000);
    expect(telegramSend).toHaveBeenCalledTimes(2); // reminder 1
    vi.advanceTimersByTime(1000);
    expect(telegramSend).toHaveBeenCalledTimes(3); // reminder 2

    h.setState("alarm", false);
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(3); // deactivation is silent

    vi.advanceTimersByTime(5000);
    expect(telegramSend).toHaveBeenCalledTimes(3); // timer stopped
    h.svc.destroy();
  });

  it("limited: initial + at most N reminders, then silent while still active", () => {
    const h = makeService({ sourceKey: "alarm", repeatMs: 1000, repeatMax: 2 });
    h.setState("alarm", true);
    h.fire();
    vi.advanceTimersByTime(1000); // reminder 1
    vi.advanceTimersByTime(1000); // reminder 2
    vi.advanceTimersByTime(1000); // cap reached → no send
    vi.advanceTimersByTime(3000);
    expect(telegramSend).toHaveBeenCalledTimes(3); // initial + 2 reminders
    h.svc.destroy();
  });

  it("timer re-check stops when the value clears to null without an event", () => {
    const h = makeService({ sourceKey: "alarmSince", repeatMs: 1000 });
    h.setState("alarmSince", "2026-07-04T10:00:00.000Z");
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(1);

    // Cleared to null — the change dispatch ignores null, but the next tick re-reads it.
    h.setState("alarmSince", null);
    vi.advanceTimersByTime(1000);
    expect(telegramSend).toHaveBeenCalledTimes(1); // tick saw null → stopped, no send
    vi.advanceTimersByTime(3000);
    expect(telegramSend).toHaveBeenCalledTimes(1);
    h.svc.destroy();
  });

  it("mode none (no repeatMs): notifies on change, never repeats", () => {
    const h = makeService({ sourceKey: "alarm" });
    h.setState("alarm", true);
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(telegramSend).toHaveBeenCalledTimes(1); // no reminders
    h.svc.destroy();
  });
});

describe("boolean simple mappings notify on activation only", () => {
  beforeEach(() => {
    telegramSend.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T10:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("does not notify when a boolean clears (washing-machine start regression)", () => {
    const h = makeService({ sourceKey: "alarm" });

    // End of cycle: alarm raises → one notification.
    h.setState("alarm", true);
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(1);

    // Start of next cycle: alarm clears → must stay silent (this used to
    // re-send the same "done" message on the falling edge).
    vi.advanceTimersByTime(2000); // past the 1s recipe-event burst dedup
    h.setState("alarm", false);
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(1);

    // Next end of cycle: raises again → notifies again.
    vi.advanceTimersByTime(2000);
    h.setState("alarm", true);
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(2);
    h.svc.destroy();
  });

  it("stays silent when the first observed boolean value is false", () => {
    const h = makeService({ sourceKey: "alarm" });
    h.setState("alarm", false);
    h.fire();
    expect(telegramSend).not.toHaveBeenCalled();
    h.svc.destroy();
  });

  it("string transitions still notify on every change", () => {
    const h = makeService({ sourceKey: "status" });
    h.setState("status", "running");
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000); // past the 1s recipe-event burst dedup
    h.setState("status", "done");
    h.fire();
    expect(telegramSend).toHaveBeenCalledTimes(2);
    h.svc.destroy();
  });
});

// ── System alarm broadcast (spec 143) ────────────────────────

interface PublisherSpec {
  id: string;
  channelType: string;
  enabled: boolean;
}

/** A service wired to publishers with no mapping — system alarms need none. */
function makeAlarmService(publishers: PublisherSpec[]) {
  let handler: ((e: EngineEvent) => void) | null = null;
  const rows = publishers.map((p) => ({
    ...p,
    name: p.id,
    channelConfig: { botToken: "t", chatId: "c" },
    mappings: [],
  }));

  const deps = [
    { on: (h: (e: EngineEvent) => void) => ((handler = h), () => {}) }, // eventBus
    { getAllWithMappings: () => rows, getById: () => rows[0], getByIdWithMappings: () => rows[0] },
    { getDataBindingsWithValues: () => [] }, // equipmentManager
    { getAll: () => ({}) }, // zoneAggregator
    { getInstanceState: () => ({}) }, // recipeManager
    {}, // pushSubscriptionManager
    { publicKey: "p", privateKey: "k", subject: "mailto:a@b.c" }, // vapid
    logger,
  ] as unknown as ConstructorParameters<typeof NotificationPublishService>;

  const svc = new NotificationPublishService(...deps);
  svc.init();

  return {
    svc,
    raise() {
      handler?.({
        type: "system.alarm.raised",
        alarmId: "battery-low:dd-1",
        level: "warning",
        source: "Capteur porte",
        message: "Low battery: 12%",
      });
    },
  };
}

describe("system alarm broadcast (spec 143)", () => {
  beforeEach(() => {
    telegramSend.mockClear();
    webPushSend.mockClear();
    telegramSend.mockResolvedValue(undefined);
  });

  it("sends to every enabled publisher, whatever the channel", () => {
    const h = makeAlarmService([
      { id: "pub-tg", channelType: "telegram", enabled: true },
      { id: "pub-wp", channelType: "web-push", enabled: true },
    ]);
    h.raise();

    expect(telegramSend).toHaveBeenCalledTimes(1);
    expect(webPushSend).toHaveBeenCalledTimes(1);
    expect(webPushSend.mock.calls[0][1]).toEqual({ title: "⚠️ Capteur porte : Low battery: 12%" });
    h.svc.destroy();
  });

  it("reaches a web-push-only install (no Telegram publisher)", () => {
    const h = makeAlarmService([{ id: "pub-wp", channelType: "web-push", enabled: true }]);
    h.raise();

    expect(webPushSend).toHaveBeenCalledTimes(1);
    expect(telegramSend).not.toHaveBeenCalled();
    h.svc.destroy();
  });

  it("skips disabled publishers", () => {
    const h = makeAlarmService([
      { id: "pub-tg", channelType: "telegram", enabled: false },
      { id: "pub-wp", channelType: "web-push", enabled: true },
    ]);
    h.raise();

    expect(telegramSend).not.toHaveBeenCalled();
    expect(webPushSend).toHaveBeenCalledTimes(1);
    h.svc.destroy();
  });

  it("a failing channel does not stop the others", () => {
    telegramSend.mockRejectedValueOnce(new Error("bot token revoked"));
    const h = makeAlarmService([
      { id: "pub-tg", channelType: "telegram", enabled: true },
      { id: "pub-wp", channelType: "web-push", enabled: true },
    ]);
    h.raise();

    expect(telegramSend).toHaveBeenCalledTimes(1);
    expect(webPushSend).toHaveBeenCalledTimes(1);
    h.svc.destroy();
  });
});
