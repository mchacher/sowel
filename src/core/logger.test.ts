import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTransportOptions } from "./logger.js";

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
