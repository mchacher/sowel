import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { EventBus } from "../core/event-bus.js";
import type { AuthService } from "../auth/auth-service.js";
import type { Logger } from "../core/logger.js";

interface WebSocketDeps {
  eventBus: EventBus;
  authService: AuthService;
  logger: Logger;
}

export function registerWebSocket(app: FastifyInstance, deps: WebSocketDeps): void {
  const { eventBus, authService, logger: baseLogger } = deps;
  const logger = baseLogger.child({ module: "websocket" });
  const clients = new Set<WebSocket>();

  // Listen for all engine events and broadcast to connected clients
  eventBus.on((event) => {
    if (clients.size === 0) return;

    const message = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(message);
      }
    }
  });

  app.get("/ws", { websocket: true }, (socket, request) => {
    // Auth via query param: ws://host/ws?token=xxx
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get("token");

    if (token) {
      try {
        if (token.startsWith("cbl_")) {
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
    }
    // If no token in query, accept connection (auth can be sent as first message)
    // For backward compatibility during development, we allow unauthenticated connections

    clients.add(socket);
    logger.info({ clients: clients.size }, "WebSocket client connected");

    socket.on("close", () => {
      clients.delete(socket);
      logger.info({ clients: clients.size }, "WebSocket client disconnected");
    });

    socket.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      clients.delete(socket);
    });

    // Send a welcome message
    socket.send(
      JSON.stringify({
        type: "connected",
        message: "Connected to Corbel engine",
        version: "0.1.0",
      }),
    );
  });
}
