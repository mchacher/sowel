import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { registerEquipmentRoutes } from "./equipments.js";

// The ?type filter is the only logic worth exercising at the route
// layer; the rest of the equipment surface is covered by manager-level
// tests. A mocked EquipmentManager keeps this test fast and isolated.
function makeManager(fixture: Array<{ id: string; type: string }>) {
  return {
    getAllWithDetails: () => fixture,
    getByIdWithDetails: () => null,
    // The rest of the EquipmentManager interface is unused by the
    // routes we exercise here; we cast through `unknown` so the mock
    // does not have to enumerate every signature.
  } as unknown as Parameters<typeof registerEquipmentRoutes>[1]["equipmentManager"];
}

describe("GET /api/v1/equipments — ?type filter", () => {
  let app: ReturnType<typeof Fastify>;

  const fixture = [
    { id: "1", type: "light_onoff" },
    { id: "2", type: "energy_meter" },
    { id: "3", type: "energy_meter" },
    { id: "4", type: "main_energy_meter" },
  ];

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerEquipmentRoutes(app, {
      equipmentManager: makeManager(fixture),
      logger: createLogger("silent").logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns all equipments when ?type is omitted", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/equipments" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(4);
  });

  it("narrows the result set to a single type when ?type is set", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/equipments?type=energy_meter",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; type: string }>;
    expect(body).toHaveLength(2);
    expect(body.every((eq) => eq.type === "energy_meter")).toBe(true);
  });

  it("returns an empty list for an unknown type (pass-through, no 400)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/equipments?type=does_not_exist",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
