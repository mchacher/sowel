import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import { toISOUtc } from "../core/database.js";
import type { SavedChart, SavedChartConfig } from "../shared/types.js";

export class ChartManager {
  private readonly logger;
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "chart-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      list: this.db.prepare(`SELECT * FROM chart_configs ORDER BY name`),
      get: this.db.prepare(`SELECT * FROM chart_configs WHERE id = ?`),
      insert: this.db.prepare(`INSERT INTO chart_configs (id, name, config) VALUES (?, ?, ?)`),
      update: this.db.prepare(
        `UPDATE chart_configs SET name = ?, config = ?, updated_at = datetime('now') WHERE id = ?`,
      ),
      delete: this.db.prepare(`DELETE FROM chart_configs WHERE id = ?`),
    };
  }

  listCharts(): SavedChart[] {
    const rows = this.stmts.list.all() as ChartRow[];
    return rows.map(rowToChart);
  }

  getChart(id: string): SavedChart | null {
    const row = this.stmts.get.get(id) as ChartRow | undefined;
    return row ? rowToChart(row) : null;
  }

  createChart(name: string, config: SavedChartConfig): SavedChart {
    if (!name?.trim()) throw new ChartError("name is required", 400);

    const id = randomUUID();
    this.stmts.insert.run(id, name.trim(), JSON.stringify(config));
    const chart = this.getChart(id)!;
    this.logger.info({ chartId: id, name }, "Chart created");
    return chart;
  }

  updateChart(id: string, updates: { name?: string; config?: SavedChartConfig }): SavedChart {
    const existing = this.getChart(id);
    if (!existing) throw new ChartError(`Chart not found: ${id}`, 404);

    const newName = updates.name?.trim() ?? existing.name;
    const newConfig = updates.config ?? existing.config;

    this.stmts.update.run(newName, JSON.stringify(newConfig), id);
    const chart = this.getChart(id)!;
    this.logger.info({ chartId: id }, "Chart updated");
    return chart;
  }

  deleteChart(id: string): void {
    const existing = this.getChart(id);
    if (!existing) throw new ChartError(`Chart not found: ${id}`, 404);

    this.stmts.delete.run(id);
    this.logger.info({ chartId: id, name: existing.name }, "Chart deleted");
  }
}

// ── Row type & mapper ──────────────────────────────────────

interface ChartRow {
  id: string;
  name: string;
  config: string;
  created_at: string;
  updated_at: string;
}

function rowToChart(row: ChartRow): SavedChart {
  return {
    id: row.id,
    name: row.name,
    config: JSON.parse(row.config) as SavedChartConfig,
    createdAt: toISOUtc(row.created_at),
    updatedAt: toISOUtc(row.updated_at),
  };
}

// ── Error ────────────────────────────────────────────────────

export class ChartError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ChartError";
  }
}
