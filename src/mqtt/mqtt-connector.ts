import mqtt, { type MqttClient, type IClientOptions } from "mqtt";
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";

export type MessageHandler = (topic: string, payload: Buffer) => void;

export class MqttConnector {
  private client: MqttClient | null = null;
  private logger: Logger;
  private eventBus: EventBus;
  private url: string;
  private options: IClientOptions;
  private handlers: Map<string, MessageHandler[]> = new Map();

  constructor(
    url: string,
    options: { username?: string; password?: string; clientId: string },
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.url = url;
    this.options = {
      clientId: options.clientId,
      username: options.username,
      password: options.password,
      clean: true,
      reconnectPeriod: 5000,
    };
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "mqtt" });
  }

  async connect(): Promise<void> {
    return new Promise((resolve) => {
      this.logger.info({ url: this.url }, "Connecting to MQTT broker");

      let resolved = false;
      const doResolve = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      this.client = mqtt.connect(this.url, this.options);

      this.client.on("connect", () => {
        this.logger.info({ url: this.url }, "MQTT connected");
        this.eventBus.emit({ type: "system.integration.connected", integrationId: "zigbee2mqtt" });
        doResolve();
      });

      this.client.on("reconnect", () => {
        this.logger.warn({ url: this.url }, "MQTT reconnecting...");
      });

      this.client.on("disconnect", () => {
        this.logger.warn({ url: this.url }, "MQTT disconnected");
        this.eventBus.emit({
          type: "system.integration.disconnected",
          integrationId: "zigbee2mqtt",
        });
      });

      this.client.on("offline", () => {
        this.logger.warn({ url: this.url }, "MQTT offline");
        this.eventBus.emit({
          type: "system.integration.disconnected",
          integrationId: "zigbee2mqtt",
        });
      });

      this.client.on("error", (err) => {
        this.logger.error({ err }, "MQTT error");
        // Never reject — the engine starts regardless of MQTT status.
        // The client will keep retrying in the background.
        doResolve();
      });

      this.client.on("message", (topic, payload) => {
        this.routeMessage(topic, payload);
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!this.isConnected()) {
          this.logger.warn(
            { url: this.url },
            "MQTT initial connection timeout, continuing without MQTT",
          );
        }
        doResolve();
      }, 10_000);
    });
  }

  subscribe(topicPattern: string, handler: MessageHandler): void {
    if (!this.handlers.has(topicPattern)) {
      this.handlers.set(topicPattern, []);
    }
    this.handlers.get(topicPattern)!.push(handler);

    if (this.client) {
      this.client.subscribe(topicPattern, (err) => {
        if (err) {
          this.logger.error({ err, topic: topicPattern }, "MQTT subscribe error");
        } else {
          this.logger.debug({ topic: topicPattern }, "Subscribed to topic");
        }
      });
    }
  }

  publish(topic: string, payload: string | Buffer): void {
    if (!this.client || !this.isConnected()) {
      this.logger.warn({ topic }, "Cannot publish: MQTT not connected");
      return;
    }
    this.client.publish(topic, payload, (err) => {
      if (err) {
        this.logger.error({ err, topic }, "MQTT publish error");
      }
    });
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Reconnect with new broker settings.
   * Disconnects, updates URL/options, reconnects, and re-subscribes all handlers.
   */
  async reconnect(
    url: string,
    options: { username?: string; password?: string; clientId: string },
  ): Promise<void> {
    this.logger.info({ url }, "Reconnecting MQTT with new settings");

    // Disconnect existing client
    if (this.client) {
      try {
        await this.client.endAsync(true);
      } catch {
        // Ignore disconnect errors
      }
      this.client = null;
    }

    // Update connection settings
    this.url = url;
    this.options = {
      clientId: options.clientId,
      username: options.username,
      password: options.password,
      clean: true,
      reconnectPeriod: 5000,
    };

    // Reconnect (preserves all registered handlers)
    await this.connect();
    this.resubscribeAll();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.endAsync();
      this.logger.info({ url: this.url }, "MQTT disconnected");
    }
  }

  private resubscribeAll(): void {
    if (!this.client) return;
    for (const pattern of this.handlers.keys()) {
      this.client.subscribe(pattern, (err) => {
        if (err) {
          this.logger.error({ err, topic: pattern }, "MQTT re-subscribe error");
        }
      });
    }
  }

  private routeMessage(topic: string, payload: Buffer): void {
    for (const [pattern, handlers] of this.handlers) {
      if (this.topicMatches(pattern, topic)) {
        for (const handler of handlers) {
          try {
            handler(topic, payload);
          } catch (err) {
            this.logger.error({ err, topic }, "MQTT message handler error");
          }
        }
      }
    }
  }

  /**
   * Simple MQTT topic wildcard matching.
   * Supports + (single level) and # (multi level) wildcards.
   */
  private topicMatches(pattern: string, topic: string): boolean {
    const patternParts = pattern.split("/");
    const topicParts = topic.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      const pat = patternParts[i];

      if (pat === "#") {
        return true; // # matches everything from here
      }

      if (i >= topicParts.length) {
        return false; // topic is shorter than pattern
      }

      if (pat !== "+" && pat !== topicParts[i]) {
        return false; // exact match failed
      }
    }

    return patternParts.length === topicParts.length;
  }
}
