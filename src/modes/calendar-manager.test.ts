import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CalendarManager, CalendarError } from "./calendar-manager.js";
import { ModeManager } from "./mode-manager.js";
import { SettingsManager } from "../core/settings-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of ["002_zones.sql", "007_settings.sql", "010_modes.sql"]) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", `../../migrations/${file}`),
      "utf-8",
    );
    db.exec(sql);
  }
  return db;
}

const logger = createLogger("silent");

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

describe("CalendarManager", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let settingsManager: SettingsManager;
  let modeManager: ModeManager;
  let calendarManager: CalendarManager;
  let events: EngineEvent[];

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    settingsManager = new SettingsManager(db);
    modeManager = new ModeManager(
      db,
      eventBus,
      createMockEquipmentManager(),
      createMockRecipeManager(),
      logger,
    );
    calendarManager = new CalendarManager(db, eventBus, settingsManager, modeManager, logger);
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    db.close();
  });

  // ── Profiles ─────────────────────────────────────────────

  describe("profiles", () => {
    it("lists built-in profiles (Travail, Vacances)", () => {
      const profiles = calendarManager.listProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles[0].builtIn).toBe(true);
      expect(profiles[1].builtIn).toBe(true);
      const names = profiles.map((p) => p.name);
      expect(names).toContain("Travail");
      expect(names).toContain("Vacances");
    });

    it("returns Travail as default active profile", () => {
      const active = calendarManager.getActiveProfile();
      expect(active.id).toBe("travail");
      expect(active.name).toBe("Travail");
    });

    it("switches active profile", () => {
      calendarManager.setActiveProfile("vacances");
      const active = calendarManager.getActiveProfile();
      expect(active.id).toBe("vacances");
    });

    it("emits calendar.profile.changed on switch", () => {
      calendarManager.setActiveProfile("vacances");
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "calendar.profile.changed",
          profileId: "vacances",
          profileName: "Vacances",
        }),
      );
    });

    it("throws when setting unknown profile as active", () => {
      expect(() => calendarManager.setActiveProfile("nope")).toThrow(CalendarError);
    });

    it("falls back to default when stored profile was deleted", () => {
      // Set a setting pointing to a non-existent profile
      settingsManager.set("calendar.activeProfileId", "deleted-profile");
      const active = calendarManager.getActiveProfile();
      expect(active.id).toBe("travail");
    });

    it("persists active profile across instances", () => {
      calendarManager.setActiveProfile("vacances");
      // Create a new CalendarManager instance with the same DB
      const cm2 = new CalendarManager(db, eventBus, settingsManager, modeManager, logger);
      expect(cm2.getActiveProfile().id).toBe("vacances");
    });
  });

  // ── Slots CRUD ──────────────────────────────────────────

  describe("slots", () => {
    it("adds a slot to a profile", () => {
      const slot = calendarManager.addSlot("travail", [1, 2, 3, 4, 5], "08:00", ["mode-1"]);
      expect(slot.id).toBeTruthy();
      expect(slot.profileId).toBe("travail");
      expect(slot.days).toEqual([1, 2, 3, 4, 5]);
      expect(slot.time).toBe("08:00");
      expect(slot.modeIds).toEqual(["mode-1"]);
    });

    it("lists slots for a profile sorted by time", () => {
      calendarManager.addSlot("travail", [1, 2, 3], "18:00", ["mode-b"]);
      calendarManager.addSlot("travail", [1, 2, 3], "08:00", ["mode-a"]);
      const slots = calendarManager.listSlots("travail");
      expect(slots).toHaveLength(2);
      expect(slots[0].time).toBe("08:00");
      expect(slots[1].time).toBe("18:00");
    });

    it("returns empty list for profile with no slots", () => {
      const slots = calendarManager.listSlots("vacances");
      expect(slots).toHaveLength(0);
    });

    it("throws when adding slot to non-existent profile", () => {
      expect(() => calendarManager.addSlot("nope", [1], "08:00", ["m"])).toThrow(CalendarError);
    });

    it("updates a slot (days only)", () => {
      const slot = calendarManager.addSlot("travail", [1, 2, 3], "08:00", ["mode-1"]);
      const updated = calendarManager.updateSlot(slot.id, { days: [0, 6] });
      expect(updated.days).toEqual([0, 6]);
      expect(updated.time).toBe("08:00");
      expect(updated.modeIds).toEqual(["mode-1"]);
    });

    it("updates a slot (time only)", () => {
      const slot = calendarManager.addSlot("travail", [1, 2, 3], "08:00", ["mode-1"]);
      const updated = calendarManager.updateSlot(slot.id, { time: "09:30" });
      expect(updated.time).toBe("09:30");
      expect(updated.days).toEqual([1, 2, 3]);
    });

    it("updates a slot (modeIds only)", () => {
      const slot = calendarManager.addSlot("travail", [1, 2, 3], "08:00", ["mode-1"]);
      const updated = calendarManager.updateSlot(slot.id, { modeIds: ["mode-2", "mode-3"] });
      expect(updated.modeIds).toEqual(["mode-2", "mode-3"]);
      expect(updated.time).toBe("08:00");
    });

    it("updates a slot (all fields)", () => {
      const slot = calendarManager.addSlot("travail", [1, 2, 3], "08:00", ["mode-1"]);
      const updated = calendarManager.updateSlot(slot.id, {
        days: [0, 6],
        time: "22:00",
        modeIds: ["mode-x"],
      });
      expect(updated.days).toEqual([0, 6]);
      expect(updated.time).toBe("22:00");
      expect(updated.modeIds).toEqual(["mode-x"]);
    });

    it("throws when updating non-existent slot", () => {
      expect(() => calendarManager.updateSlot("nope", { time: "10:00" })).toThrow(CalendarError);
    });

    it("removes a slot", () => {
      const slot = calendarManager.addSlot("travail", [1], "08:00", ["m"]);
      calendarManager.removeSlot(slot.id);
      const slots = calendarManager.listSlots("travail");
      expect(slots).toHaveLength(0);
    });

    it("throws when removing non-existent slot", () => {
      expect(() => calendarManager.removeSlot("nope")).toThrow(CalendarError);
    });

    it("slots are isolated per profile", () => {
      calendarManager.addSlot("travail", [1], "08:00", ["m1"]);
      calendarManager.addSlot("vacances", [1], "10:00", ["m2"]);
      expect(calendarManager.listSlots("travail")).toHaveLength(1);
      expect(calendarManager.listSlots("vacances")).toHaveLength(1);
    });

    it("supports multiple mode IDs per slot", () => {
      const slot = calendarManager.addSlot("travail", [1, 2], "07:00", [
        "mode-a",
        "mode-b",
        "mode-c",
      ]);
      expect(slot.modeIds).toEqual(["mode-a", "mode-b", "mode-c"]);
      const fetched = calendarManager.listSlots("travail");
      expect(fetched[0].modeIds).toEqual(["mode-a", "mode-b", "mode-c"]);
    });

    it("preserves profileId on update", () => {
      const slot = calendarManager.addSlot("travail", [1], "08:00", ["m"]);
      const updated = calendarManager.updateSlot(slot.id, { time: "09:00" });
      expect(updated.profileId).toBe("travail");
    });
  });

  // ── Init (scheduling) ──────────────────────────────────

  describe("init", () => {
    it("initializes without error with no slots", () => {
      expect(() => calendarManager.init()).not.toThrow();
    });

    it("initializes with slots in active profile", () => {
      calendarManager.addSlot("travail", [1, 2, 3, 4, 5], "08:00", ["mode-1"]);
      calendarManager.addSlot("travail", [1, 2, 3, 4, 5], "18:00", ["mode-2"]);
      expect(() => calendarManager.init()).not.toThrow();
    });

    it("does not crash on invalid cron expression", () => {
      // Insert a slot with invalid time directly in DB to test robustness
      db.prepare(
        "INSERT INTO calendar_slots (id, profile_id, days, time, mode_ids) VALUES (?, ?, ?, ?, ?)",
      ).run("bad-slot", "travail", "[]", "invalid", '["m"]');
      // Should not throw — logs error internally
      expect(() => calendarManager.init()).not.toThrow();
    });
  });

  // ── Cascade delete ─────────────────────────────────────

  describe("cascade delete", () => {
    it("deletes slots when profile is deleted", () => {
      calendarManager.addSlot("travail", [1], "08:00", ["m1"]);
      calendarManager.addSlot("travail", [1], "18:00", ["m2"]);
      // Delete profile directly (no API method — verify FK cascade)
      db.prepare("DELETE FROM calendar_profiles WHERE id = ?").run("travail");
      const slots = calendarManager.listSlots("travail");
      expect(slots).toHaveLength(0);
    });
  });
});
