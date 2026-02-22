import type { FastifyInstance } from "fastify";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { Logger } from "../../core/logger.js";

interface DevicesDeps {
  deviceManager: DeviceManager;
  logger: Logger;
}

export function registerDeviceRoutes(app: FastifyInstance, deps: DevicesDeps): void {
  const { deviceManager } = deps;

  // GET /api/v1/devices — List all devices with current data
  app.get("/api/v1/devices", async () => {
    return deviceManager.getAllWithData();
  });

  // GET /api/v1/devices/:id — Get device with data and orders
  app.get<{ Params: { id: string } }>("/api/v1/devices/:id", async (request, reply) => {
    const device = deviceManager.getByIdWithDetails(request.params.id);
    if (!device) {
      return reply.code(404).send({ error: "Device not found" });
    }
    return device;
  });

  // PUT /api/v1/devices/:id — Update device (name, zoneId)
  app.put<{
    Params: { id: string };
    Body: { name?: string; zoneId?: string | null };
  }>("/api/v1/devices/:id", async (request, reply) => {
    const { name, zoneId } = request.body ?? {};

    if (name === undefined && zoneId === undefined) {
      return reply
        .code(400)
        .send({ error: "No update fields provided. Use 'name' and/or 'zoneId'." });
    }

    const device = deviceManager.update(request.params.id, { name, zoneId });
    if (!device) {
      return reply.code(404).send({ error: "Device not found" });
    }
    return device;
  });

  // DELETE /api/v1/devices/:id — Remove device
  app.delete<{ Params: { id: string } }>("/api/v1/devices/:id", async (request, reply) => {
    const deleted = deviceManager.delete(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: "Device not found" });
    }
    return reply.code(204).send();
  });

  // GET /api/v1/devices/:id/raw — Get raw zigbee2mqtt expose data
  app.get<{ Params: { id: string } }>("/api/v1/devices/:id/raw", async (request, reply) => {
    const device = deviceManager.getById(request.params.id);
    if (!device) {
      return reply.code(404).send({ error: "Device not found" });
    }

    const rawExpose = deviceManager.getRawExpose(request.params.id);
    return {
      deviceId: device.id,
      name: device.name,
      sourceDeviceId: device.sourceDeviceId,
      expose: rawExpose,
    };
  });
}
