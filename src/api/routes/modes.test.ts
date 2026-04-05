import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModeManager } from "../../modes/mode-manager.js";
import { EventBus } from "../../core/event-bus.js";
import { createLogger } from "../../core/logger.js";
import { registerModeRoutes } from "./modes.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of ["001_initial.sql"]) {
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

describe("Mode API routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof Fastify>;
  let modeManager: ModeManager;

  beforeEach(async () => {
    db = createTestDb();
    const eventBus = new EventBus(logger);
    modeManager = new ModeManager(
      db,
      eventBus,
      createMockEquipmentManager(),
      createMockRecipeManager(),
      logger,
    );

    app = Fastify({ logger: false });
    registerModeRoutes(app, { modeManager, logger });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // ── GET /api/v1/modes ──────────────────────────────────

  describe("GET /api/v1/modes", () => {
    it("returns empty array when no modes exist", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/modes" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("returns all modes with details", async () => {
      modeManager.createMode("Mode A");
      modeManager.createMode("Mode B");
      const res = await app.inject({ method: "GET", url: "/api/v1/modes" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0]).toHaveProperty("impacts");
    });
  });

  // ── GET /api/v1/modes/:id ──────────────────────────────

  describe("GET /api/v1/modes/:id", () => {
    it("returns a mode by id", async () => {
      const mode = modeManager.createMode("Test");
      const res = await app.inject({ method: "GET", url: `/api/v1/modes/${mode.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("Test");
    });

    it("returns 404 for unknown mode", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/modes/unknown" });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/modes ─────────────────────────────────

  describe("POST /api/v1/modes", () => {
    it("creates a mode", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/modes",
        payload: { name: "Confort", description: "Mode confort", icon: "sun" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe("Confort");
      expect(body.description).toBe("Mode confort");
      expect(body.icon).toBe("sun");
    });

    it("returns 400 when name is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/modes",
        payload: { description: "No name" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PUT /api/v1/modes/:id ──────────────────────────────

  describe("PUT /api/v1/modes/:id", () => {
    it("updates a mode", async () => {
      const mode = modeManager.createMode("Old");
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/modes/${mode.id}`,
        payload: { name: "New", description: "Updated" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("New");
      expect(res.json().description).toBe("Updated");
    });

    it("returns 404 for unknown mode", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/modes/unknown",
        payload: { name: "x" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/v1/modes/:id ───────────────────────────

  describe("DELETE /api/v1/modes/:id", () => {
    it("deletes a mode", async () => {
      const mode = modeManager.createMode("ToDelete");
      const res = await app.inject({ method: "DELETE", url: `/api/v1/modes/${mode.id}` });
      expect(res.statusCode).toBe(204);
      // Verify it's gone
      const check = await app.inject({ method: "GET", url: `/api/v1/modes/${mode.id}` });
      expect(check.statusCode).toBe(404);
    });

    it("returns 404 for unknown mode", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/v1/modes/unknown" });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/modes/:id/activate ────────────────────

  describe("POST /api/v1/modes/:id/activate", () => {
    it("activates a mode", async () => {
      const mode = modeManager.createMode("Test");
      const res = await app.inject({ method: "POST", url: `/api/v1/modes/${mode.id}/activate` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(modeManager.getMode(mode.id)!.active).toBe(true);
    });

    it("returns 404 for unknown mode", async () => {
      const res = await app.inject({ method: "POST", url: "/api/v1/modes/unknown/activate" });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/modes/:id/deactivate ──────────────────

  describe("POST /api/v1/modes/:id/deactivate", () => {
    it("deactivates a mode", async () => {
      const mode = modeManager.createMode("Test");
      modeManager.activateMode(mode.id);
      const res = await app.inject({ method: "POST", url: `/api/v1/modes/${mode.id}/deactivate` });
      expect(res.statusCode).toBe(200);
      expect(modeManager.getMode(mode.id)!.active).toBe(false);
    });

    it("returns 404 for unknown mode", async () => {
      const res = await app.inject({ method: "POST", url: "/api/v1/modes/unknown/deactivate" });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/modes/:id/apply-to-zone/:zoneId ──────

  describe("POST /api/v1/modes/:id/apply-to-zone/:zoneId", () => {
    it("applies mode to zone", async () => {
      const zoneId = "zone-1";
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zoneId, "Salon");
      const mode = modeManager.createMode("Test");
      modeManager.setZoneImpact(mode.id, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/modes/${mode.id}/apply-to-zone/${zoneId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("returns 404 for unknown mode", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/modes/unknown/apply-to-zone/zone-1",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/zones/:zoneId/mode-impacts ─────────────

  describe("GET /api/v1/zones/:zoneId/mode-impacts", () => {
    it("returns impacts for a zone", async () => {
      const zoneId = "zone-1";
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zoneId, "Salon");
      const mode = modeManager.createMode("Test");
      modeManager.setZoneImpact(mode.id, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      const res = await app.inject({ method: "GET", url: `/api/v1/zones/${zoneId}/mode-impacts` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].zoneId).toBe(zoneId);
    });

    it("returns empty array for zone without impacts", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/zones/empty/mode-impacts" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── PUT /api/v1/modes/:id/impacts/:zoneId ──────────────

  describe("PUT /api/v1/modes/:id/impacts/:zoneId", () => {
    it("sets zone impacts", async () => {
      const zoneId = "zone-1";
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zoneId, "Salon");
      const mode = modeManager.createMode("Test");
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/modes/${mode.id}/impacts/${zoneId}`,
        payload: {
          actions: [{ type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().actions).toHaveLength(1);
    });

    it("returns 400 when actions is not an array", async () => {
      const mode = modeManager.createMode("Test");
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/modes/${mode.id}/impacts/zone-1`,
        payload: { actions: "not-array" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for unknown mode", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/modes/unknown/impacts/zone-1",
        payload: { actions: [] },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/v1/modes/:id/impacts/:zoneId ───────────

  describe("DELETE /api/v1/modes/:id/impacts/:zoneId", () => {
    it("removes zone impacts", async () => {
      const zoneId = "zone-1";
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zoneId, "Salon");
      const mode = modeManager.createMode("Test");
      modeManager.setZoneImpact(mode.id, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/modes/${mode.id}/impacts/${zoneId}`,
      });
      expect(res.statusCode).toBe(204);
      expect(modeManager.getImpactsByZone(zoneId)).toHaveLength(0);
    });
  });
});
