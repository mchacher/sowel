import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve as resolvePath } from "node:path";
import type { Logger } from "./logger.js";
import type { EventBus } from "./event-bus.js";
import type { BackupManager } from "../backup/backup-manager.js";

const DOCKER_SOCKET_PATH = "/var/run/docker.sock";
const HELPER_IMAGE = "docker:25-cli";
const HELPER_NAME = "sowel-updater";
const RESTART_HELPER_NAME = "sowel-restarter";
const COMPOSE_LABEL_WORKING_DIR = "com.docker.compose.project.working_dir";
const COMPOSE_LABEL_PROJECT = "com.docker.compose.project";
const COMPOSE_LABEL_SERVICE = "com.docker.compose.service";
const BACKUP_KEEP_COUNT = 3;
/** How many trailing helper log lines to quote back in a failure message. */
const HELPER_LOG_TAIL_LINES = 5;
/** Cap on the quoted tail, so a runaway helper cannot flood the event bus. */
const HELPER_LOG_TAIL_MAX_CHARS = 400;

type DockerContainer = InstanceType<typeof import("dockerode").Container>;
/**
 * Which helper-driven operation a failure belongs to. Both spawn a helper and
 * both report through `system.update.error`, but "your settings were saved,
 * only the restart failed" is not the same sentence as "no new version was
 * installed" — the UI needs to know which one it is showing.
 */
type HelperOperation = "update" | "restart";

/** Quote a string for safe interpolation into a shell command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the multi-step shell script that the sowel-updater helper container
 * runs to perform a self-update. Exported for unit testing.
 *
 * The script (with `set -e`):
 *  1. Pull the target image by version tag, retag locally as :latest.
 *  2. Normalize the compose file's `image:` line to :latest (idempotent).
 *     If a rewrite happens, the original is saved to docker-compose.yml.bak
 *     unless that file already exists (don't clobber an existing backup).
 *  3. Force-recreate the sowel container — guarantees the new local
 *     :latest image is used even when compose detects no diff.
 *  4. Verify the running container's image ID matches the pulled target
 *     image ID. On mismatch: log FAILED + exit 1 so the user actually
 *     sees that the self-update did not take effect.
 *  5. Prune old image tags.
 *
 * See spec 104 for rationale.
 */
export function buildHelperScript(opts: {
  image: string;
  latestTag: string;
  serviceName: string;
  targetVersion: string;
  pruneCmd: string;
}): string {
  const { image, latestTag, serviceName, targetVersion, pruneCmd } = opts;
  return [
    "set -e",
    "sleep 5",
    `echo "[sowel-updater] pulling ${image}..."`,
    `docker pull ${image}`,
    `docker tag ${image} ${latestTag}`,
    "COMPOSE_FILE=docker-compose.yml",
    'if [ -f "$COMPOSE_FILE" ]; then',
    // Only rewrite if the line exists and isn't already :latest.
    `  if grep -qE '^[[:space:]]*image:[[:space:]]*ghcr\\.io/mchacher/sowel:[^[:space:]]+' "$COMPOSE_FILE"; then`,
    `    if ! grep -qE '^[[:space:]]*image:[[:space:]]*ghcr\\.io/mchacher/sowel:latest[[:space:]]*$' "$COMPOSE_FILE"; then`,
    `      [ -f "$COMPOSE_FILE.bak" ] || cp "$COMPOSE_FILE" "$COMPOSE_FILE.bak"`,
    `      sed -i.tmp -E 's|^([[:space:]]*image:[[:space:]]*)ghcr\\.io/mchacher/sowel:[^[:space:]]+|\\1ghcr.io/mchacher/sowel:latest|' "$COMPOSE_FILE"`,
    `      rm -f "$COMPOSE_FILE.tmp"`,
    `      echo "[sowel-updater] compose image normalized to :latest (backup at $COMPOSE_FILE.bak)"`,
    "    fi",
    "  fi",
    "fi",
    `echo "[sowel-updater] recreating ${serviceName}..."`,
    `docker compose up -d --force-recreate ${serviceName}`,
    `echo "[sowel-updater] verifying running image..."`,
    // Resolve target image ID then compare to the running container's image ID.
    `TARGET_ID=$(docker image inspect ${image} --format '{{.Id}}')`,
    `RUNNING_CONTAINER=$(docker compose ps -q ${serviceName})`,
    `RUNNING_ID=$(docker inspect "$RUNNING_CONTAINER" --format '{{.Image}}')`,
    `if [ "$TARGET_ID" != "$RUNNING_ID" ]; then`,
    `  echo "[sowel-updater] FAILED — running image $RUNNING_ID does not match target $TARGET_ID"`,
    "  exit 1",
    "fi",
    `echo "[sowel-updater] pruning old Sowel images..."`,
    pruneCmd,
    `echo "[sowel-updater] done — Sowel updated to v${targetVersion}"`,
  ].join("\n");
}

