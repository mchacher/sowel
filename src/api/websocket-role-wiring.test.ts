/**
 * Issue #651 — assert the connection-level role wiring, not just the helpers.
 *
 * The 30 tests in `websocket.test.ts` cover the pure functions
 * (`isAdminOnlyEvent`, `resolveSubscribedTopics`, `canReceiveEvent`), and they
 * would all still pass if `verifyApiToken().role` never reached
 * `ClientState.role`. Nothing asserted the wiring between them, which is the
 * one line whose failure would silently hand every non-admin an admin's feed.
 *
 * So this drives a real server over a real socket: connect with a viewer's API
 * token, subscribe to everything including the admin-only topics, and watch
 * what actually arrives.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import WebSocket from "ws";
import { registerWebSocket, REDACTED_FOR_ROLE } from "./websocket.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { AuthService } from "../auth/auth-service.js";
import type { LogRingBuffer } from "../core/log-buffer.js";
import type { EngineEvent, LogEntry, UserRole } from "../shared/types.js";

const logger = createLogger("silent").logger;

/**
 * What actually comes down the socket: engine events, plus the frames the
 * server sends outside the event bus (the greeting, and `log.entry` from the
 * ring-buffer stream).
 */
type Frame = EngineEvent | { type: string; [k: string]: unknown };

/**
 * `UserRole` is `admin | standard`. There is no viewer.
 *
 * Both connection branches are stubbed, because both are load-bearing and only
 * one of them is what the browser uses. A `swl_`/`wch_`/`cbl_` token goes
 * through `verifyApiToken` and is how scripts and the energy display connect;
 * anything else is a JWT through `verifyAccessToken`, which is how every
 * logged-in UI session connects, since a browser cannot set headers on a
 * WebSocket and has to smuggle the token through `bearer.<token>`.
 */
const API_TOKENS: Record<string, UserRole> = {
  swl_admin: "admin",
  swl_standard: "standard",
};

/** JWTs here are just opaque non-`swl_` strings; only the mapped role matters. */
const JWTS: Record<string, UserRole> = {
  "jwt.admin.sig": "admin",
  "jwt.standard.sig": "standard",
};

const authService = {
  verifyApiToken: (token: string) => {
    const role = API_TOKENS[token];
    return role ? { userId: "u-" + role, role } : null;
  },
  verifyAccessToken: (token: string) => {
    const role = JWTS[token];
    if (!role) throw new Error("invalid token");
    return { userId: "u-" + role, role };
  },
} as unknown as AuthService;

/** A real fan-out, so the log-stream gate can actually be driven. */
const logListeners = new Set<(entry: LogEntry) => void>();
const logBuffer = {
  subscribe: (listener: (entry: LogEntry) => void) => {
    logListeners.add(listener);
    return () => logListeners.delete(listener);
  },
} as unknown as LogRingBuffer;

function emitLog(entry: Partial<LogEntry>): void {
  for (const listener of logListeners) listener(entry as LogEntry);
}

let app: FastifyInstance;
let eventBus: EventBus;
let port: number;

