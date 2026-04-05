import { existsSync } from "node:fs";
import type { Logger } from "./logger.js";
import type { EventBus } from "./event-bus.js";

const DOCKER_SOCKET_PATH = "/var/run/docker.sock";
const DOCKER_IMAGE = "ghcr.io/mchacher/sowel";

/**
 * Manages self-update via Docker API.
 * Pulls new image, stops current container, recreates with same config.
 */
export class UpdateManager {
  private logger: Logger;
  private eventBus: EventBus;
  private updating = false;

  constructor(eventBus: EventBus, logger: Logger) {
    this.eventBus = eventBus;
    this.logger = logger.child({ module: "update-manager" });
  }

  isDockerAvailable(): boolean {
    return existsSync(DOCKER_SOCKET_PATH);
  }

  isUpdating(): boolean {
    return this.updating;
  }

  /**
   * Pull new Docker image and recreate the current container.
   * Progress is reported via EventBus (system.update.progress).
   */
  async update(targetVersion: string): Promise<void> {
    if (this.updating) {
      throw new Error("Update already in progress");
    }
    if (!this.isDockerAvailable()) {
      throw new Error("Docker socket not available");
    }

    this.updating = true;
    const image = `${DOCKER_IMAGE}:${targetVersion}`;

    try {
      // Dynamic import to avoid loading dockerode when not needed
      const { default: Docker } = await import("dockerode");
      const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });

      // Step 1: Pull new image
      this.emitProgress("pulling", `Pulling ${image}...`);
      this.logger.info({ image }, "Pulling new Docker image");

      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (progressErr: Error | null) => {
            if (progressErr) return reject(progressErr);
            resolve();
          });
        });
      });

      this.logger.info({ image }, "Image pulled successfully");

      // Step 2: Find current container
      this.emitProgress("inspecting", "Inspecting current container...");
      const currentContainer = await this.findCurrentContainer(docker);
      if (!currentContainer) {
        throw new Error("Could not find current Sowel container");
      }

      const inspection = await currentContainer.inspect();
      this.logger.info(
        { containerId: inspection.Id.slice(0, 12), name: inspection.Name },
        "Current container found",
      );

      // Step 3: Stop current container
      this.emitProgress("stopping", "Stopping current container...");
      this.logger.info("Stopping current container");
      await currentContainer.stop();

      // Step 4: Remove current container
      this.emitProgress("removing", "Removing old container...");
      await currentContainer.remove();

      // Step 5: Create new container with same config
      this.emitProgress("creating", "Creating new container...");
      const newContainer = await docker.createContainer({
        Image: image,
        name: inspection.Name.replace(/^\//, ""),
        Env: inspection.Config.Env,
        ExposedPorts: inspection.Config.ExposedPorts,
        HostConfig: {
          ...inspection.HostConfig,
          // Ensure Docker socket is still mounted
          Binds: inspection.HostConfig?.Binds,
          PortBindings: inspection.HostConfig?.PortBindings,
          RestartPolicy: inspection.HostConfig?.RestartPolicy,
        },
        Labels: inspection.Config.Labels,
      });

      // Step 6: Start new container
      this.emitProgress("starting", "Starting new container...");
      await newContainer.start();

      this.emitProgress("done", `Updated to ${targetVersion}. Reloading...`);
      this.logger.info({ targetVersion }, "Self-update complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err, targetVersion }, "Self-update failed");
      this.eventBus.emit({ type: "system.update.error", error: message });
      throw err;
    } finally {
      this.updating = false;
    }
  }

  /**
   * Find the current Sowel container by matching the hostname (container ID).
   */
  private async findCurrentContainer(
    docker: InstanceType<typeof import("dockerode")>,
  ): Promise<InstanceType<typeof import("dockerode").Container> | null> {
    const { hostname } = await import("node:os");
    const currentHostname = hostname();
    const containers = await docker.listContainers({ all: true });

    // Match by hostname (Docker sets hostname to container ID prefix)
    for (const info of containers) {
      if (info.Id.startsWith(currentHostname)) {
        return docker.getContainer(info.Id);
      }
    }

    // Fallback: match by image name
    for (const info of containers) {
      if (info.Image.includes("sowel")) {
        return docker.getContainer(info.Id);
      }
    }

    return null;
  }

  private emitProgress(step: string, message: string): void {
    this.eventBus.emit({ type: "system.update.progress", step, message });
  }
}
