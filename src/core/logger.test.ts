import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import pino from "pino";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTransportOptions, purgeLegacyLogFiles } from "./logger.js";

// #400 — one calendar day must map to one predictable log file across restarts.

const DATED_FILE_RE = /^sowel\.\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/;

function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Spin a real pino-roll transport, write one line, close it. */
async function writeOneLine(baseFile: string, message: string): Promise<void> {
  const transport = pino.transport({
    target: "pino-roll",
    options: fileTransportOptions(baseFile),
  });
  const logger = pino(transport);
  logger.info(message);
  await new Promise<void>((resolve, reject) => {
    transport.on("close", resolve);
    transport.on("error", reject);
    // flushSync is unavailable through the worker; end() flushes then closes.
    transport.end();
  });
}

describe("fileTransportOptions", () => {
  it("uses daily frequency with a date-stamped name and cross-process retention", () => {
    const opts = fileTransportOptions();
    expect(opts.file).toBe("data/logs/sowel");
    expect(opts.frequency).toBe("daily");
    expect(opts.dateFormat).toBe("yyyy-MM-dd");
    expect(opts.limit).toEqual({ count: 14, removeOtherLogFiles: true });
    expect(opts.mkdir).toBe(true);
  });
});

describe("pino-roll file naming (integration)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sowel-logger-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("names the active file with the current date", async () => {
    await writeOneLine(join(dir, "sowel"), "hello");

    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(DATED_FILE_RE);
    expect(files[0]).toContain(today());
  });

  it("a restarted process reuses the same day file instead of opening a new number", async () => {
    await writeOneLine(join(dir, "sowel"), "first-process");
    await writeOneLine(join(dir, "sowel"), "second-process");

    const files = readdirSync(dir).filter((f) => DATED_FILE_RE.test(f));
    expect(files.length).toBe(1);

    const content = readFileSync(join(dir, files[0]), "utf-8");
    expect(content).toContain("first-process");
    expect(content).toContain("second-process");
  });

  it("cleanup ignores legacy numbered files and unrelated files", async () => {
    // Legacy pre-#400 file and an unrelated log share the folder.
    writeFileSync(join(dir, "sowel.3.log"), "legacy\n");
    writeFileSync(join(dir, "backfill-rain.log"), "unrelated\n");

    await writeOneLine(join(dir, "sowel"), "current");

    const files = readdirSync(dir);
    expect(files).toContain("sowel.3.log");
    expect(files).toContain("backfill-rain.log");
    expect(files.some((f) => DATED_FILE_RE.test(f))).toBe(true);
  });
});

// #400 follow-up — one-shot purge of pre-date-format files at boot.
describe("purgeLegacyLogFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sowel-legacy-purge-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeSpyLogger() {
    const spy = { info: vi.fn(), warn: vi.fn() };
    return spy;
  }

  function touch(name: string, ageDays: number): void {
    const path = join(dir, name);
    writeFileSync(path, "x\n");
    const t = new Date(Date.now() - ageDays * 24 * 3600_000);
    utimesSync(path, t, t);
  }

  it("removes only legacy-format files older than 14 days", () => {
    touch("sowel.3.log", 20); // legacy, stale → removed
    touch("sowel.11.log", 40); // legacy, stale → removed
    touch("sowel.5.log", 3); // legacy, recent → kept
    touch("sowel.2026-07-01.1.log", 40); // new format → pino-roll's job, kept
    touch("backfill-rain.log", 400); // unrelated → kept

    const spy = makeSpyLogger();
    purgeLegacyLogFiles(spy as never, dir);

    const files = readdirSync(dir).sort();
    expect(files).toEqual(["backfill-rain.log", "sowel.2026-07-01.1.log", "sowel.5.log"]);
    expect(spy.info.mock.calls.length).toBe(1);
    expect(spy.info.mock.calls[0][0]).toMatchObject({ removed: 2 });
  });

  it("stays silent when there is nothing to purge", () => {
    touch("sowel.2026-08-01.1.log", 5);
    const spy = makeSpyLogger();
    purgeLegacyLogFiles(spy as never, dir);
    expect(spy.info.mock.calls.length).toBe(0);
    expect(spy.warn.mock.calls.length).toBe(0);
  });

  it("does not throw on a missing directory", () => {
    const spy = makeSpyLogger();
    expect(() => purgeLegacyLogFiles(spy as never, join(dir, "absent"))).not.toThrow();
  });
});
