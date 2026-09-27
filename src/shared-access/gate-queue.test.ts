import { describe, it, expect } from "vitest";
import { GateQueue, GateQueueClosedError, DOUBLE_PRESS_MS } from "./gate-queue.js";

describe("per-gate queue and double press (R4.14)", () => {
  it("counts two presses of the same key within two seconds as one", () => {
    const q = new GateQueue();
    expect(q.acceptPress("a:g", 0)).toBe(true);
    expect(q.acceptPress("a:g", DOUBLE_PRESS_MS - 1)).toBe(false);
    expect(q.acceptPress("b:g", 10)).toBe(true);
    expect(q.acceptPress("a:g", DOUBLE_PRESS_MS + 5)).toBe(true);
  });

  it("runs presses on one gate one after the other, and other gates alongside", async () => {
    const q = new GateQueue();
    const log: string[] = [];
    let release!: () => void;
    const first = q.run(
      "g1",
      () => new Promise<void>((r) => (release = () => (log.push("g1-a"), r()))),
    );
    const second = q.run("g1", async () => void log.push("g1-b"));
    const other = q.run("g2", async () => void log.push("g2"));
    await other;
    expect(log).toEqual(["g2"]);
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(["g2", "g1-a", "g1-b"]);
  });

  it("refuses the presses still waiting at shutdown, and any new one", async () => {
    const q = new GateQueue();
    let release!: () => void;
    const running = q.run("g1", () => new Promise<void>((r) => (release = r)));
    const waiting = q.run("g1", async () => "never");
    q.close();
    await expect(waiting).rejects.toBeInstanceOf(GateQueueClosedError);
    await expect(q.run("g1", async () => 1)).rejects.toBeInstanceOf(GateQueueClosedError);
    release();
    await running;
  });
});
