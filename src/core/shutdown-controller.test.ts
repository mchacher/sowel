import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createShutdownController, DEFAULT_SHUTDOWN_TIMEOUT_MS } from "./shutdown-controller.js";
import type { Logger } from "./logger.js";

// Issue #696 — the graceful shutdown had never run in production because an
// early `process.exit(0)` listener shadowed it. Nothing asserted the wiring,
// which is exactly why it went unnoticed. These tests are that assertion.

function makeLogger() {
  const self = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => self,
  };
  return self;
}

describe("createShutdownController", () => {
  // Typed with the real signature rather than a bare `vi.fn`: an untyped mock
  // is not assignable to `exit?: (code: number) => void`, which is invisible
  // while test files are excluded from the typecheck (#834).
  let exit: ReturnType<typeof vi.fn<(code: number) => void>>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    exit = vi.fn<(code: number) => void>();
    logger = makeLogger();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exits immediately when a signal arrives before boot finished", () => {
    // A hang during startup must stay killable — that is the whole reason the
    // early handler existed in the first place.
    const controller = createShutdownController({ exit });
    controller.handle("SIGTERM");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("runs the graceful sequence once it is installed", async () => {
    const graceful = vi.fn(async () => {});
    const controller = createShutdownController({ exit });
    controller.setGraceful(graceful, logger as unknown as Logger);

    controller.handle("SIGTERM");
    await vi.runAllTimersAsync();

    expect(graceful).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does NOT exit before the graceful sequence resolves", async () => {
    // The regression that mattered: exiting first is what dropped the InfluxDB
    // write buffer and skipped db.close() on every container restart.
    let release!: () => void;
    const graceful = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = createShutdownController({ exit });
    controller.setGraceful(graceful, logger as unknown as Logger);

    controller.handle("SIGTERM");
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();

    release();
    await vi.runAllTimersAsync();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("runs the sequence only once even if several signals arrive", async () => {
    const graceful = vi.fn(async () => {});
    const controller = createShutdownController({ exit });
    controller.setGraceful(graceful, logger as unknown as Logger);

    controller.handle("SIGTERM");
    controller.handle("SIGINT");
    await vi.runAllTimersAsync();

    expect(graceful).toHaveBeenCalledTimes(1);
  });

  it("exits at once on a second signal, without waiting for the sequence", () => {
    const graceful = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const controller = createShutdownController({ exit });
    controller.setGraceful(graceful, logger as unknown as Logger);

    controller.handle("SIGTERM");
    expect(exit).not.toHaveBeenCalled();

    controller.handle("SIGTERM");
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("cuts a hung sequence short rather than being SIGKILLed", async () => {
    // A stuck integration must not hold the process past the container's grace
    // period, or the runtime escalates a clean stop into a kill.
    const graceful = vi.fn(() => new Promise<void>(() => {}));
    const controller = createShutdownController({ exit, timeoutMs: 500 });
    controller.setGraceful(graceful, logger as unknown as Logger);

    controller.handle("SIGTERM");
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 500 }),
      expect.stringContaining("timed out"),
    );
  });

  it("still exits PROMPTLY when the sequence throws", async () => {
    // Must not lean on the watchdog: with a huge timeout, only the catch path
    // can produce the exit. (Reviewed finding — the earlier version of this
    // test passed even when the error path exited nothing, because
    // runAllTimersAsync fired the 8 s fallback.)
    const graceful = vi.fn(async () => {
      throw new Error("integration blew up");
    });
    const controller = createShutdownController({ exit, timeoutMs: 10 * 60_000 });
    controller.setGraceful(graceful, logger as unknown as Logger);

    controller.handle("SIGTERM");
    await vi.advanceTimersByTimeAsync(1); // 1 ms, the watchdog is 10 min away

    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("survives a sequence that throws SYNCHRONOUSLY", async () => {
    // The declared contract returns a promise, but a synchronous throw would
    // escape the signal listener into uncaughtException and exit 1.
    const graceful = vi.fn(() => {
      throw new Error("threw before returning a promise");
    }) as unknown as () => Promise<void>;
    const controller = createShutdownController({ exit, timeoutMs: 10 * 60_000 });
    controller.setGraceful(graceful, logger as unknown as Logger);

    expect(() => controller.handle("SIGTERM")).not.toThrow();
    await vi.advanceTimersByTimeAsync(1); // 1 ms, the watchdog is 10 min away

    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("exits exactly once on the happy path", async () => {
    // Pins clearTimeout: without it the watchdog fires later and exits again.
    const graceful = vi.fn(async () => {});
    const controller = createShutdownController({ exit, timeoutMs: 500 });
    controller.setGraceful(graceful, logger as unknown as Logger);

    controller.handle("SIGTERM");
    await vi.runAllTimersAsync();

    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("logs a signal received during boot instead of exiting silently", () => {
    // Boot emits dozens of lines before the graceful sequence exists; a silent
    // exit there is indistinguishable from a crash.
    const controller = createShutdownController({ exit });
    controller.setLogger(logger as unknown as Logger);

    controller.handle("SIGINT");

    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ signal: "SIGINT" }),
      expect.stringContaining("boot"),
    );
  });

  it("defaults to a timeout inside Docker's 10 s stop grace period", () => {
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000);
  });
});

describe("createShutdownController — install()", () => {
  let exit: ReturnType<typeof vi.fn<(code: number) => void>>;
  let before: { int: number; term: number };

  beforeEach(() => {
    exit = vi.fn<(code: number) => void>();
    before = {
      int: process.listenerCount("SIGINT"),
      term: process.listenerCount("SIGTERM"),
    };
  });

  afterEach(() => {
    // Leave the runner's own handlers alone: drop only what this test added.
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      const added = process.listenerCount(sig) - (sig === "SIGINT" ? before.int : before.term);
      const listeners = process.listeners(sig);
      for (let i = 0; i < added; i += 1) {
        process.removeListener(sig, listeners[listeners.length - 1 - i]);
      }
    }
  });

  it("registers exactly ONE listener per signal", () => {
    // The bug this whole module exists for: two sites each registered their
    // own handler, and Node ran them in registration order so the first won.
    createShutdownController({ exit }).install();

    expect(process.listenerCount("SIGINT")).toBe(before.int + 1);
    expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
  });

  it("routes a real emitted signal to handle()", () => {
    createShutdownController({ exit }).install();

    process.emit("SIGTERM");

    expect(exit).toHaveBeenCalledWith(0);
  });
});
