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

export class MczBridge {
  private socket: Socket | null = null;
  private logger: Logger;
  private serialNumber = "";
  private macAddress = "";
  private connected = false;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "mcz-bridge" });
  }

  /**
   * Connect to the MCZ cloud and authenticate with serial + MAC.
   */
  async connect(serialNumber: string, macAddress: string): Promise<void> {
    this.serialNumber = serialNumber;
    this.macAddress = macAddress;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("MCZ cloud connection timeout"));
      }, REQUEST_TIMEOUT_MS);

      this.socket = io(MCZ_CLOUD_URL, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 5_000,
        reconnectionDelayMax: 30_000,
        reconnectionAttempts: Infinity,
      });

      this.socket.on("connect", () => {
        this.logger.info("Connected to MCZ cloud, joining...");
        this.socket!.emit("join", {
          serialNumber: this.serialNumber,
          macAddress: this.macAddress,
          type: "Android-App",
        });
        this.connected = true;
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on("connect_error", (err) => {
        this.logger.error({ err: err.message }, "MCZ cloud connection error");
        this.connected = false;
        clearTimeout(timeout);
        reject(new Error(`MCZ cloud connection failed: ${err.message}`));
      });

      this.socket.on("disconnect", (reason) => {
        this.logger.warn({ reason }, "Disconnected from MCZ cloud");
        this.connected = false;
      });

      this.socket.on("reconnect", () => {
        this.logger.info("Reconnected to MCZ cloud, re-joining...");
        this.socket!.emit("join", {
          serialNumber: this.serialNumber,
          macAddress: this.macAddress,
          type: "Android-App",
        });
        this.connected = true;
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
    this.logger.info("Disconnected from MCZ cloud");
  }

  /**
   * Request the full stove status via RecuperoInfo.
   */
  async getStatus(): Promise<MczStatusFrame> {
    if (!this.socket || !this.connected) {
      throw new Error("MCZ bridge not connected");
    }

    return new Promise<MczStatusFrame>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.off("rispondo", handler);
        reject(new Error("MCZ getStatus timeout"));
      }, REQUEST_TIMEOUT_MS);

      const handler = (data: string) => {
        try {
          const registers = parseInfoFrame(data);
          if (registers) {
            clearTimeout(timeout);
            this.socket?.off("rispondo", handler);
            resolve(extractStatusFrame(registers));
          }
          // Ignore non-INFO frames (alarms, params, etc.) — keep waiting
        } catch (err) {
          clearTimeout(timeout);
          this.socket?.off("rispondo", handler);
          reject(err);
        }
      };

      this.socket!.on("rispondo", handler);
      this.socket!.emit("chiedo", "C|RecuperoInfo");
    });
  }

  /**
   * Send a control command to the stove.
   */
  async sendCommand(commandId: number, value: number): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new Error("MCZ bridge not connected");
    }

    const message =
      commandId === COMMAND_ID.RESET_ALARM
        ? `C|WriteParametri|${commandId}|${RESET_ALARM_VALUE}`
        : `C|WriteParametri|${commandId}|${value}`;

    this.logger.debug({ commandId, value, message }, "Sending MCZ command");
    this.socket.emit("chiedo", message);
  }

  isConnected(): boolean {
    return this.connected;
  }
}
