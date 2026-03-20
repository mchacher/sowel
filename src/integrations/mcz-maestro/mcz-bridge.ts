/**
 * MczBridge — Socket.IO client wrapping the MCZ Maestro cloud protocol.
 *
 * Connects to app.mcz.it:9000, authenticates with serial + MAC,
 * and provides methods to poll status and send commands.
 */

import { io, type Socket } from "socket.io-client";
import type { Logger } from "../../core/logger.js";
import {
  type MczStatusFrame,
  parseInfoFrame,
  extractStatusFrame,
  COMMAND_ID,
  RESET_ALARM_VALUE,
} from "./mcz-types.js";

const MCZ_CLOUD_URL = "http://app.mcz.it:9000";
const REQUEST_TIMEOUT_MS = 15_000;
const RECONNECT_WAIT_TIMEOUT_MS = 20_000;

export class MczBridge {
  private socket: Socket | null = null;
  private logger: Logger;
  private serialNumber = "";
  private macAddress = "";
  private connected = false;
  private initialConnectDone = false;

  /** Called after a successful reconnection (join completed). */
  onReconnect: (() => void) | null = null;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "mcz-bridge" });
  }

  /**
   * Connect to the MCZ cloud and authenticate with serial + MAC.
   */
  async connect(serialNumber: string, macAddress: string): Promise<void> {
    this.serialNumber = serialNumber;
    this.macAddress = macAddress;
    this.initialConnectDone = false;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.logger.error("MCZ cloud connection timeout after 15s");
        reject(new Error("MCZ cloud connection timeout"));
      }, REQUEST_TIMEOUT_MS);

      this.logger.info({ url: MCZ_CLOUD_URL }, "Connecting to MCZ cloud...");

      this.socket = io(MCZ_CLOUD_URL, {
        // Let Socket.IO negotiate transport (polling first, then upgrade)
        // The MCZ server is old and may not support direct WebSocket
        reconnection: true,
        reconnectionDelay: 5_000,
        reconnectionDelayMax: 30_000,
        reconnectionAttempts: Infinity,
      });

      this.socket.on("connect", () => {
        if (!this.initialConnectDone) {
          // First connection — join and resolve the connect() promise
          this.logger.info({ socketId: this.socket?.id }, "Connected to MCZ cloud, joining...");
          this.emitJoin();
          this.connected = true;
          this.initialConnectDone = true;
          clearTimeout(timeout);
          resolve();
        }
        // Reconnections are handled by io.on("reconnect") below — do NOT
        // emit a second join here, as both events fire on reconnect.
      });

      this.socket.on("connect_error", (err) => {
        this.logger.error({ err: err.message }, "MCZ cloud connection error");
        this.connected = false;
        if (!this.initialConnectDone) {
          clearTimeout(timeout);
          reject(new Error(`MCZ cloud connection failed: ${err.message}`));
        }
      });

      this.socket.on("disconnect", (reason) => {
        this.logger.warn({ reason }, "Disconnected from MCZ cloud");
        this.connected = false;
      });

      // socket.io-client v4: reconnect events are on the io manager
      this.socket.io.on("reconnect", () => {
        this.logger.info("Reconnected to MCZ cloud, re-joining...");
        this.emitJoin();
        this.connected = true;
        if (this.onReconnect) {
          this.onReconnect();
        }
      });

      // Log incoming events at debug level
      this.socket.onAny((event: string, ...args: unknown[]) => {
        const preview =
          args.length > 0 && typeof args[0] === "string"
            ? args[0].substring(0, 120)
            : args.length > 0
              ? JSON.stringify(args[0]).substring(0, 120)
              : "(no args)";
        this.logger.debug({ event, preview }, "MCZ event received");
      });
    });
  }

  /**
   * Disconnect from the MCZ cloud.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.onReconnect = null;
    this.logger.info("Disconnected from MCZ cloud");
  }

  /**
   * Wait for the socket to be connected, with a timeout.
   * If already connected, resolves immediately.
   * If disconnected but Socket.IO is reconnecting, waits for reconnection.
   */
  private waitForConnection(): Promise<void> {
    if (this.connected && this.socket?.connected) {
      return Promise.resolve();
    }
    if (!this.socket) {
      return Promise.reject(new Error("MCZ bridge not initialized"));
    }

    this.logger.debug("Waiting for MCZ reconnection...");
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("MCZ bridge reconnection timeout"));
      }, RECONNECT_WAIT_TIMEOUT_MS);

      const onReconnect = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket?.io.off("reconnect", onReconnect);
      };

      this.socket!.io.on("reconnect", onReconnect);
    });
  }

  /**
   * Request the full stove status via RecuperoInfo.
   */
  async getStatus(): Promise<MczStatusFrame> {
    await this.waitForConnection();

    return new Promise<MczStatusFrame>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.off("rispondo", handler);
        this.logger.error("MCZ getStatus timeout — no INFO frame received in 15s");
        reject(new Error("MCZ getStatus timeout"));
      }, REQUEST_TIMEOUT_MS);

      const handler = (data: unknown) => {
        try {
          // MCZ cloud wraps the response in {"stringaRicevuta": "01|..."}
          let raw: string;
          if (typeof data === "object" && data !== null && "stringaRicevuta" in data) {
            raw = (data as { stringaRicevuta: string }).stringaRicevuta;
          } else if (typeof data === "string") {
            raw = data;
          } else {
            this.logger.warn(
              { dataType: typeof data },
              "MCZ rispondo: unexpected format, skipping",
            );
            return;
          }
          this.logger.debug(
            { rawLength: raw.length, preview: raw.substring(0, 120) },
            "MCZ rispondo received",
          );

          const registers = parseInfoFrame(raw);
          if (registers) {
            clearTimeout(timeout);
            this.socket?.off("rispondo", handler);
            this.logger.debug({ registerCount: registers.length }, "MCZ INFO frame parsed");
            resolve(extractStatusFrame(registers));
          }
          // Ignore non-INFO frames (alarms, params, etc.) — keep waiting
        } catch (err) {
          clearTimeout(timeout);
          this.socket?.off("rispondo", handler);
          this.logger.error({ err }, "MCZ rispondo parse error");
          reject(err);
        }
      };

      this.logger.debug("Requesting MCZ status (C|RecuperoInfo)...");
      this.socket!.on("rispondo", handler);
      this.emitChiedo("C|RecuperoInfo", 1);
    });
  }

  /**
   * Send a control command to the stove.
   */
  async sendCommand(commandId: number, value: number): Promise<void> {
    await this.waitForConnection();

    const message =
      commandId === COMMAND_ID.RESET_ALARM
        ? `C|WriteParametri|${commandId}|${RESET_ALARM_VALUE}`
        : `C|WriteParametri|${commandId}|${value}`;

    this.logger.debug({ commandId, value, message }, "Sending MCZ command");
    this.emitChiedo(message, 1);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emitJoin(): void {
    if (!this.socket) return;
    this.logger.debug(
      { serialNumber: this.serialNumber, macAddress: this.macAddress },
      "Emitting MCZ join",
    );
    this.socket.emit("join", {
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      type: "Android-App",
    });
    // Protocol requires RecuperoParametri after join before other commands
    this.emitChiedo("RecuperoParametri", 0);
  }

  /**
   * Emit a "chiedo" request with the required JSON payload format.
   * tipoChiamata: 0 = parameter read, 1 = info/command
   */
  private emitChiedo(richiesta: string, tipoChiamata: number): void {
    if (!this.socket) return;
    this.socket.emit("chiedo", {
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      tipoChiamata,
      richiesta,
    });
  }
}
