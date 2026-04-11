import { describe, it, expect, beforeEach, vi } from "vitest";
import { UpdateManager } from "./update-manager.js";
import { EventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { BackupManager } from "../backup/backup-manager.js";

const logger = createLogger("silent").logger;

function makeBackupStub(opts: { exportFails?: boolean } = {}): BackupManager {
  return {
    exportToFile: vi.fn(async (filename: string) => {
      if (opts.exportFails) throw new Error("disk full");
      return { path: `/tmp/${filename}`, size: 1234 };
    }),
    rotateLocalBackups: vi.fn(() => ({ deleted: [] })),
    listLocalBackups: vi.fn(() => []),
  } as unknown as BackupManager;
}

describe("UpdateManager", () => {
  let eventBus: EventBus;
  let backup: BackupManager;
  let manager: UpdateManager;

  beforeEach(() => {
    eventBus = new EventBus(logger);
    backup = makeBackupStub();
    manager = new UpdateManager(eventBus, backup, logger);
  });

  describe("isUpdating", () => {
    it("returns false initially", () => {
      expect(manager.isUpdating()).toBe(false);
    });
  });

  describe("isComposeManaged", () => {
    it("returns false when no context cached", () => {
      // No refresh has been called, cache is undefined → returns false
      expect(manager.isComposeManaged()).toBe(false);
    });
  });

  describe("update — error cases", () => {
    it("throws when Docker socket is not available", async () => {
      // Stub: Docker socket check returns false (it's a real fs check on /var/run/docker.sock)
      // On macOS in CI/local without Docker Desktop running, this is false
      // On Linux with Docker, this might be true — but we have no compose context anyway
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(false);

      await expect(manager.update("1.0.7")).rejects.toThrow(/Docker socket not available/);
    });

    it("throws when not compose managed", async () => {
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(true);
      vi.spyOn(manager, "getComposeContext").mockReturnValue(null);

      await expect(manager.update("1.0.7")).rejects.toThrow(/Self-update requires docker compose/);
    });

    it("throws when already updating", async () => {
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(true);
      vi.spyOn(manager, "getComposeContext").mockReturnValue({
        workingDir: "/opt/sowel",
        projectName: "sowel",
        serviceName: "sowel",
      });
      // Spy on spawnHelper to make it pending forever
      const spawnSpy = vi
        .spyOn(manager as unknown as { spawnHelper: () => Promise<void> }, "spawnHelper")
        .mockImplementation(() => new Promise(() => {}));

      // Trigger first update — won't resolve, but updating flag is set
      void manager.update("1.0.7");
      // Allow microtasks to run so backup exportToFile resolves and updating becomes true
      await new Promise((r) => setImmediate(r));

      expect(manager.isUpdating()).toBe(true);

      await expect(manager.update("1.0.8")).rejects.toThrow(/Update already in progress/);

      spawnSpy.mockRestore();
    });

    it("aborts the update when backup fails", async () => {
      const failingBackup = makeBackupStub({ exportFails: true });
      const failingManager = new UpdateManager(eventBus, failingBackup, logger);
      vi.spyOn(failingManager, "isDockerAvailable").mockReturnValue(true);
      vi.spyOn(failingManager, "getComposeContext").mockReturnValue({
        workingDir: "/opt/sowel",
        projectName: "sowel",
        serviceName: "sowel",
      });

      await expect(failingManager.update("1.0.7")).rejects.toThrow(/Pre-update backup failed/);

      // Should be back to not-updating after the failure
      expect(failingManager.isUpdating()).toBe(false);
    });
  });

  describe("update — success path (mocked spawn)", () => {
    it("creates a backup, rotates, and spawns helper", async () => {
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(true);
      vi.spyOn(manager, "getComposeContext").mockReturnValue({
        workingDir: "/opt/sowel",
        projectName: "sowel",
        serviceName: "sowel",
      });

      const spawnSpy = vi
        .spyOn(manager as unknown as { spawnHelper: () => Promise<void> }, "spawnHelper")
        .mockResolvedValue();

      const progressEvents: Array<{ step: string; message: string }> = [];
      eventBus.on((event) => {
        if (event.type === "system.update.progress") {
          progressEvents.push({ step: event.step, message: event.message });
        }
      });

      await manager.update("1.0.7");

      // Backup was called with a filename containing the version
      expect(backup.exportToFile).toHaveBeenCalledWith(
        expect.stringMatching(/sowel-backup-pre-v1\.0\.7-/),
      );
      // Rotation was called with 3
      expect(backup.rotateLocalBackups).toHaveBeenCalledWith(3);
      // Helper spawn was called
      expect(spawnSpy).toHaveBeenCalledWith(
        "1.0.7",
        expect.objectContaining({ workingDir: "/opt/sowel", serviceName: "sowel" }),
      );

      // Progress events were emitted in order
      const steps = progressEvents.map((e) => e.step);
      expect(steps).toContain("backup");
      expect(steps).toContain("spawning");
      expect(steps).toContain("spawned");

      // Updating flag stays true (we expect helper to kill us soon)
      expect(manager.isUpdating()).toBe(true);
    });
  });

  describe("restartViaHelper — error cases", () => {
    it("throws when Docker socket is not available", async () => {
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(false);
      await expect(manager.restartViaHelper()).rejects.toThrow(/Docker socket not available/);
    });

    it("throws when not compose managed", async () => {
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(true);
      vi.spyOn(manager, "getComposeContext").mockReturnValue(null);
      await expect(manager.restartViaHelper()).rejects.toThrow(/not managed by docker compose/);
    });

    it("throws when an operation is already in progress", async () => {
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(true);
      vi.spyOn(manager, "getComposeContext").mockReturnValue({
        workingDir: "/opt/sowel",
        projectName: "sowel",
        serviceName: "sowel",
      });
      const runSpy = vi
        .spyOn(
          manager as unknown as { runHelperContainer: () => Promise<void> },
          "runHelperContainer",
        )
        .mockImplementation(() => new Promise(() => {}));

      void manager.restartViaHelper();
      await new Promise((r) => setImmediate(r));
      expect(manager.isUpdating()).toBe(true);

      await expect(manager.restartViaHelper()).rejects.toThrow(/already in progress/);

      runSpy.mockRestore();
    });
  });

  describe("restartViaHelper — success path", () => {
    it("spawns a restart helper via runHelperContainer", async () => {
      vi.spyOn(manager, "isDockerAvailable").mockReturnValue(true);
      vi.spyOn(manager, "getComposeContext").mockReturnValue({
        workingDir: "/opt/sowel",
        projectName: "sowel",
        serviceName: "sowel",
      });

      const runSpy = vi
        .spyOn(
          manager as unknown as { runHelperContainer: (args: unknown) => Promise<void> },
          "runHelperContainer",
        )
        .mockResolvedValue();

      const progressEvents: string[] = [];
      eventBus.on((event) => {
        if (event.type === "system.update.progress") {
          progressEvents.push(event.step);
        }
      });

      await manager.restartViaHelper();

      expect(runSpy).toHaveBeenCalledTimes(1);
      const callArg = runSpy.mock.calls[0][0] as { name: string; cmd: string[] };
      expect(callArg.name).toBe("sowel-restarter");
      // Command should contain docker compose up -d (no pull)
      const fullCmd = callArg.cmd.join(" ");
      expect(fullCmd).toContain("docker compose up -d sowel");
      expect(fullCmd).not.toContain("docker compose pull");

      expect(progressEvents).toContain("restart");
      expect(progressEvents).toContain("spawned");

      // Updating flag stays true
      expect(manager.isUpdating()).toBe(true);
    });
  });
});
