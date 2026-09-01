import type { FastifyInstance } from "fastify";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import { EquipmentError } from "../../equipments/equipment-manager.js";
import type { TimedActionManager } from "../../equipments/timed-action-manager.js";
import {
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  TimedActionError,
} from "../../equipments/timed-action-manager.js";
import { isSubmeterEquipment, METERING_RELAY_TYPES } from "../../equipments/metering.js";
import { isTimedCommandEligible } from "../../shared/timed-command.js";
import type {
  EnergyLoadProfile,
  EquipmentType,
  SolarProfile,
  TimedCommand,
} from "../../shared/types.js";
import { classifyPowerReading } from "../../shared/reading-freshness.js";
import type { Logger } from "../../core/logger.js";

interface EquipmentsDeps {
  equipmentManager: EquipmentManager;
  /** Spec 174. Absent in the test harnesses that do not wire it. */
  timedActionManager?: TimedActionManager;
  logger: Logger;
}

// Input schemas (issue #452). They encode the same rules the handlers checked
// by hand: name required and non-blank (<=100), type/zoneId required,
// description <=500, and the energy-profile bounds. Unknown fields stay
// unconstrained (additionalProperties defaults to allowed), so extra keys pass
// through and are ignored, exactly as before. The energyProfile rounding and
// the core-owned `learned` merge stay in the handler — they are business logic,
// not validation.
const createEquipmentBodySchema = {
  type: "object",
  required: ["name", "type", "zoneId"],
  properties: {
    name: { type: "string", pattern: "\\S", maxLength: 100 },
    type: { type: "string", minLength: 1 },
    zoneId: { type: "string", minLength: 1 },
    // null is allowed (create with no description), matching the old check that
    // only rejected an over-long non-empty string.
    description: { type: ["string", "null"], maxLength: 500 },
  },
};

import { validateSolarProfile } from "../../energy/pv/solar-profile.js";
import { NON_SUBMETER_TYPES } from "../../equipments/metering.js";
import { wouldCycle } from "../../energy/metering-nesting.js";

const updateEquipmentBodySchema = {
  type: "object",
  properties: {
    name: { type: "string", pattern: "\\S", maxLength: 100 },
    description: { type: ["string", "null"], maxLength: 500 },
    energyProfile: {
      type: ["object", "null"],
      required: ["class", "nominalPowerW", "minOnS", "minOffS"],
      properties: {
        class: { enum: ["comfort", "deferrable"] },
        nominalPowerW: { type: "number", exclusiveMinimum: 0, maximum: 30000 },
        minOnS: { type: "number", minimum: 0 },
        minOffS: { type: "number", minimum: 0 },
        toleratedImportW: { type: "number", minimum: 0, maximum: 30000 },
      },
    },
    requireConfirmation: { type: "boolean" },
    invertDirection: { type: "boolean" },
    // Spec 173 — id of the meter that already counts this equipment, or null.
    meteringParentId: { type: ["string", "null"], minLength: 1 },
    // Spec 174 phase 2 — the timed command this equipment offers, or null to
    // clear it. `value` and `revertValue` are deliberately unconstrained: an
    // order carries a boolean, an enum string, a number or nothing at all
    // depending on its binding, and the handler checks the alias and the
    // duration against the equipment itself.
    timedCommand: {
      type: ["object", "null"],
      required: ["alias", "durationMs"],
      properties: {
        alias: { type: "string", minLength: 1 },
        durationMs: { type: "number" },
      },
    },
    // Spec 160 — declared array geometry. The bounds are the same ones
    // `validateSolarProfile` enforces, repeated here so a malformed body is
    // refused at the edge rather than silently dropped when read back.
    solarProfile: {
      type: ["object", "null"],
      required: ["planes"],
      properties: {
        planes: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            required: ["tiltDeg", "azimuthDeg", "peakWc"],
            properties: {
              tiltDeg: { type: "number", minimum: 0, maximum: 90 },
              azimuthDeg: { type: "number", minimum: 0, exclusiveMaximum: 360 },
              peakWc: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
            },
          },
        },
        // Spec 161 — the array has been in this configuration since. Declared
        // here rather than left as an unlisted extra property so a client can
        // see it exists and a malformed one is refused at the edge. A date that
        // is merely wrong (future, too old) is not an error: it is discarded
        // when the backfill window is resolved.
        since: { type: ["string", "null"], maxLength: 40 },
      },
    },
  },
};

