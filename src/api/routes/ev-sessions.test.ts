import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../core/logger.js";
import {
  EvSessionError,
  type EvSessionTracker,
} from "../../energy/ev-sessions/ev-session-tracker.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import { registerEvSessionRoutes } from "./ev-sessions.js";

const logger = createLogger("silent").logger;

describe("EV session routes (spec 191)", () => {
  let app: ReturnType<typeof Fastify>;
  let tracker: {
    listByCharger: ReturnType<typeof vi.fn>;
    listByVehicle: ReturnType<typeof vi.fn>;
    summary: ReturnType<typeof vi.fn>;
    setAttribution: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tracker = {
      listByCharger: vi.fn(() => [{ id: "s1" }]),
      listByVehicle: vi.fn(() => [{ id: "s2" }]),
      summary: vi.fn(() => ({ vehicleId: "v1", month: "2026-11" })),
      setAttribution: vi.fn((id: string) => ({ id, attribution: "vehicle" })),
    };
    app = Fastify({ logger: false, ajv: validationAjvOptions });
    installValidationErrorHandler(app);
    registerEvSessionRoutes(app, {
      evSessionTracker: tracker as unknown as EvSessionTracker,
      logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists a charger's sessions for a month", async () => {
    const res = await app.inject({ url: "/api/v1/ev-sessions?chargerId=c1&month=2026-11" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessions: [{ id: "s1" }] });
    expect(tracker.listByCharger).toHaveBeenCalledWith("c1", "2026-11");
  });

  it("lists a vehicle's sessions, this month by default", async () => {
    const res = await app.inject({ url: "/api/v1/ev-sessions?vehicleId=v1" });
    expect(res.statusCode).toBe(200);
    expect(tracker.listByVehicle.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}$/);
  });

  it("asks for exactly one of chargerId and vehicleId", async () => {
    expect((await app.inject({ url: "/api/v1/ev-sessions" })).statusCode).toBe(400);
    expect(
      (await app.inject({ url: "/api/v1/ev-sessions?chargerId=c&vehicleId=v" })).statusCode,
    ).toBe(400);
  });

  it("rejects a malformed month", async () => {
    const res = await app.inject({ url: "/api/v1/ev-sessions?chargerId=c1&month=2026-13" });
    expect(res.statusCode).toBe(400);
  });

  it("serves a vehicle's monthly summary", async () => {
    const res = await app.inject({ url: "/api/v1/ev-sessions/summary?vehicleId=v1&month=2026-11" });
    expect(res.statusCode).toBe(200);
    expect(tracker.summary).toHaveBeenCalledWith("v1", "2026-11");
  });

  it("sets a session to a vehicle, to other, back to attribute", async () => {
    for (const body of [
      { target: "vehicle", vehicleId: "v1" },
      { target: "other" },
      { target: "unattributed" },
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/ev-sessions/s1/attribution",
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(tracker.setAttribution).toHaveBeenLastCalledWith("s1", body);
    }
  });

  it("rejects a vehicle target without a vehicle and an unknown target", async () => {
    for (const payload of [
      { target: "vehicle" },
      { target: "other", vehicleId: "v1" },
      { target: "car" },
      {},
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/ev-sessions/s1/attribution",
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("answers 404 for an unknown session and 400 for an unknown vehicle", async () => {
    tracker.setAttribution.mockImplementationOnce(() => {
      throw new EvSessionError("Session not found", "not-found");
    });
    const missing = await app.inject({
      method: "PUT",
      url: "/api/v1/ev-sessions/nope/attribution",
      payload: { target: "other" },
    });
    expect(missing.statusCode).toBe(404);

    tracker.setAttribution.mockImplementationOnce(() => {
      throw new EvSessionError("Unknown vehicle", "invalid-vehicle");
    });
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/v1/ev-sessions/s1/attribution",
      payload: { target: "vehicle", vehicleId: "charger" },
    });
    expect(invalid.statusCode).toBe(400);
  });
});
