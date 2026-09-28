// ============================================================
// Spec 181 — presses queue per gate, and a double press is one press (R4.14)
//
// An impulse gate is a toggle: two commands a second apart open it and stop it
// again. So presses reaching one gate run one after the other, never together,
// and two presses of the same access on the same gate within two seconds — a
// thumb that bounced, a page that retried — are one.
//
// A gate whose integration never answers must not hold every later press with
// its request open: a press gives up after ORDER_TIMEOUT_MS, and past
// MAX_WAITING presses waiting on one gate, a new one is refused at once.
// ============================================================

export const DOUBLE_PRESS_MS = 2000;
export const ORDER_TIMEOUT_MS = 15_000;
export const MAX_WAITING = 5;

export class GateQueueClosedError extends Error {
  constructor() {
    super("Gate queue closed");
    this.name = "GateQueueClosedError";
  }
}

/** The gate did not answer in time; the queue has moved on. */
export class GateTimeoutError extends Error {
  constructor() {
    super("The gate did not answer in time");
    this.name = "GateTimeoutError";
  }
}

/** Too many presses already wait on this gate. */
export class GateBusyError extends Error {
  constructor() {
    super("Too many presses waiting on this gate");
    this.name = "GateBusyError";
  }
}

interface Task {
  run: () => Promise<void>;
  cancel: () => void;
}

export class GateQueue {
  private readonly queues = new Map<string, Task[]>();
  private readonly running = new Set<string>();
  private readonly lastPress = new Map<string, number>();
  private closed = false;

  constructor(
    private readonly timeoutMs = ORDER_TIMEOUT_MS,
    private readonly maxWaiting = MAX_WAITING,
  ) {}

  /** True, and remembered, unless the same key pressed within the window. */
  acceptPress(key: string, now: number): boolean {
    const last = this.lastPress.get(key);
    if (last !== undefined && now - last < DOUBLE_PRESS_MS) return false;
    this.lastPress.set(key, now);
    if (this.lastPress.size > 1000) {
      for (const [k, t] of this.lastPress) if (now - t >= DOUBLE_PRESS_MS) this.lastPress.delete(k);
    }
    return true;
  }

  /**
   * Run `fn` once every earlier press on this gate has finished, or given up:
   * a task still running after the timeout is abandoned (rejected with
   * GateTimeoutError) and the next one starts.
   */
  run<T>(gateId: string, fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new GateQueueClosedError());
    if ((this.queues.get(gateId)?.length ?? 0) >= this.maxWaiting) {
      return Promise.reject(new GateBusyError());
    }
    return new Promise<T>((resolve, reject) => {
      const task: Task = {
        run: async () => {
          let timer: NodeJS.Timeout | undefined;
          const timeout = new Promise<never>((_, fail) => {
            timer = setTimeout(() => fail(new GateTimeoutError()), this.timeoutMs);
          });
          try {
            resolve(await Promise.race([fn(), timeout]));
          } catch (err) {
            reject(err as Error);
          } finally {
            clearTimeout(timer);
          }
        },
        cancel: () => reject(new GateQueueClosedError()),
      };
      const queue = this.queues.get(gateId) ?? [];
      queue.push(task);
      this.queues.set(gateId, queue);
      void this.drain(gateId);
    });
  }

  /** Shutdown: presses still waiting are refused; none is started. */
  close(): void {
    this.closed = true;
    for (const queue of this.queues.values()) for (const task of queue.splice(0)) task.cancel();
    this.queues.clear();
  }

  private async drain(gateId: string): Promise<void> {
    if (this.running.has(gateId)) return;
    this.running.add(gateId);
    try {
      const queue = this.queues.get(gateId);
      while (queue && queue.length > 0 && !this.closed) {
        const task = queue.shift()!;
        await task.run();
      }
    } finally {
      this.running.delete(gateId);
      if (this.queues.get(gateId)?.length === 0) this.queues.delete(gateId);
    }
  }
}
