import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../../core/logger.js";
import type {
  BridgeDevicesResponse,
  BridgeDeviceResponse,
  BridgeLoginResponse,
  BridgeResponse,
} from "./panasonic-types.js";

const BRIDGE_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BRIDGE_PATH = resolve(__dirname, "bridge.py");

/** Resolve the Python path: prefer .venv in project root, fall back to system python3. */
function resolveDefaultPython(): string {
  // __dirname is src/integrations/panasonic-cc (or dist equivalent)
  const projectRoot = resolve(__dirname, "..", "..", "..");
  const venvPython = resolve(projectRoot, ".venv", "bin", "python3");
  if (existsSync(venvPython)) {
    return venvPython;
  }
  return "python3";
}

export class PanasonicBridge {
  private pythonPath: string;
  private bridgePath: string;
  private tokenFile: string;
  private logger: Logger;

  constructor(
    tokenFile: string,
    logger: Logger,
    pythonPath = resolveDefaultPython(),
    bridgePath = DEFAULT_BRIDGE_PATH,
  ) {
    this.pythonPath = pythonPath;
    this.bridgePath = bridgePath;
    this.tokenFile = tokenFile;
    this.logger = logger.child({ module: "panasonic-bridge" });
  }

  async login(email: string, password: string): Promise<BridgeLoginResponse> {
    const result = await this.exec("login", email, password);
    if (!result.ok) {
      throw new Error(`Panasonic login failed: ${(result as { error: string }).error}`);
    }
    return result as BridgeLoginResponse;
  }

  async getDevices(email: string, password: string): Promise<BridgeDevicesResponse> {
    const result = await this.exec("get_devices", email, password);
    if (!result.ok) {
      throw new Error(`Failed to get devices: ${(result as { error: string }).error}`);
    }
    return result as BridgeDevicesResponse;
  }

  async getDevice(
    deviceId: string,
    email: string,
    password: string,
  ): Promise<BridgeDeviceResponse> {
    const result = await this.exec("get_device", email, password, ["--id", deviceId]);
    if (!result.ok) {
      throw new Error(`Failed to get device: ${(result as { error: string }).error}`);
    }
    return result as BridgeDeviceResponse;
  }

  async control(
    deviceId: string,
    param: string,
    value: unknown,
    email: string,
    password: string,
  ): Promise<void> {
    const result = await this.exec("control", email, password, [
      "--id",
      deviceId,
      "--param",
      param,
      "--value",
      String(value),
    ]);
    if (!result.ok) {
      throw new Error(`Control failed: ${(result as { error: string }).error}`);
    }
  }

  private exec(
    command: string,
    email: string,
    password: string,
    extraArgs: string[] = [],
  ): Promise<BridgeResponse> {
    const args = [
      this.bridgePath,
      command,
      "--email",
      email,
      "--password",
      password,
      "--token-file",
      this.tokenFile,
      ...extraArgs,
    ];

    this.logger.debug({ command, extraArgs }, "Executing Python bridge");

    return new Promise((resolve, reject) => {
      execFile(
        this.pythonPath,
        args,
        { timeout: BRIDGE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            this.logger.error({ err: error, stderr }, "Python bridge execution failed");
            reject(new Error(`Bridge process failed: ${error.message}`));
            return;
          }

          if (stderr) {
            this.logger.warn({ stderr: stderr.trim() }, "Python bridge stderr");
          }

          try {
            const result = JSON.parse(stdout) as BridgeResponse;
            resolve(result);
          } catch {
            this.logger.error({ stdout: stdout.substring(0, 500) }, "Failed to parse bridge JSON");
            reject(new Error("Bridge returned invalid JSON"));
          }
        },
      );
    });
  }
}
