import { existsSync } from "node:fs";
import { hostname } from "node:os";
import type { Logger } from "./logger.js";
import type { EventBus } from "./event-bus.js";
import type { BackupManager } from "../backup/backup-manager.js";

const DOCKER_SOCKET_PATH = "/var/run/docker.sock";
const HELPER_IMAGE = "docker:25-cli";
const HELPER_NAME = "sowel-updater";
const COMPOSE_LABEL_WORKING_DIR = "com.docker.compose.project.working_dir";
const COMPOSE_LABEL_PROJECT = "com.docker.compose.project";
const COMPOSE_LABEL_SERVICE = "com.docker.compose.service";
const BACKUP_KEEP_COUNT = 3;

export interface ComposeContext {
  workingDir: string; // host path of the compose project
  projectName: string;
  serviceName: string;
}

/**
 * Manages self-update via Docker API.
 *
 * Pattern: instead of stopping itself directly (which kills the process and
 * leaves the swap incomplete), spawns a temporary helper container running
 * `docker compose pull && docker compose up -d` that survives our death.
 */
export class UpdateManager {
  private logger: Logger;
  private eventBus: EventBus;
  private backupManager: BackupManager;
  private updating = false;
  private composeContextCache: ComposeContext | null | undefined = undefined;

  constructor(eventBus: EventBus, backupManager: BackupManager, logger: Logger) {
    this.eventBus = eventBus;
    this.backupManager = backupManager;
    this.logger = logger.child({ module: "update-manager" });
  }

  isDockerAvailable(): boolean {
    return existsSync(DOCKER_SOCKET_PATH);
  }

  isUpdating(): boolean {
    return this.updating;
  }

  /**
   * Check whether Sowel is running under docker compose by inspecting its
   * own container labels. Result is cached after first call.
   */
  isComposeManaged(): boolean {
    return this.getComposeContext() !== null;
  }

  /**
   * Read compose labels from the current container's inspect data.
   * Returns null if Sowel is not running under compose (or not in Docker at all).
   */
  getComposeContext(): ComposeContext | null {
    if (this.composeContextCache !== undefined) {
      return this.composeContextCache;
    }

    if (!this.isDockerAvailable()) {
      this.composeContextCache = null;
      return null;
    }

    // Synchronous check via inspect — done lazily, only once
    // We do it sync-style by triggering the async dynamic import upfront
    // and caching the result. Since this method is sync, callers that need
    // a fresh value should use refreshComposeContext().
    return this.composeContextCache ?? null;
  }

  /**
   * Refresh the compose context by inspecting the current container.
   * Must be called once on startup (after dockerode is available).
   */
  async refreshComposeContext(): Promise<ComposeContext | null> {
    if (!this.isDockerAvailable()) {
      this.composeContextCache = null;
      return null;
    }

    try {
      const { default: Docker } = await import("dockerode");
      const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });
      const self = await this.findSelfContainer(docker);
      if (!self) {
        this.logger.warn("Could not find self container — compose detection skipped");
        this.composeContextCache = null;
        return null;
      }

      const inspection = await self.inspect();
      const labels = (inspection.Config.Labels ?? {}) as Record<string, string>;
      const workingDir = labels[COMPOSE_LABEL_WORKING_DIR];
      const projectName = labels[COMPOSE_LABEL_PROJECT];
      const serviceName = labels[COMPOSE_LABEL_SERVICE];

      if (!workingDir || !projectName || !serviceName) {
        this.logger.info("Container is not managed by docker compose");
        this.composeContextCache = null;
        return null;
      }

