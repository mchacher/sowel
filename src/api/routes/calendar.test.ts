import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CalendarManager } from "../../modes/calendar-manager.js";
import { ModeManager } from "../../modes/mode-manager.js";
import { SettingsManager } from "../../core/settings-manager.js";
import { EventBus } from "../../core/event-bus.js";
import { createLogger } from "../../core/logger.js";
import { registerCalendarRoutes } from "./calendar.js";
import type { CalendarModeAction } from "../../shared/types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of [
    "001_initial.sql",
    "002_mqtt_publisher_on_change_only.sql",
    "003_device_order_category.sql",
    "004_drop_dispatch_config.sql",
  ]) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", `../../../migrations/${file}`),
      "utf-8",
    );
    db.exec(sql);
  }
  return db;
}

const logger = createLogger("silent").logger;

function createMockEquipmentManager() {
  return { executeOrder: vi.fn() } as any;
}

function createMockRecipeManager() {
  return {
    enableInstance: vi.fn(),
    disableInstance: vi.fn(),
    updateInstanceParams: vi.fn(),
  } as any;
}

/** Helper to build a simple "on" action list */
function onActions(...modeIds: string[]): CalendarModeAction[] {
  return modeIds.map((modeId) => ({ modeId, action: "on" }));
}

describe("Calendar API routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof Fastify>;
  let calendarManager: CalendarManager;

  beforeEach(async () => {
    db = createTestDb();
    const eventBus = new EventBus(logger);
    const settingsManager = new SettingsManager(db);
    const modeManager = new ModeManager(
      db,
      eventBus,
      createMockEquipmentManager(),
      createMockRecipeManager(),
      logger,
    );
    calendarManager = new CalendarManager(db, eventBus, settingsManager, modeManager, logger);

    app = Fastify({ logger: false });
    registerCalendarRoutes(app, { calendarManager, logger });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // ── GET /api/v1/calendar/profiles ──────────────────────

  describe("GET /api/v1/calendar/profiles", () => {
    it("returns built-in profiles", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/calendar/profiles" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      const ids = body.map((p: any) => p.id);
      expect(ids).toContain("travail");
      expect(ids).toContain("vacances");
    });
  });

  // ── GET /api/v1/calendar/active ────────────────────────

  describe("GET /api/v1/calendar/active", () => {
    it("returns active profile with slots", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/calendar/active" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.profile.id).toBe("travail");
      expect(body.slots).toEqual([]);
    });

    it("includes slots for active profile", async () => {
      calendarManager.addSlot("travail", [1, 2, 3], "08:00", onActions("mode-1"));
      const res = await app.inject({ method: "GET", url: "/api/v1/calendar/active" });
      expect(res.json().slots).toHaveLength(1);
    });
  });

  // ── PUT /api/v1/calendar/active ────────────────────────

  describe("PUT /api/v1/calendar/active", () => {
    it("switches active profile", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/calendar/active",
        payload: { profileId: "vacances" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().profile.id).toBe("vacances");
    });

    it("returns 400 when profileId is missing", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/calendar/active",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for unknown profile", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/calendar/active",
        payload: { profileId: "unknown" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/calendar/profiles/:id/slots ────────────

  describe("GET /api/v1/calendar/profiles/:id/slots", () => {
    it("returns slots for a profile", async () => {
      calendarManager.addSlot("travail", [1, 2, 3, 4, 5], "07:30", onActions("m1"));
      calendarManager.addSlot("travail", [1, 2, 3, 4, 5], "18:00", onActions("m2"));
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/calendar/profiles/travail/slots",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it("returns empty array for profile with no slots", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/calendar/profiles/vacances/slots",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── POST /api/v1/calendar/profiles/:id/slots ───────────

  describe("POST /api/v1/calendar/profiles/:id/slots", () => {
    it("creates a slot", async () => {
      const modeActions = onActions("mode-1");
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calendar/profiles/travail/slots",
        payload: { days: [1, 2, 3, 4, 5], time: "08:00", modeActions },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.profileId).toBe("travail");
      expect(body.days).toEqual([1, 2, 3, 4, 5]);
      expect(body.time).toBe("08:00");
      expect(body.modeActions).toEqual(modeActions);
    });

    it("creates a slot with mixed on/off actions", async () => {
      const modeActions: CalendarModeAction[] = [
        { modeId: "work", action: "on" },
        { modeId: "vacation", action: "off" },
      ];
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calendar/profiles/travail/slots",
        payload: { days: [1, 2, 3, 4, 5], time: "08:00", modeActions },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().modeActions).toEqual(modeActions);
    });

    it("returns 400 when days is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calendar/profiles/travail/slots",
        payload: { time: "08:00", modeActions: onActions("m") },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when time is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calendar/profiles/travail/slots",
        payload: { days: [1], modeActions: onActions("m") },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when modeActions is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calendar/profiles/travail/slots",
        payload: { days: [1], time: "08:00" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for unknown profile", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calendar/profiles/unknown/slots",
        payload: { days: [1], time: "08:00", modeActions: onActions("m") },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PUT /api/v1/calendar/slots/:slotId ─────────────────

  describe("PUT /api/v1/calendar/slots/:slotId", () => {
    it("updates a slot", async () => {
      const slot = calendarManager.addSlot("travail", [1], "08:00", onActions("m1"));
      const newActions: CalendarModeAction[] = [{ modeId: "m2", action: "off" }];
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/calendar/slots/${slot.id}`,
        payload: { days: [0, 6], time: "10:00", modeActions: newActions },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.days).toEqual([0, 6]);
      expect(body.time).toBe("10:00");
      expect(body.modeActions).toEqual(newActions);
    });

    it("partial update (time only)", async () => {
      const slot = calendarManager.addSlot("travail", [1, 2], "08:00", onActions("m1"));
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/calendar/slots/${slot.id}`,
        payload: { time: "09:00" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().time).toBe("09:00");
      expect(res.json().days).toEqual([1, 2]);
    });

    it("returns 404 for unknown slot", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/calendar/slots/unknown",
        payload: { time: "10:00" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/v1/calendar/slots/:slotId ──────────────

  describe("DELETE /api/v1/calendar/slots/:slotId", () => {
    it("deletes a slot", async () => {
      const slot = calendarManager.addSlot("travail", [1], "08:00", onActions("m"));
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/calendar/slots/${slot.id}`,
      });
      expect(res.statusCode).toBe(204);
      expect(calendarManager.listSlots("travail")).toHaveLength(0);
    });

    it("returns 404 for unknown slot", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/v1/calendar/slots/unknown",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
