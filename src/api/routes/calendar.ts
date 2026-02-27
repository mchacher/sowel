import type { FastifyInstance } from "fastify";
import type { CalendarManager } from "../../modes/calendar-manager.js";
import { CalendarError } from "../../modes/calendar-manager.js";
import type { Logger } from "../../core/logger.js";
import type { CalendarModeAction } from "../../shared/types.js";

interface CalendarDeps {
  calendarManager: CalendarManager;
  logger: Logger;
}

export function registerCalendarRoutes(app: FastifyInstance, deps: CalendarDeps): void {
  const { calendarManager } = deps;

  // GET /api/v1/calendar/profiles
  app.get("/api/v1/calendar/profiles", async () => {
    return calendarManager.listProfiles();
  });

  // GET /api/v1/calendar/active
  app.get("/api/v1/calendar/active", async () => {
    const profile = calendarManager.getActiveProfile();
    const slots = calendarManager.listSlots(profile.id);
    return { profile, slots };
  });

  // PUT /api/v1/calendar/active
  app.put<{
    Body: { profileId: string };
  }>("/api/v1/calendar/active", async (request, reply) => {
    const { profileId } = request.body ?? {};
    if (!profileId) return reply.code(400).send({ error: "profileId is required" });

    try {
      calendarManager.setActiveProfile(profileId);
      const profile = calendarManager.getActiveProfile();
      const slots = calendarManager.listSlots(profile.id);
      return { profile, slots };
    } catch (err) {
      if (err instanceof CalendarError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // GET /api/v1/calendar/profiles/:id/slots
  app.get<{ Params: { id: string } }>("/api/v1/calendar/profiles/:id/slots", async (request) => {
    return calendarManager.listSlots(request.params.id);
  });

  // POST /api/v1/calendar/profiles/:id/slots
  app.post<{
    Params: { id: string };
    Body: { days: number[]; time: string; modeActions: CalendarModeAction[] };
  }>("/api/v1/calendar/profiles/:id/slots", async (request, reply) => {
    const { days, time, modeActions } = request.body ?? {};
    if (!Array.isArray(days) || !time || !Array.isArray(modeActions)) {
      return reply.code(400).send({ error: "days, time, and modeActions are required" });
    }

    try {
      const slot = calendarManager.addSlot(request.params.id, days, time, modeActions);
      return reply.code(201).send(slot);
    } catch (err) {
      if (err instanceof CalendarError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /api/v1/calendar/slots/:slotId
  app.put<{
    Params: { slotId: string };
    Body: { days?: number[]; time?: string; modeActions?: CalendarModeAction[] };
  }>("/api/v1/calendar/slots/:slotId", async (request, reply) => {
    try {
      const slot = calendarManager.updateSlot(request.params.slotId, request.body ?? {});
      return slot;
    } catch (err) {
      if (err instanceof CalendarError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /api/v1/calendar/slots/:slotId
  app.delete<{ Params: { slotId: string } }>(
    "/api/v1/calendar/slots/:slotId",
    async (request, reply) => {
      try {
        calendarManager.removeSlot(request.params.slotId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof CalendarError)
          return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );
}