// Binding bodies (issue #452). Old guards: `!deviceDataId` / `!deviceOrderId`
// (bare truthiness, so minLength 1) and `!alias?.trim()` (rejects a blank or
// whitespace-only alias). The alias uses a `\S` pattern (a non-blank char) but,
// unlike name, NO maxLength — the old check never capped its length. The handler
// keeps `alias.trim()` normalization.
const nonBlankAlias = { type: "string", pattern: "\\S" };
// Spec 174 — arm a timed action. `value` and `revertValue` are deliberately
// unconstrained: an order carries a boolean, an enum string or a number
// depending on its binding, and the resolution against that binding happens in
// executeOrder, which is the one place that knows the shape.
// An explicit body carries the three values; an EMPTY body arms what the
// equipment's own configuration says (FR-13), so a tile does not restate values
// it does not own. `required` would forbid the empty form, hence
// `dependentRequired`: naming an alias is what makes the rest mandatory.
const armTimedActionBodySchema = {
  type: "object",
  properties: {
    alias: { type: "string", minLength: 1 },
    durationMs: { type: "number", minimum: MIN_DURATION_MS, maximum: MAX_DURATION_MS },
  },
  // `dependencies`, not `dependentRequired`: Fastify's Ajv runs draft-07 in
  // strict mode and refuses the 2019-09 keyword outright, at BOOT — the whole
  // server fails to start, not just this route.
  dependencies: { alias: ["revertValue", "durationMs"] },
};

const addDataBindingBodySchema = {
  type: "object",
  required: ["deviceDataId", "alias"],
  properties: { deviceDataId: { type: "string", minLength: 1 }, alias: nonBlankAlias },
};
const addOrderBindingBodySchema = {
  type: "object",
  required: ["deviceOrderId", "alias"],
  properties: { deviceOrderId: { type: "string", minLength: 1 }, alias: nonBlankAlias },
};

