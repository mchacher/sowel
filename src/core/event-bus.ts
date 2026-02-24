import { EventEmitter } from "node:events";
import type { EngineEvent } from "../shared/types.js";
import type { Logger } from "./logger.js";

export class EventBus {
  private emitter = new EventEmitter();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "event-bus" });
    this.emitter.setMaxListeners(50);
  }

  emit(event: EngineEvent): void {
    this.logger.trace({ eventType: event.type }, "Event emitted");
    this.emitter.emit("event", event);
  }

  on(handler: (event: EngineEvent) => void): () => void {
    const wrapped = (event: EngineEvent) => {
      try {
        handler(event);
      } catch (err) {
        this.logger.error({ err, eventType: event.type }, "Event handler error");
      }
    };
    this.emitter.on("event", wrapped);
    return () => {
      this.emitter.off("event", wrapped);
    };
  }

  onType<T extends EngineEvent["type"]>(
    type: T,
    handler: (event: Extract<EngineEvent, { type: T }>) => void,
  ): () => void {
    return this.on((event) => {
      if (event.type === type) {
        handler(event as Extract<EngineEvent, { type: T }>);
      }
    });
  }
}