/**
 * Turn the raw body of a non-TTY `docker logs` call into plain text.
 *
 * The daemon multiplexes stdout and stderr into frames: one stream byte, three
 * zero bytes, then a big-endian payload length, then the payload. A container
 * created with a TTY sends unframed bytes instead, and a `tail` request can cut
 * the first frame in half, so anything that does not look like a header is
 * handed back verbatim rather than dropped — this runs while reporting a
 * failure, and losing the reason would defeat the point.
 */
export function demuxDockerLogs(buf: Buffer): string {
  const chunks: string[] = [];
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const framed =
      buf[offset] <= 2 && buf[offset + 1] === 0 && buf[offset + 2] === 0 && buf[offset + 3] === 0;
    if (!framed) return buf.toString("utf-8");

    const length = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = Math.min(start + length, buf.length);
    chunks.push(buf.toString("utf-8", start, end));
    if (end < start + length) break; // truncated frame — keep what arrived
    offset = end;
  }

  if (chunks.length === 0) return buf.toString("utf-8");
  return chunks.join("");
}

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

  /** Read the current Sowel version from package.json — used to know the
   * version we are upgrading FROM so we can keep its image around for a
   * cheap rollback. Returns null if package.json can't be read. */
  private readSelfVersion(): string | null {
    try {
      const pkgPath = resolvePath(process.cwd(), "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
      return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
      return null;
    }
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
      this.eventBus.emit({ type: "system.update.error", error: message, operation: "update" });
      this.updating = false;
      throw err;
    }
    // NOTE: `this.updating` stays set on purpose — the helper is about to stop
    // us, and holding the flag keeps a second trigger out in the meantime. If
    // the helper dies instead of swapping us, `watchHelper` releases it.
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
    // Pull by explicit version tag then retag as :latest locally.
    // This avoids a GHCR CDN propagation delay where `docker compose pull`
    // (which pulls :latest) may still resolve to the old digest for several
    // minutes after a new release is pushed.
    const image = `ghcr.io/mchacher/sowel:${targetVersion}`;
    const latestTag = "ghcr.io/mchacher/sowel:latest";

    // After a successful upgrade, prune older Sowel images so /var/lib/docker
    // doesn't grow unbounded across self-updates (~1GB per release × N releases).
    // Keep three tags around: :latest, the new :targetVersion, and the version
    // we are upgrading FROM (cheap rollback target). Everything else gets
    // removed. Errors are tolerated (`|| true`) so a leftover tag never blocks
    // an otherwise successful update.
    const previousVersion = this.readSelfVersion();
    const keepArgs = [
      latestTag,
      image,
      previousVersion ? `ghcr.io/mchacher/sowel:${previousVersion}` : null,
    ]
      .filter((v): v is string => Boolean(v))
      .map((tag) => `-e ${shellQuote(tag)}`)
      .join(" ");
    const pruneCmd = `docker images --format '{{.Repository}}:{{.Tag}}' | grep '^ghcr.io/mchacher/sowel:' | grep -v ${keepArgs} | xargs -r docker rmi -f || true`;

    // Spec 104: defensive self-update. Three changes vs. the previous flow:
    //   1. Normalize compose's `image:` line to :latest (idempotent, with .bak)
    //   2. --force-recreate to guarantee the swap even if compose sees no diff
    //   3. Verify the running container's image ID matches the pulled target,
    //      fail loudly on mismatch instead of logging a false "done".
    const cmd = [
      "sh",
      "-c",
      buildHelperScript({
        image,
        latestTag,
        serviceName: ctx.serviceName,
        targetVersion,
        pruneCmd,
      }),
    ];

    await this.runHelperContainer({
      name: HELPER_NAME,
      operation: "update",
      cmd,
      ctx,
      logContext: {
        helper: HELPER_NAME,
        image: HELPER_IMAGE,
        workingDir: ctx.workingDir,
        service: ctx.serviceName,
      },
      logMessage: "Update helper container started",
    });
  }

  /**
   * Shared helper spawn logic: removes any leftover helper, pulls the image,
   * creates and starts a new container with the given command + mounts.
   * Used by both `spawnHelper()` (upgrade) and the restart flow.
   */
  private async runHelperContainer(args: {
    name: string;
    operation: HelperOperation;
    cmd: string[];
    ctx: ComposeContext;
    logContext: Record<string, unknown>;
    logMessage: string;
  }): Promise<void> {
    const { default: Docker } = await import("dockerode");
    const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });

    // Remove any leftover helper from a previous failed run
    try {
      const existing = docker.getContainer(args.name);
      await existing.remove({ force: true });
      this.logger.debug({ name: args.name }, "Removed leftover helper container");
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

    // Mount the host compose directory at its ORIGINAL path (not remapped
    // to /workdir). This is critical: docker compose stamps the working
    // directory into the container's labels. If we remap to /workdir, the
    // next Sowel instance reads working_dir=/workdir from its labels and
    // future updates fail because /workdir doesn't exist on the host.
    const hostDir = args.ctx.workingDir;
    const helper = await docker.createContainer({
      Image: HELPER_IMAGE,
      name: args.name,
      Cmd: args.cmd,
      WorkingDir: hostDir,
      Env: [`COMPOSE_PROJECT_NAME=${args.ctx.projectName}`],
      HostConfig: {
        // AutoRemove disabled so we can inspect helper logs after completion
        // via `docker logs sowel-updater`. The next update will clean up the
        // leftover container before creating a new one (line 263).
        AutoRemove: false,
        Binds: ["/var/run/docker.sock:/var/run/docker.sock", `${hostDir}:${hostDir}`],
      },
    });

    await helper.start();
    this.logger.info(args.logContext, args.logMessage);
    this.watchHelper(helper, args.name, args.operation);
  }

  /**
   * Watch a helper we just started, and release `updating` if it dies without
   * taking us with it.
   *
   * On the happy path this callback never runs: the helper recreates the Sowel
   * container, so this process is gone long before the helper exits. Reaching
   * the callback therefore means the swap did not happen — the image pull
   * failed, compose refused, or the image-ID verification tripped.
   *
   * Before this existed, `updating` stayed set for the life of the process:
   * the UI kept its full-screen overlay, and `/system/update` and
   * `/system/restart` answered 409 until someone restarted the container by
   * hand. A registry outage on 2026-09-02 (`docker pull` timing out against
   * ghcr.io) pinned an instance that way for hours, with the real cause
   * readable only in `docker logs sowel-updater`. So we quote that tail into
   * the error the admin actually sees.
   */
  private watchHelper(helper: DockerContainer, name: string, operation: HelperOperation): void {
    void (async () => {
      let outcome: string;
      try {
        const result = (await helper.wait()) as { StatusCode?: number } | undefined;
        const code = result?.StatusCode ?? -1;
        outcome = `Helper "${name}" exited with code ${code} without restarting Sowel`;
      } catch (err) {
        // The daemon went away, or the container was removed under us. An
        // unknown outcome still beats a flag pinned for the life of the process.
        outcome = `Helper "${name}" could not be watched: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      // A failure on our own side may have released the flag already; and a
      // helper that finished after we gave up is not news.
      if (!this.updating) return;

      const tail = await this.readHelperTail(helper);
      const error = tail ? `${outcome} — ${tail}` : outcome;
      this.updating = false;
      this.logger.error(
        { helper: name, operation, tail },
        "Helper finished without restarting Sowel",
      );
      this.eventBus.emit({ type: "system.update.error", error, operation });
    })();
  }

  /**
   * Last few lines the helper printed, for the failure message. Best effort:
   * an unreadable log must not mask the failure it was meant to explain.
   */
  private async readHelperTail(helper: DockerContainer): Promise<string> {
    try {
      const raw = (await helper.logs({
        stdout: true,
        stderr: true,
        tail: 20,
      })) as unknown as Buffer;

      return demuxDockerLogs(Buffer.from(raw))
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-HELPER_LOG_TAIL_LINES)
        .join(" / ")
        .slice(0, HELPER_LOG_TAIL_MAX_CHARS);
    } catch {
      return "";
    }
  }

  /**
   * Trigger a container restart (NOT an upgrade) via a helper container.
   *
   * Used when a configuration change requires Node to re-read process.env.TZ
   * (e.g., after changing home location and re-deriving the timezone).
   *
   * The helper container runs:
   *   sleep 3 && docker compose up -d --force-recreate <service>
   *
   * --force-recreate is critical: without it, compose sees no diff (image
   * unchanged, env unchanged) and skips the restart entirely — Sowel would
   * keep running with stale env. The helper exiting without having restarted
   * us is caught by `watchHelper`, which releases `updating` and reports why.
   */
  async restartViaHelper(): Promise<void> {
    if (this.updating) {
      throw new Error("An operation is already in progress");
    }
    if (!this.isDockerAvailable()) {
      throw new Error("Docker socket not available");
    }
    const ctx = this.getComposeContext();
    if (!ctx) {
      throw new Error("Cannot restart: Sowel is not managed by docker compose. Restart manually.");
    }

    this.updating = true;
    try {
      this.emitProgress("restart", "Spawning restart helper...");
      const cmd = [
        "sh",
        "-c",
        `sleep 3 && echo "[sowel-restarter] recreating ${ctx.serviceName}..." && docker compose up -d --force-recreate ${ctx.serviceName} && echo "[sowel-restarter] done"`,
      ];
      await this.runHelperContainer({
        name: RESTART_HELPER_NAME,
        operation: "restart",
        cmd,
        ctx,
        logContext: {
          helper: RESTART_HELPER_NAME,
          image: HELPER_IMAGE,
          workingDir: ctx.workingDir,
          service: ctx.serviceName,
        },
        logMessage: "Restart helper container started",
      });
      this.emitProgress("spawned", "Restart helper started — Sowel will restart shortly");
      this.logger.info("Restart helper spawned — Sowel will restart");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, "Restart-via-helper failed");
      this.eventBus.emit({ type: "system.update.error", error: message, operation: "restart" });
      this.updating = false;
      throw err;
    }
    // NOTE: `this.updating` stays set on purpose — the helper is about to stop
    // us, and holding the flag keeps a second trigger out in the meantime. If
    // the helper dies instead of swapping us, `watchHelper` releases it.
  }

  private emitProgress(step: string, message: string): void {
    this.eventBus.emit({ type: "system.update.progress", step, message });
  }
}
