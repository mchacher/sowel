import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { EventBus } from "../core/event-bus.js";
import type { AuthService } from "../auth/auth-service.js";
import type { LogRingBuffer } from "../core/log-buffer.js";
import type { Logger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

interface WebSocketDeps {
  eventBus: EventBus;
  authService: AuthService;
  logBuffer: LogRingBuffer;
  logger: Logger;
  corsOrigins: string[];
}

/**
 * Extracts a bearer token from either the Authorization header or the
 * `Sec-WebSocket-Protocol` subprotocol (`bearer.<token>`). The subprotocol path
 * is the one used by browser clients since the WebSocket API does not allow
 * setting arbitrary request headers.
 */
export function extractWsToken(
  authorization: string | undefined,
  subprotocol: string | string[] | undefined,
): string | null {
  if (authorization && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || null;
  }
  if (!subprotocol) return null;
  const raw = Array.isArray(subprotocol) ? subprotocol.join(",") : subprotocol;
  const protocols = raw.split(",").map((p) => p.trim());
  const bearer = protocols.find((p) => p.startsWith("bearer."));
  if (!bearer) return null;
  return bearer.slice("bearer.".length) || null;
}

/**
 * Returns true when the connection's Origin is acceptable.
 * - Missing Origin: allowed (non-browser clients like Node scripts have no Origin).
 * - Wildcard in corsOrigins: allowed (explicit user choice).
 * - Same-origin: allowed (Origin host matches the Host header the request was
 *   reached on). This makes LAN deployments at `http://<hostname>:<port>` work
 *   without the operator having to add their hostname to CORS_ORIGINS.
 * - Otherwise: must match one of the whitelisted origins.
 */
export function isWsOriginAllowed(
  origin: string | string[] | undefined,
  corsOrigins: string[],
  hostHeader?: string | string[],
): boolean {
  if (!origin) return true;
  if (corsOrigins.includes("*")) return true;
  const value = Array.isArray(origin) ? origin[0] : origin;
  if (corsOrigins.includes(value)) return true;
  // Same-origin check: compare Origin's host to the request's Host header.
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (host) {
    try {
      const originHost = new URL(value).host;
      if (originHost === host) return true;
    } catch {
      // Malformed Origin URL — fall through to deny.
    }
  }
  return false;
}

type WsTopic =
  | "devices"
  | "equipments"
  | "zones"
  | "modes"
  | "recipes"
  | "calendar"
  | "mqtt-publishers"
  | "system"
  | "logs"
  | "activity"
  | "energy";

const VALID_TOPICS = new Set<WsTopic>([
  "devices",
  "equipments",
  "zones",
  "modes",
  "recipes",
  "calendar",
  "mqtt-publishers",
  "system",
  "logs",
  "activity",
  "energy",
]);
const BATCH_INTERVAL_MS = 200;

interface ClientState {
  socket: WebSocket;
  topics: Set<WsTopic>;
  pending: EngineEvent[];
  logUnsubscribe?: () => void;
}

function getEventTopic(event: EngineEvent): WsTopic {
  const prefix = event.type.split(".")[0];
  switch (prefix) {
    case "device":
      return "devices";
    case "equipment":
      return "equipments";
    case "zone":
      return "zones";
    case "mode":
      return "modes";
    case "recipe":
      return "recipes";
    case "calendar":
      return "calendar";
    case "mqtt-broker":
    case "mqtt-publisher":
      return "mqtt-publishers";
    case "activity":
      return "activity";
    case "energy":
      return "energy"; // spec 140 — arbiter decisions and status
    default:
      return "system";
  }
}

/** Returns a dedup key for high-frequency data events, null for structural events */
function getDedupKey(event: EngineEvent): string | null {
  switch (event.type) {
    case "device.data.updated":
      return `d:${event.deviceId}:${event.key}`;
    case "device.status_changed":
      return `ds:${event.deviceId}`;
    case "device.heartbeat":
      return `dh:${event.deviceId}`;
    case "equipment.data.changed":
      return `e:${event.equipmentId}:${event.alias}`;
    case "equipment.status.changed":
      return `es:${event.equipmentId}`;
    case "zone.data.changed":
      return `z:${event.zoneId}`;
    case "energy.arbiter.status":
      return "ea:status"; // spec 140 — keep only the latest status per batch
    default:
      return null;
  }
}

function deduplicateEvents(events: EngineEvent[]): EngineEvent[] {
  // Walk backwards: keep only the LAST occurrence of each dedup key
  const seen = new Set<string>();
  const result: EngineEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const key = getDedupKey(events[i]);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push(events[i]);
  }
  result.reverse();
  return result;
}