      this.composeContextCache = { workingDir, projectName, serviceName };
      this.logger.info({ workingDir, projectName, serviceName }, "Compose context detected");
      return this.composeContextCache;
    } catch (err) {
      this.logger.warn({ err }, "Failed to refresh compose context");
      this.composeContextCache = null;
      return null;
    }
  }

  /**
   * Trigger self-update.
   *
   * Flow:
   * 1. Validate prerequisites (Docker available, compose managed, not already updating)
   * 2. Create an automatic backup in data/backups/
   * 3. Rotate backups (keep N most recent)
   * 4. Spawn a helper container that will do `docker compose pull && up -d`
   *    after a short delay (to let our API response return)
   * 5. Return immediately — the helper will outlive our process
   *
   * Errors are emitted via system.update.error event.
   */
  async update(targetVersion: string): Promise<void> {
    if (this.updating) {
      throw new Error("Update already in progress");
    }
    if (!this.isDockerAvailable()) {
      throw new Error("Docker socket not available");
    }

    const composeCtx = this.getComposeContext();
    if (!composeCtx) {
      throw new Error(
        "Self-update requires docker compose. Update manually with: docker compose pull && docker compose up -d",
      );
    }

    this.updating = true;

    try {
      // Step 1: Auto backup
      this.emitProgress("backup", "Creating pre-update backup...");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupName = `sowel-backup-pre-v${targetVersion}-${ts}.zip`;
      try {
        const result = await this.backupManager.exportToFile(backupName);
        this.logger.info({ filename: backupName, size: result.size }, "Pre-update backup created");
      } catch (err) {
        this.logger.error({ err }, "Pre-update backup failed — aborting update");
        throw new Error(
          `Pre-update backup failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      // Step 2: Rotate old backups
      try {
        const { deleted } = this.backupManager.rotateLocalBackups(BACKUP_KEEP_COUNT);
        if (deleted.length > 0) {
          this.logger.info({ deleted }, "Old backups rotated");
        }
      } catch (err) {
        // Non-fatal — log and continue
        this.logger.warn({ err }, "Failed to rotate old backups");
      }

      // Step 3: Spawn helper container
      this.emitProgress("spawning", `Spawning update helper for v${targetVersion}...`);
      await this.spawnHelper(targetVersion, composeCtx);

      this.emitProgress(
        "spawned",
        `Helper started — Sowel will restart shortly as v${targetVersion}`,
      );
      this.logger.info({ targetVersion }, "Update helper spawned — Sowel will restart");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err, targetVersion }, "Self-update failed");
      this.eventBus.emit({ type: "system.update.error", error: message });
      this.updating = false;
      throw err;
    }
    // NOTE: we do NOT reset `this.updating = false` here — the helper will
    // stop us soon, so leaving the flag set prevents duplicate triggers.
  }

  /**
   * Find the current container (Sowel itself) by hostname.
   * Docker sets the container hostname to the container ID prefix by default.
   */
  private async findSelfContainer(
    docker: InstanceType<typeof import("dockerode")>,
  ): Promise<InstanceType<typeof import("dockerode").Container> | null> {
    const currentHostname = hostname();
    const containers = await docker.listContainers({ all: true });

    for (const info of containers) {
      if (info.Id.startsWith(currentHostname)) {
        return docker.getContainer(info.Id);
      }
    }

    return null;
  }

  /**
   * Create and start a temporary helper container that runs:
   *   sleep 5 && docker compose pull && docker compose up -d <service>
   *
   * The helper has the Docker socket mounted so it can talk to the daemon
   * directly, and the compose working directory mounted so it can read the
   * compose file. AutoRemove ensures it cleans up after itself.
   */
  private async spawnHelper(targetVersion: string, ctx: ComposeContext): Promise<void> {
    const { default: Docker } = await import("dockerode");
    const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });

    // Remove any leftover helper from a previous failed update
    try {
      const existing = docker.getContainer(HELPER_NAME);
      await existing.remove({ force: true });
      this.logger.debug("Removed leftover helper container");
    } catch {
      // Not present — that's fine
    }

    // Pull the helper image (cached after first time)
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        docker.pull(HELPER_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return rejectPromise(err);
          docker.modem.followProgress(stream, (progressErr: Error | null) => {
            if (progressErr) return rejectPromise(progressErr);
            resolvePromise();
          });
        });
      });
    } catch (err) {
      throw new Error(
        `Failed to pull helper image ${HELPER_IMAGE}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // Build the command — sleep then compose pull + up -d for the sowel service only
    const cmd = [
      "sh",
      "-c",
      `sleep 5 && echo "[sowel-updater] pulling..." && docker compose pull ${ctx.serviceName} && echo "[sowel-updater] recreating ${ctx.serviceName}..." && docker compose up -d ${ctx.serviceName} && echo "[sowel-updater] done — Sowel updated to v${targetVersion}"`,
    ];

    const helper = await docker.createContainer({
      Image: HELPER_IMAGE,
      name: HELPER_NAME,
      Cmd: cmd,
      WorkingDir: "/workdir",
      Env: [`COMPOSE_PROJECT_NAME=${ctx.projectName}`],
      HostConfig: {
        AutoRemove: true,
        Binds: ["/var/run/docker.sock:/var/run/docker.sock", `${ctx.workingDir}:/workdir`],
      },
    });

    await helper.start();
    this.logger.info(
      {
        helper: HELPER_NAME,
        image: HELPER_IMAGE,
        workingDir: ctx.workingDir,
        service: ctx.serviceName,
      },
      "Update helper container started",
    );
  }

  private emitProgress(step: string, message: string): void {
    this.eventBus.emit({ type: "system.update.progress", step, message });
  }
}
