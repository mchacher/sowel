import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Guard for the shutdown sequence in src/index.ts. That file runs `main()` as
// a top-level side effect on import, so it cannot be exercised by a normal
// unit test — the only place a wiring omission there can be caught before it
// reaches production is a text check against the source, the same technique
// used in deployment-logging.test.ts for docker-compose.yml.
//
// #792 — EquipmentStatusTracker was created and started but never destroyed
// on shutdown, unlike every sibling tracker. Its debounced/tick timers kept
// firing after `db.close()`, crashing the process with an uncaught exception
// on some restarts (worse case: a Pino worker-thread double-fault logging
// storm). Lock the call here so it cannot silently regress.

const INDEX_TS = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");

/** The body of the `shutdown` closure, between its declaration and the controller hookup. */
function shutdownSequence(text: string): string {
  const start = text.indexOf("const shutdown = async () => {");
  expect(start, "shutdown sequence present").toBeGreaterThanOrEqual(0);
  const rest = text.slice(start);
  const end = rest.indexOf("shutdownController.setGraceful(");
  expect(end, "shutdownController.setGraceful call present").toBeGreaterThan(0);
  return rest.slice(0, end);
}

describe("src/index.ts shutdown sequence", () => {
  const sequence = shutdownSequence(INDEX_TS);

  it("destroys every tracker/service it starts, including equipmentStatusTracker (#792)", () => {
    const destroyedOrStopped = [
      "capacityArbiter.stop()",
      "sunlightManager.stop()",
      "recipeManager.stopAll()",
      "orderConfirmationTracker.destroy()",
      "equipmentStatusTracker.destroy()",
      "batteryMonitor.destroy()",
      "notificationPublishService.destroy()",
      "historyWriter.destroy()",
      "db.close()",
    ];
    for (const call of destroyedOrStopped) {
      expect(sequence, `shutdown sequence calls ${call}`).toContain(call);
    }
  });

  it("stops equipmentStatusTracker before the database connection closes", () => {
    const destroyIndex = sequence.indexOf("equipmentStatusTracker.destroy()");
    const dbCloseIndex = sequence.indexOf("db.close()");
    expect(destroyIndex, "equipmentStatusTracker.destroy() present").toBeGreaterThanOrEqual(0);
    expect(dbCloseIndex, "db.close() present").toBeGreaterThanOrEqual(0);
    expect(destroyIndex).toBeLessThan(dbCloseIndex);
  });
});
