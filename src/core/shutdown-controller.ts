import type { Logger } from "./logger.js";

/**
 * Issue #696 — one signal handler for the whole process lifetime.
 *
 * The engine needs two different shutdown behaviours depending on how far boot
 * has got, and the previous code expressed that by registering two separate
 * listeners: an immediate `process.exit(0)` at the top of `main()`, and the
 * graceful sequence ~700 lines later. Node runs signal listeners in
 * REGISTRATION ORDER, so the first one always won and the graceful sequence was
 * dead code — integrations were never stopped, the database was never closed,
 * and the InfluxDB write buffer was dropped on every container restart.
 *
 * A controller fixes that by inverting the relationship: exactly one listener
 * is registered, at the top of boot, and it dispatches to whichever behaviour
 * is currently installed. Boot stays killable, and the graceful sequence takes
 * over the moment it exists.
 */

/** Docker's default stop grace period is 10 s; finish inside it. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8000;

export interface ShutdownControllerOptions {
  /** Injected so tests do not terminate the runner. */
  exit?: (code: number) => void;
  /** How long the graceful sequence may run before it is cut short. */
  timeoutMs?: number;
}

export interface ShutdownController {
  /**
   * Register the SIGINT/SIGTERM listeners. Owning the registration here is
   * what makes the bug class testable: a test can assert there is exactly ONE
   * listener per signal, which is precisely what went wrong when two separate
   * sites each registered their own.
   */
  install(): void;
  /**
   * What the listeners call. Exposed so a restart path can reuse the same
   * sequence rather than calling `process.exit` behind the controller's back.
   */
  handle(signal: string): void;
  /**
   * Give the controller a logger as soon as one exists, well before the
   * graceful sequence does. Without it a signal during boot exits silently,
   * which reads exactly like a crash.
   */
  setLogger(logger: Logger): void;
  /**
   * Upgrade from "exit immediately" to the real sequence. Called once boot has
   * produced something worth shutting down cleanly.
   */
  setGraceful(fn: () => Promise<void>, logger: Logger): void;
}

export function createShutdownController(
  options: ShutdownControllerOptions = {},
): ShutdownController {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  let graceful: (() => Promise<void>) | null = null;
  let logger: Logger | null = null;
  let running = false;

  const controller: ShutdownController = {
    install(): void {
      process.on("SIGINT", () => controller.handle("SIGINT"));
      process.on("SIGTERM", () => controller.handle("SIGTERM"));
    },

    setLogger(log: Logger): void {
      logger = log.child({ module: "shutdown" });
    },

    setGraceful(fn: () => Promise<void>, log: Logger): void {
      graceful = fn;
      logger = log.child({ module: "shutdown" });
    },

    handle(signal: string): void {
      // Boot has not finished: nothing to unwind, and a startup hang must stay
      // killable. Logged when a logger already exists — boot emits dozens of
      // lines before the graceful sequence is installed, so a silent exit
      // there would be indistinguishable from a crash.
      if (!graceful) {
        logger?.info({ signal }, "Signal during boot, exiting");
        exit(0);
        return;
      }

      // A second signal while the sequence runs means the operator is done
      // waiting. Exit 0 rather than a failure code: an interrupted stop is not
      // a crash, and a non-zero code can trip a container restart policy.
      if (running) {
        logger?.warn({ signal }, "Second signal during shutdown, exiting now");
        exit(0);
        return;
      }

      running = true;
      logger?.info({ signal }, "Signal received, shutting down");

      // A hung step must never hold the process past the container's grace
      // period, or the runtime turns a clean stop into a SIGKILL.
      const timer = setTimeout(() => {
        logger?.warn({ timeoutMs }, "Shutdown timed out, exiting now");
        exit(0);
      }, timeoutMs);
      timer.unref?.();

      // Wrapped rather than called directly: the contract is `() => Promise`,
      // but a synchronous throw would escape the signal listener entirely and
      // surface as an uncaughtException, exiting 1 instead of taking this path
      // at all.
      void Promise.resolve()
        .then(() => graceful?.())
        .catch((err: unknown) => {
          // Load-bearing rather than decorative: the tail of the sequence (the
          // final log flush) is outside any try/catch, so without this a throw
          // would leave the process hanging until the watchdog fires.
          logger?.error({ err }, "Shutdown sequence failed");
        })
        .finally(() => {
          clearTimeout(timer);
          exit(0);
        });
    },
  };

  return controller;
}
