import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VersionChecker } from "./version-checker.js";
import { EventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { UpdateManager } from "./update-manager.js";
import type { EngineEvent } from "../shared/types.js";

const logger = createLogger("silent").logger;

function ghResponse(tag: string, ok = true, url = "https://github.com/mchacher/sowel/releases/x") {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => ({ tag_name: tag, html_url: url }),
  } as Response;
}

function makeChecker(composeManaged = false): {
  checker: VersionChecker;
  events: EngineEvent[];
  current: string;
} {
  const eventBus = new EventBus(logger);
  const events: EngineEvent[] = [];
  eventBus.on((e) => events.push(e));
  const updateManager = { isComposeManaged: () => composeManaged } as unknown as UpdateManager;
  const checker = new VersionChecker(eventBus, updateManager, logger);
  return { checker, events, current: checker.getVersionInfo().current };
}

describe("VersionChecker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the current version from package.json in the constructor", () => {
    const { current } = makeChecker();
    expect(current).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("emits system.update.available and flags updateAvailable when a newer release exists", async () => {
    const { checker, events, current } = makeChecker();
    const [maj, min, patch] = current.split(".").map(Number);
    const newer = `v${maj}.${min}.${patch + 1}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ghResponse(newer)),
    );

    const info = await checker.checkNow();

    expect(info.latest).toBe(newer.replace(/^v/, ""));
    expect(info.updateAvailable).toBe(true);
    expect(info.releaseUrl).toBe("https://github.com/mchacher/sowel/releases/x");
    const update = events.find((e) => e.type === "system.update.available");
    expect(update).toMatchObject({
      type: "system.update.available",
      current,
      latest: newer.replace(/^v/, ""),
      releaseUrl: "https://github.com/mchacher/sowel/releases/x",
    });
  });

  it("does not re-emit when a repeated check returns the same latest tag", async () => {
    const { checker, events, current } = makeChecker();
    const [maj, min, patch] = current.split(".").map(Number);
    const newer = `v${maj}.${min}.${patch + 1}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ghResponse(newer)),
    );

    await checker.checkNow();
    await checker.checkNow(); // same tag — cached, no second event

    expect(events.filter((e) => e.type === "system.update.available")).toHaveLength(1);
  });

  it("does not flag an update when the latest release equals the current version", async () => {
    const { checker, events, current } = makeChecker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ghResponse(`v${current}`)),
    );

    const info = await checker.checkNow();

    expect(info.latest).toBe(current);
    expect(info.updateAvailable).toBe(false);
    expect(events.some((e) => e.type === "system.update.available")).toBe(false);
  });

  it("does not flag an update when the latest release is older", async () => {
    const { checker } = makeChecker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ghResponse("v0.0.1")),
    );

    const info = await checker.checkNow();
    expect(info.updateAvailable).toBe(false);
  });

  it("ignores a non-OK GitHub response without throwing", async () => {
    const { checker } = makeChecker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ghResponse("v99.0.0", false)),
    );

    const info = await checker.checkNow();
    expect(info.latest).toBeNull();
    expect(info.updateAvailable).toBe(false);
  });

  it("swallows a fetch/network error", async () => {
    const { checker } = makeChecker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const info = await checker.checkNow();
    expect(info.latest).toBeNull();
  });

  it("reflects the compose-managed flag from the UpdateManager", () => {
    expect(makeChecker(true).checker.getVersionInfo().composeManaged).toBe(true);
    expect(makeChecker(false).checker.getVersionInfo().composeManaged).toBe(false);
  });

  it("stop() is safe to call before start()", () => {
    const { checker } = makeChecker();
    expect(() => checker.stop()).not.toThrow();
  });
});
