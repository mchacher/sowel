import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Logger } from "./logger.js";
import type { EventBus } from "./event-bus.js";
import type { UpdateManager } from "./update-manager.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const GITHUB_REPO = "mchacher/sowel";
const DOCKER_SOCKET_PATH = "/var/run/docker.sock";

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  dockerAvailable: boolean;
  composeManaged: boolean;
}

/**
 * Polls GitHub releases API to check for new Sowel versions.
 * Emits system.update.available event when a newer version is found.
 */
export class VersionChecker {
  private logger: Logger;
  private eventBus: EventBus;
  private updateManager: UpdateManager;
  private currentVersion: string;
  private latestVersion: string | null = null;
  private releaseUrl: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(eventBus: EventBus, updateManager: UpdateManager, logger: Logger) {
    this.eventBus = eventBus;
    this.updateManager = updateManager;
    this.logger = logger.child({ module: "version-checker" });

    const pkgPath = resolve(import.meta.dirname ?? ".", "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
    this.currentVersion = pkg.version;
  }

  /**
   * Start checking for updates (initial check + periodic).
   */
  start(): void {
    // Initial check after 10s (let the server start first)
    setTimeout(() => {
      this.check().catch((err) => {
        this.logger.warn({ err }, "Initial version check failed");
      });
    }, 10_000);

    // Periodic check every 1h
    this.timer = setInterval(() => {
      this.check().catch((err) => {
        this.logger.warn({ err }, "Periodic version check failed");
      });
    }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getVersionInfo(): VersionInfo {
    return {
      current: this.currentVersion,
      latest: this.latestVersion,
      updateAvailable:
        this.latestVersion !== null &&
        this.latestVersion !== this.currentVersion &&
        this.isNewer(this.latestVersion, this.currentVersion),
      releaseUrl: this.releaseUrl,
      dockerAvailable: existsSync(DOCKER_SOCKET_PATH),
      composeManaged: this.updateManager.isComposeManaged(),
    };
  }

  /**
   * Force a fresh check of the GitHub releases API and return the updated info.
   * Used by the manual "Check for updates" button.
   */
  async checkNow(): Promise<VersionInfo> {
    await this.check();
    return this.getVersionInfo();
  }

  private async check(): Promise<void> {
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });

      if (!res.ok) {
        this.logger.debug({ status: res.status }, "GitHub releases API returned non-OK");
        return;
      }

      const release = (await res.json()) as { tag_name: string; html_url: string };
      const latest = release.tag_name.replace(/^v/, "");

      if (latest !== this.latestVersion) {
        this.latestVersion = latest;
        this.releaseUrl = release.html_url;

        if (this.isNewer(latest, this.currentVersion)) {
          this.logger.info({ current: this.currentVersion, latest }, "New version available");
          this.eventBus.emit({
            type: "system.update.available",
            current: this.currentVersion,
            latest,
            releaseUrl: release.html_url,
          });
        } else {
          this.logger.debug({ current: this.currentVersion, latest }, "Version is up to date");
        }
      }
    } catch (err) {
      this.logger.debug({ err }, "Version check failed");
    }
  }

  /**
   * Simple semver comparison: returns true if a > b.
   */
  private isNewer(a: string, b: string): boolean {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
      if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
    }
    return false;
  }
}