beforeAll(async () => {
  eventBus = new EventBus(logger);
  app = Fastify({ logger: false });
  await app.register(websocketPlugin);
  registerWebSocket(app, {
    eventBus,
    authService,
    logBuffer,
    logger,
    corsOrigins: [],
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  port = addr.port;
});

afterAll(async () => {
  await app.close();
});

/** Connect, subscribe to every topic, and collect what the server sends. */
async function connect(token: string): Promise<{
  received: Frame[];
  close: () => void;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [`bearer.${token}`]);
  const received: Frame[] = [];
  ws.on("message", (raw) => {
    const parsed = JSON.parse(String(raw)) as Frame | Frame[];
    if (Array.isArray(parsed)) received.push(...parsed);
    else received.push(parsed);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(
    JSON.stringify({
      type: "subscribe",
      topics: ["system", "devices", "mqtt-publishers", "logs", "energy"],
    }),
  );
  // The subscribe is processed before any event emitted after this point.
  await new Promise((r) => setTimeout(r, 30));
  return { received, close: () => ws.close() };
}

/** Poll until `predicate` holds or the deadline passes. */
async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Emit, then wait for a client that IS entitled to the events to have received
 * them. Waiting on a fixed delay past the 200 ms batch interval works until a
 * loaded runner misses it, and then the failure surfaces on a positive
 * assertion, which reads as an authorization regression rather than a timeout.
 * Waiting on the witness makes the negative assertions meaningful by
 * construction: what a client did not get, it did not get by the time a peer
 * had everything.
 */
async function emitAndAwait(events: EngineEvent[], witness: { received: Frame[] }): Promise<void> {
  for (const e of events) eventBus.emit(e);
  const wanted = events.map((e) => e.type);
  await until(() => wanted.every((t) => witness.received.some((r) => r.type === t)));
  // One more batch period: a client that should NOT receive an event would be
  // flushed in the same tick as the witness, never a later one.
  await new Promise((r) => setTimeout(r, 220));
}

const ev = (type: string, extra: Record<string, unknown> = {}): EngineEvent =>
  ({ type, ...extra }) as unknown as EngineEvent;

describe("WebSocket role wiring, end to end (#651)", () => {
  it("does not deliver admin-only topics to a standard client that asked for them", async () => {
    const standard = await connect("swl_standard");
    const admin = await connect("swl_admin");

    await emitAndAwait(
      [
        ev("mqtt-publisher.created", { publisherId: "p1" }),
        ev("notification-publisher.updated", { publisherId: "n1" }),
        ev("device.status_changed", { deviceId: "d1" }),
      ],
      admin,
    );

    const standardTypes = standard.received.map((e) => e.type);
    const adminTypes = admin.received.map((e) => e.type);

    // The admin proves the events really were emitted and routed, so the
    // standard client's empty result cannot be an artefact of nothing sent.
    expect(adminTypes).toContain("mqtt-publisher.created");
    expect(adminTypes).toContain("notification-publisher.updated");

    expect(standardTypes).not.toContain("mqtt-publisher.created");
    expect(standardTypes).not.toContain("notification-publisher.updated");
    // Not a blanket block: it still gets what its role allows.
    expect(standardTypes).toContain("device.status_changed");

    standard.close();
    admin.close();
  });

  it("gates a browser session the same way, and that is the JWT branch", async () => {
    // The branch every logged-in UI session takes: a browser cannot set headers
    // on a WebSocket, so it sends the JWT as `bearer.<token>` and the server
    // reads the role through verifyAccessToken. Covering only the swl_ branch
    // left a hardcoded role here invisible to the whole suite.
    const standard = await connect("jwt.standard.sig");
    const admin = await connect("jwt.admin.sig");

    await emitAndAwait(
      [
        ev("mqtt-publisher.created", { publisherId: "p2" }),
        ev("device.status_changed", { deviceId: "d2" }),
      ],
      admin,
    );

    expect(admin.received.map((e) => e.type)).toContain("mqtt-publisher.created");
    expect(standard.received.map((e) => e.type)).not.toContain("mqtt-publisher.created");
    // Positive control on the standard client itself: it is connected and
    // receiving, so the assertion above is about the gate, not about silence.
    expect(standard.received.map((e) => e.type)).toContain("device.status_changed");

    standard.close();
    admin.close();
  });

  it("refuses the log stream to a standard client even if it reaches the subscribe", async () => {
    // resolveSubscribedTopics drops `logs` for a non-admin, so this is belt and
    // braces. It is worth the line: deleting that role check is a one-line edit
    // and the full server log is what sits behind it.
    const standard = await connect("swl_standard");
    const admin = await connect("swl_admin");

    emitLog({ level: "error", msg: "db connect failed for user:p4ss@host" });
    await until(() => admin.received.some((e) => e.type === "log.entry"));
    await new Promise((r) => setTimeout(r, 100));

    expect(admin.received.map((e) => e.type)).toContain("log.entry");
    expect(standard.received.map((e) => e.type)).not.toContain("log.entry");
    expect(JSON.stringify(standard.received)).not.toContain("p4ss");

    standard.close();
    admin.close();
  });

  it("strips free-form system strings for a non-admin and keeps them for an admin", async () => {
    const standard = await connect("swl_standard");
    const admin = await connect("swl_admin");

    const secret = "postgres://sowel:hunter2@db.internal:5432";
    await emitAndAwait(
      [
        ev("system.update.error", { error: `pull failed: ${secret}` }),
        ev("system.update.progress", { step: "pull", message: `pulling from ${secret}` }),
      ],
      admin,
    );

    const standardJson = JSON.stringify(standard.received);
    expect(standardJson).not.toContain("hunter2");
    expect(standardJson).toContain(REDACTED_FOR_ROLE);
    // The event itself still arrives: the UI raises its overlay on the type.
    expect(standard.received.map((e) => e.type)).toContain("system.update.progress");
    // `step` is a fixed vocabulary, not free-form, so it survives.
    expect(standard.received.some((e) => (e as { step?: string }).step === "pull")).toBe(true);

    expect(JSON.stringify(admin.received)).toContain("hunter2");

    standard.close();
    admin.close();
  });

  it("refuses a connection with no credentials at all", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => {});
    });
    expect(code).toBe(4001);
  });

  it("refuses a token the auth service does not recognise", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bearer.swl_nope"]);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => {});
    });
    expect(code).toBe(4001);
  });
});