export function registerEquipmentRoutes(app: FastifyInstance, deps: EquipmentsDeps): void {
  const { equipmentManager, timedActionManager } = deps;

  // GET /api/v1/equipments — List all equipments with bindings and current data.
  // Optional ?type=<EquipmentType> narrows the response to a single type.
  // Optional ?role=submeter returns the consumption submeter set: ANY equipment
  // carrying a numeric power/energy channel except the house total / production
  // meters (#523 — a metering thermostat, appliance, pool_pump, ... all qualify),
  // i.e. every equipment isSubmeterEquipment considers a per-usage meter.
  //
  // The energy display (#224) has long queried ?type=energy_meter to get "the
  // submeter clamps". Since metering relays (#521) and then any metered load
  // (#523) became submeters, that literal type filter would drop them, so
  // ?type=energy_meter is honoured as the submeter role too — the unflashed
  // display picks up the broader set without a reflash. New clients should use
  // ?role=submeter. The result is ORDERED so a fixed-capacity client (the
  // display caps at 8) keeps dedicated meters/clamps first, then metering
  // relays, then other metered loads, each group by name — a deterministic
  // truncation instead of unstable insertion order.
  //
  // This feed is the LIVE-power breakdown source (the energy display is its sole
  // consumer). An equipment that qualifies as a submeter only through a
  // cumulative `energy` (Wh) channel — e.g. a SmartThings appliance whose sole
  // `power` binding is a boolean on/off state, not watts — has no live watts to
  // draw and would otherwise render as a "no measurement" row on the display.
  // Mirror the web UI fix (#560, ui submeter-helpers `readSubmeterReading`): keep
  // a submeter only when it can contribute a live segment or is meaningful as a
  // legend row. See #590.  Kept when the equipment:
  //   - is offline — an "offline since X" row is meaningful, not noise; OR
  //   - is a declared `energy_meter` — it renders pending before its first
  //     report (#527), same carve-out isSubmeterEquipment makes on type alone.
  //     Deliberate divergence from #560: an online energy_meter with no numeric
  //     `power` still shows "pas de mesure" on current firmware, kept on purpose
  //     because a declared meter awaiting data is not noise the way an
  //     energy-only appliance is; OR
  //   - carries a NUMERIC `power` binding — the only shape that yields live
  //     watts. The `type === "number"` gate rejects a boolean `power` state
  //     (SmartThings on/off) exactly as `hasMeteringBinding` does.
  //
  // Unknown ?type values yield an empty list rather than 400 so callers can
  // safely pass-through user input without their own validation.
  app.get<{ Querystring: { type?: string; role?: string } }>(
    "/api/v1/equipments",
    async (request) => {
      const all = equipmentManager.getAllWithDetails();
      const { type, role } = request.query;
      if (role === "submeter" || type === "energy_meter") {
        const rank = (t: EquipmentType): number =>
          t === "energy_meter" ? 0 : METERING_RELAY_TYPES.has(t) ? 1 : 2;
        const hasLivePower = (eq: (typeof all)[number]): boolean =>
          eq.status === "offline" ||
          eq.type === "energy_meter" ||
          eq.dataBindings.some((b) => b.alias === "power" && b.type === "number");
        const now = Date.now();
        return all
          .filter((eq) => isSubmeterEquipment(eq.type, eq.dataBindings))
          .filter(hasLivePower)
          .sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name))
          .map((eq) => {
            // Issue #832. This feed served whatever the plug last said, at
            // full weight, however old: the 124-day wood-stove reading and the
            // water heater's sixteen-minute-old 0 W shipped here unqualified,
            // exactly as they once did to the web breakdown (#744). A client
            // cannot work the age out for itself without restating the rule,
            // and a restated rule is what let the two web surfaces disagree.
            //
            // Additive rather than a null value: the field is new, so an
            // existing client keeps the payload it parses today, and one that
            // reads the flag can stop drawing a leftover as a live segment.
            const binding = eq.dataBindings.find((b) => b.alias === "power");
            const verdict = classifyPowerReading({
              status: eq.status,
              value: binding?.value,
              lastUpdated: binding?.lastUpdated,
              equipmentType: eq.type,
              now,
            });
            // An offline equipment is kept in the feed on purpose, so the
            // display can render an "offline since" row. Its last reading is
            // not a live measurement either, and answering `true` there was
            // the same defect through a different door: the web breakdown
            // said "offline" while this feed called the reading current, for
            // one appliance, at one instant.
            const powerReadingCurrent = verdict === "missing" ? null : verdict === "current";
            return { ...eq, powerReadingCurrent };
          });
      }
      return type ? all.filter((eq) => eq.type === type) : all;
    },
  );

  // GET /api/v1/equipments/:id — Get equipment with bindings and current data
  app.get<{ Params: { id: string } }>("/api/v1/equipments/:id", async (request, reply) => {
    const equipment = equipmentManager.getByIdWithDetails(request.params.id);
    if (!equipment) {
      return reply.code(404).send({ error: "Equipment not found" });
    }
    return equipment;
  });

  // POST /api/v1/equipments — Create equipment (with optional auto-binding from devices)
  app.post<{
    Body: {
      name: string;
      type: EquipmentType;
      zoneId: string;
      icon?: string;
      description?: string;
      deviceIds?: string[];
    };
  }>(
    "/api/v1/equipments",
    { schema: { body: createEquipmentBodySchema } },
    async (request, reply) => {
      const { name, type, zoneId, icon, description, deviceIds } = request.body;

      try {
        if (deviceIds && deviceIds.length > 0) {
          const equipment = equipmentManager.createWithAutoBindings({
            name: name.trim(),
            type,
            zoneId,
            icon,
            description,
            deviceIds,
          });
          return reply.code(201).send(equipment);
        }

        const equipment = equipmentManager.create({
          name: name.trim(),
          type,
          zoneId,
          icon,
          description,
        });
        return reply.code(201).send(equipment);
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // PUT /api/v1/equipments/:id — Update equipment
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      type?: EquipmentType;
      zoneId?: string;
      icon?: string | null;
      description?: string | null;
      enabled?: boolean;
      energyProfile?: EnergyLoadProfile | null;
      requireConfirmation?: boolean;
      invertDirection?: boolean;
      solarProfile?: SolarProfile | null;
      meteringParentId?: string | null;
      timedCommand?: TimedCommand | null;
    };
  }>(
    "/api/v1/equipments/:id",
    { schema: { body: updateEquipmentBodySchema } },
    async (request, reply) => {
      const body = request.body ?? {};

      // Spec 140 — the schema validates the flexible-load declaration; round the
      // values and merge back the core-owned `learned` field, which is stripped
      // from user writes.
      if (body.energyProfile !== undefined && body.energyProfile !== null) {
        const p = body.energyProfile;
        const existing = equipmentManager.getById(request.params.id);
        body.energyProfile = {
          class: p.class,
          nominalPowerW: Math.round(p.nominalPowerW),
          minOnS: Math.round(p.minOnS),
          minOffS: Math.round(p.minOffS),
          toleratedImportW:
            p.toleratedImportW !== undefined ? Math.round(p.toleratedImportW) : undefined,
          learned: existing?.energyProfile?.learned,
        };
      }

      // Spec 160 — the schema bounds each field; this refuses a profile the
      // model would reject anyway, with the offending plane named.
      if (body.solarProfile) {
        const errors = validateSolarProfile(body.solarProfile);
        if (errors.length > 0) {
          return reply.status(400).send({
            error: "Invalid solar profile",
            details: errors,
          });
        }
      }

      // Spec 173 — a meter declared inside another one. Refused here rather than
      // at the database, which would only see a foreign key: the three ways to
      // get this wrong (yourself, a loop, the house total) each deserve to be
      // named, and the check is on the resulting graph, not on the pair.
      if (body.meteringParentId) {
        const parent = equipmentManager.getById(body.meteringParentId);
        if (!parent) {
          return reply.status(404).send({ error: "Metering parent not found" });
        }
        if (body.meteringParentId === request.params.id) {
          return reply.status(400).send({
            error: "MeteringParentSelf",
            message: "An equipment cannot be metered by itself",
          });
        }
        // The same rule enrolment uses, not just the blocklist: a lamp or a
        // bare relay is not a house total, but it is not a meter either, and
        // accepting it would persist a declaration that does nothing at all in
        // the breakdown. The picker already refuses it; the API has to agree.
        const parentDetails = equipmentManager.getByIdWithDetails(body.meteringParentId);
        if (
          !parentDetails ||
          !isSubmeterEquipment(parentDetails.type, parentDetails.dataBindings)
        ) {
          return reply.status(400).send({
            error: "MeteringParentNotSubmeter",
            message: NON_SUBMETER_TYPES.has(parent.type)
              ? `${parent.name} is a house total or a production meter, not a submeter`
              : `${parent.name} does not measure consumption, so nothing can be counted inside it`,
          });
        }
        if (wouldCycle(equipmentManager.getAll(), request.params.id, body.meteringParentId)) {
          return reply.status(400).send({
            error: "MeteringParentCycle",
            message: "That declaration would make a meter contain itself",
          });
        }
      }

      // Spec 174 phase 2 — a timed command is validated where it is WRITTEN, not
      // where it is fired: a configuration naming an order the equipment does not
      // carry would otherwise sit there until somebody pressed the control.
      if (body.timedCommand) {
        const details = equipmentManager.getByIdWithDetails(request.params.id);
        if (!details) {
          return reply.status(404).send({ error: "Equipment not found" });
        }
        const { alias, durationMs } = body.timedCommand;
        if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
          return reply.status(400).send({
            error: "TimedCommandInvalid",
            message: `Duration must be between ${MIN_DURATION_MS / 1000}s and ${MAX_DURATION_MS / 3_600_000}h`,
          });
        }
        if (!isTimedCommandEligible(details, alias)) {
          return reply.status(400).send({
            error: "TimedCommandNotEligible",
            message: `${details.name} needs the order "${alias}" and a state reading tied to it`,
          });
        }
      }

      try {
        const equipment = equipmentManager.update(request.params.id, {
          name: body.name?.trim(),
          type: body.type,
          zoneId: body.zoneId,
          icon: body.icon,
          description: body.description,
          enabled: body.enabled,
          energyProfile: body.energyProfile,
          solarProfile: body.solarProfile,
          requireConfirmation: body.requireConfirmation,
          invertDirection: body.invertDirection,
          meteringParentId: body.meteringParentId,
          timedCommand: body.timedCommand,
        });
        if (!equipment) {
          return reply.code(404).send({ error: "Equipment not found" });
        }
        return equipment;
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // DELETE /api/v1/equipments/:id — Delete equipment
  app.delete<{ Params: { id: string } }>("/api/v1/equipments/:id", async (request, reply) => {
    try {
      equipmentManager.delete(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

  // POST /api/v1/equipments/:id/orders/:alias — Execute equipment order
  app.post<{
    Params: { id: string; alias: string };
    Body: { value: unknown };
  }>("/api/v1/equipments/:id/orders/:alias", async (request, reply) => {
    const { value } = request.body ?? {};

    try {
      const userId = request.auth?.userId ?? "anonymous";
      const result = await equipmentManager.executeOrder(
        request.params.id,
        request.params.alias,
        value,
        { kind: "manual", userId },
      );
      if (!result.success) {
        return reply.code(502).send({ error: result.error });
      }
      return { success: true };
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

  // ============================================================
  // Timed action routes (spec 174)
  // ============================================================

  // POST /api/v1/equipments/:id/timed-action — act now, revert at the deadline.
  //
  // Arming an equipment that already carries the same action moves the deadline
  // and sends nothing (rule 3): the caller does not have to know which of the
  // two it is doing, and a user pressing "open" on an open gate gets the time
  // they asked for rather than a second manoeuvre.
  app.post<{
    Params: { id: string };
    Body?: { alias?: string; value?: unknown; revertValue?: unknown; durationMs?: number };
  }>(
    "/api/v1/equipments/:id/timed-action",
    { schema: { body: armTimedActionBodySchema } },
    async (request, reply) => {
      if (!timedActionManager) {
        return reply.code(503).send({ error: "Timed actions are not available" });
      }
      const userId = request.auth?.userId ?? "anonymous";
      // FR-13 — nothing named means "arm what this equipment is configured for".
      if (request.body?.alias === undefined) {
        try {
          return await timedActionManager.armConfigured(request.params.id, {
            kind: "manual",
            userId,
          });
        } catch (err) {
          if (err instanceof TimedActionError) {
            return reply.code(err.statusCode).send({ error: err.message });
          }
          return handleEquipmentError(reply, err);
        }
      }
      // `dependentRequired` on the schema means an alias brings the other two
      // with it, so the narrowing here is a type formality, not a second check.
      const { alias, value, revertValue, durationMs = 0 } = request.body;
      try {
        const armed = await timedActionManager.arm(
          request.params.id,
          { alias, value, revertValue, durationMs },
          { kind: "manual", userId },
        );
        return armed;
      } catch (err) {
        if (err instanceof TimedActionError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        return handleEquipmentError(reply, err);
      }
    },
  );

  // DELETE /api/v1/equipments/:id/timed-action — end the window early.
  //
  // ?revert=true sends the revert now ("I changed my mind"); the default drops
  // the deadline and sends nothing, which is what a caller who already put the
  // equipment back by hand wants.
  app.delete<{ Params: { id: string }; Querystring: { revert?: string } }>(
    "/api/v1/equipments/:id/timed-action",
    async (request, reply) => {
      if (!timedActionManager) {
        return reply.code(503).send({ error: "Timed actions are not available" });
      }
      const wantsRevert = request.query.revert === "true";
      try {
        const had = wantsRevert
          ? await timedActionManager.revertNow(request.params.id, "cancelled from the UI")
          : timedActionManager.disarm(request.params.id, "cancelled from the UI");
        if (!had) return reply.code(404).send({ error: "No timed action on this equipment" });
        return { success: true };
      } catch (err) {
        if (err instanceof TimedActionError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        return handleEquipmentError(reply, err);
      }
    },
  );

  // ============================================================
  // DataBinding routes
  // ============================================================

  // POST /api/v1/equipments/:id/data-bindings — Add a DataBinding
  app.post<{
    Params: { id: string };
    Body: { deviceDataId: string; alias: string };
  }>(
    "/api/v1/equipments/:id/data-bindings",
    { schema: { body: addDataBindingBodySchema } },
    async (request, reply) => {
      const { deviceDataId, alias } = request.body;

      try {
        const binding = equipmentManager.addDataBinding(
          request.params.id,
          deviceDataId,
          alias.trim(),
        );
        return reply.code(201).send(binding);
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // DELETE /api/v1/equipments/:id/data-bindings/:bindingId — Remove a DataBinding
  app.delete<{
    Params: { id: string; bindingId: string };
  }>("/api/v1/equipments/:id/data-bindings/:bindingId", async (request, reply) => {
    try {
      equipmentManager.removeDataBinding(request.params.id, request.params.bindingId);
      return reply.code(204).send();
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });

  // ============================================================
  // OrderBinding routes
  // ============================================================

  // POST /api/v1/equipments/:id/order-bindings — Add an OrderBinding
  app.post<{
    Params: { id: string };
    Body: { deviceOrderId: string; alias: string };
  }>(
    "/api/v1/equipments/:id/order-bindings",
    { schema: { body: addOrderBindingBodySchema } },
    async (request, reply) => {
      const { deviceOrderId, alias } = request.body;

      try {
        const binding = equipmentManager.addOrderBinding(
          request.params.id,
          deviceOrderId,
          alias.trim(),
        );
        return reply.code(201).send(binding);
      } catch (err) {
        return handleEquipmentError(reply, err);
      }
    },
  );

  // DELETE /api/v1/equipments/:id/order-bindings/:bindingId — Remove an OrderBinding
  app.delete<{
    Params: { id: string; bindingId: string };
  }>("/api/v1/equipments/:id/order-bindings/:bindingId", async (request, reply) => {
    try {
      equipmentManager.removeOrderBinding(request.params.id, request.params.bindingId);
      return reply.code(204).send();
    } catch (err) {
      return handleEquipmentError(reply, err);
    }
  });
}

function handleEquipmentError(
  reply: { code: (c: number) => { send: (b: unknown) => unknown } },
  err: unknown,
) {
  if (err instanceof EquipmentError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}
