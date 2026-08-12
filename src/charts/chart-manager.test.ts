import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ChartManager, ChartError } from "./chart-manager.js";
import { createLogger } from "../core/logger.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";
import type { SavedChartConfig } from "../shared/types.js";

const logger = createLogger("silent").logger;

const CONFIG: SavedChartConfig = {
  series: [{ equipmentId: "eq-1", alias: "temperature" }],
  period: "day",
  date: "2026-08-12",
};

describe("ChartManager", () => {
  let db: Database.Database;
  let manager: ChartManager;

  beforeEach(() => {
    db = createMigratedTestDb();
    manager = new ChartManager(db, logger);
  });

  afterEach(() => {
    db.close();
  });

  describe("createChart", () => {
    it("persists a chart and returns it with the config round-tripped", () => {
      const chart = manager.createChart("My chart", CONFIG);

      expect(chart.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(chart.name).toBe("My chart");
      expect(chart.config).toEqual(CONFIG);
      expect(chart.createdAt).toBeTruthy();
      expect(manager.getChart(chart.id)?.config.series[0].alias).toBe("temperature");
    });

    it("trims the name before storing", () => {
      const chart = manager.createChart("  spaced  ", CONFIG);
      expect(chart.name).toBe("spaced");
    });

    it("rejects an empty or whitespace-only name with a 400 ChartError", () => {
      expect(() => manager.createChart("", CONFIG)).toThrow(ChartError);
      expect(() => manager.createChart("   ", CONFIG)).toThrow(ChartError);
      try {
        manager.createChart("", CONFIG);
      } catch (e) {
        expect((e as ChartError).status).toBe(400);
      }
    });
  });

  describe("listCharts", () => {
    it("returns an empty array when there are no charts", () => {
      expect(manager.listCharts()).toEqual([]);
    });

    it("returns charts ordered by name", () => {
      manager.createChart("Zeta", CONFIG);
      manager.createChart("Alpha", CONFIG);
      manager.createChart("Mike", CONFIG);

      expect(manager.listCharts().map((c) => c.name)).toEqual(["Alpha", "Mike", "Zeta"]);
    });
  });

  describe("getChart", () => {
    it("returns null for an unknown id", () => {
      expect(manager.getChart("nope")).toBeNull();
    });
  });

  describe("updateChart", () => {
    it("updates the name while keeping the existing config", () => {
      const chart = manager.createChart("Original", CONFIG);
      const updated = manager.updateChart(chart.id, { name: "Renamed" });

      expect(updated.name).toBe("Renamed");
      expect(updated.config).toEqual(CONFIG);
    });

    it("updates the config while keeping the existing name", () => {
      const chart = manager.createChart("Keep me", CONFIG);
      const newConfig: SavedChartConfig = {
        series: [{ equipmentId: "eq-2", alias: "humidity" }],
        timeRange: "24h",
      };

      const updated = manager.updateChart(chart.id, { config: newConfig });
      expect(updated.name).toBe("Keep me");
      expect(updated.config).toEqual(newConfig);
      // Round-trips through the DB, not just the returned object.
      expect(manager.getChart(chart.id)?.config).toEqual(newConfig);
    });

    it("throws a 404 ChartError for an unknown id", () => {
      try {
        manager.updateChart("missing", { name: "x" });
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ChartError);
        expect((e as ChartError).status).toBe(404);
      }
    });

    it("blanks the name on an all-whitespace update (asymmetry with createChart)", () => {
      // `updates.name?.trim() ?? existing.name`: "   ".trim() is "" which is
      // NOT nullish, so `??` does not fall back — the name is set to "".
      // createChart rejects an empty name (400) but updateChart does not; this
      // test pins the current (asymmetric) behavior so a future fix is deliberate.
      const chart = manager.createChart("Original", CONFIG);
      const updated = manager.updateChart(chart.id, { name: "   " });
      expect(updated.name).toBe("");
    });
  });

  describe("deleteChart", () => {
    it("removes the chart", () => {
      const chart = manager.createChart("Doomed", CONFIG);
      manager.deleteChart(chart.id);

      expect(manager.getChart(chart.id)).toBeNull();
      expect(manager.listCharts()).toEqual([]);
    });

    it("throws a 404 ChartError for an unknown id", () => {
      try {
        manager.deleteChart("missing");
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ChartError);
        expect((e as ChartError).status).toBe(404);
      }
    });
  });
});