export function registerWebSocket(app: FastifyInstance, deps: WebSocketDeps): void {
  const { eventBus, authService, logBuffer, logger: baseLogger, corsOrigins } = deps;
  const logger = baseLogger.child({ module: "websocket" });
  const clients = new Map<WebSocket, ClientState>();

  // Batch flush: every BATCH_INTERVAL_MS, send accumulated events per client
  const batchTimer = setInterval(() => {
    for (const [, state] of clients) {
      if (state.pending.length === 0) continue;
      if (state.socket.readyState !== 1) {
        state.pending.length = 0;
        continue;
      }

      const deduped = deduplicateEvents(state.pending);
      state.pending.length = 0;

      try {
        state.socket.send(JSON.stringify(deduped));
      } catch {
        // Socket may have closed between check and send
      }
    }
  }, BATCH_INTERVAL_MS);

  // Listen for all engine events and enqueue for subscribed clients
  eventBus.on((event) => {
    if (clients.size === 0) return;

    const topic = getEventTopic(event);

    for (const [, state] of clients) {
      if (state.topics.has(topic)) {
        state.pending.push(event);
      }
    }
  });

  /** Subscribe a client to log streaming via ring buffer */
  function subscribeToLogs(state: ClientState): void {
    // Unsubscribe previous if any
    if (state.logUnsubscribe) {
      state.logUnsubscribe();
      state.logUnsubscribe = undefined;
    }

    state.logUnsubscribe = logBuffer.subscribe((entry) => {
      if (state.socket.readyState !== 1) return;
      try {
        state.socket.send(JSON.stringify({ type: "log.entry", ...entry }));
      } catch {
        // Socket may have closed
      }
    });
  }

  /** Unsubscribe a client from log streaming */
  function unsubscribeFromLogs(state: ClientState): void {
    if (state.logUnsubscribe) {
      state.logUnsubscribe();
      state.logUnsubscribe = undefined;
    }
  }

  app.get("/ws", { websocket: true }, (socket, request) => {
    // Origin check: refuse browser clients from non-whitelisted origins.
    if (!isWsOriginAllowed(request.headers.origin, corsOrigins, request.headers.host)) {
      logger.warn({ origin: request.headers.origin }, "WebSocket rejected: Origin not allowed");
      socket.close(4003, "Origin not allowed");
      return;
    }

    // Authentication: token via Authorization header (Bearer) or via
    // `Sec-WebSocket-Protocol: bearer.<token>` subprotocol (browser path).
    const token = extractWsToken(
      request.headers.authorization,
      request.headers["sec-websocket-protocol"],
    );

    if (!token) {
      logger.warn("WebSocket rejected: no authentication credentials provided");
      socket.close(4001, "Authentication required");
      return;
    }

    try {
      if (token.startsWith("swl_") || token.startsWith("wch_") || token.startsWith("cbl_")) {
        const result = authService.verifyApiToken(token);
        if (!result) {
          socket.close(4001, "Invalid token");
          return;
        }
      } else {
        authService.verifyAccessToken(token);
      }
    } catch {
      socket.close(4001, "Invalid token");
      return;
    }

    // Default subscription: system events only
    const state: ClientState = { socket, topics: new Set(["system"]), pending: [] };
    clients.set(socket, state);
    logger.info({ clients: clients.size }, "WebSocket client connected");

    // Handle incoming messages (subscribe commands)
    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; topics?: string[] };
        if (msg.type === "subscribe" && Array.isArray(msg.topics)) {
          const newTopics = new Set<WsTopic>(["system"]); // system always included
          for (const t of msg.topics) {
            if (VALID_TOPICS.has(t as WsTopic)) {
              newTopics.add(t as WsTopic);
            }
          }

          // Handle logs topic subscription/unsubscription
          const hadLogs = state.topics.has("logs");
          const wantsLogs = newTopics.has("logs");
          if (!hadLogs && wantsLogs) {
            subscribeToLogs(state);
          } else if (hadLogs && !wantsLogs) {
            unsubscribeFromLogs(state);
          }

          state.topics = newTopics;
          logger.debug({ topics: [...newTopics] }, "Client subscribed");
        }
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on("close", () => {
      unsubscribeFromLogs(state);
      clients.delete(socket);
      logger.info({ clients: clients.size }, "WebSocket client disconnected");
    });

    socket.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      unsubscribeFromLogs(state);
      clients.delete(socket);
    });

    // Send a welcome message
    socket.send(
      JSON.stringify({
        type: "connected",
        message: "Connected to Sowel engine",
        version: "0.1.0",
      }),
    );
  });

  // Cleanup on server close
  app.addHook("onClose", () => {
    clearInterval(batchTimer);
  });
}
