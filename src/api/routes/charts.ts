import type { FastifyInstance } from "fastify";
import type { ChartManager } from "../../charts/chart-manager.js";
import { ChartError } from "../../charts/chart-manager.js";
import type { SavedChartConfig } from "../../shared/types.js";

interface ChartsDeps {
  chartManager: ChartManager;
}

export function registerChartRoutes(app: FastifyInstance, deps: ChartsDeps): void {
  const { chartManager } = deps;

  // GET /api/v1/charts
  app.get("/api/v1/charts", async () => {
    return chartManager.listCharts();
  });

  // GET /api/v1/charts/:id
  app.get<{ Params: { id: string } }>("/api/v1/charts/:id", async (request, reply) => {
    const chart = chartManager.getChart(request.params.id);
    if (!chart) return reply.code(404).send({ error: "Chart not found" });
    return chart;
  });

  // POST /api/v1/charts
  app.post<{
    Body: { name: string; config: SavedChartConfig };
  }>("/api/v1/charts", async (request, reply) => {
    const { name, config } = request.body ?? {};
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!config) return reply.code(400).send({ error: "config is required" });

    try {
      const chart = chartManager.createChart(name, config);
      return reply.code(201).send(chart);
    } catch (err) {
      if (err instanceof ChartError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /api/v1/charts/:id
  app.put<{
    Params: { id: string };
    Body: { name?: string; config?: SavedChartConfig };
  }>("/api/v1/charts/:id", async (request, reply) => {
    try {
      const chart = chartManager.updateChart(request.params.id, request.body ?? {});
      return chart;
    } catch (err) {
      if (err instanceof ChartError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /api/v1/charts/:id
  app.delete<{ Params: { id: string } }>("/api/v1/charts/:id", async (request, reply) => {
    try {
      chartManager.deleteChart(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ChartError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
