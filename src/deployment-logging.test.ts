import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Guard for the deployment logging safety net. These are compose-only settings
// (no Sowel runtime path exercises them), yet a missing json-file cap or a
// re-verbose InfluxDB is a disk-exhaustion outage path — the exact failure that
// took the stack down for 2h20 (see docs/technical/deployment.md "Docker log
// size"). Lock the config here so it cannot silently regress.
//
//   #512 — cap every container's json-file log at max-size 10m / max-file 3.
//   #516 — quiet InfluxDB stdout at the source with INFLUXD_LOG_LEVEL.

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.dev.yml"];

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

/** The `influxdb:` service block (influxdb is the last service, before `volumes:`). */
function influxBlock(text: string): string {
  const start = text.indexOf("\n  influxdb:");
  expect(start, "influxdb service present").toBeGreaterThanOrEqual(0);
  const rest = text.slice(start);
  const end = rest.indexOf("\nvolumes:");
  return end >= 0 ? rest.slice(0, end) : rest;
}

describe("deployment compose logging safety net", () => {
  for (const file of COMPOSE_FILES) {
    describe(file, () => {
      const text = read(file);

      it("caps each container's json-file log (10m x 3, #512)", () => {
        // Both services (sowel + influxdb) declare the cap → two logging blocks.
        expect(text.match(/driver:\s*json-file/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(text.match(/max-size:\s*"10m"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(text.match(/max-file:\s*"3"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      });

      it("quiets InfluxDB stdout at the source (INFLUXD_LOG_LEVEL, #516)", () => {
        expect(influxBlock(text)).toMatch(/INFLUXD_LOG_LEVEL=warn/);
      });
    });
  }
});
