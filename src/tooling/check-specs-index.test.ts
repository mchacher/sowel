import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Issue #872 — scripts/check-specs-index.sh is a shell gate, not part of the
// TS build, but the backend suite is the only place vitest looks
// (`src/**/*.test.ts`), so its test lives here. Each case builds a throwaway
// repository layout (specs/ + docs/) and runs the REAL script against it with
// that directory as cwd, which is exactly how CI invokes it.

const SCRIPT = resolve(import.meta.dirname, "../../scripts/check-specs-index.sh");
const REPO = resolve(import.meta.dirname, "../..");

function run(cwd: string, mode?: string): { status: number; out: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...(mode ? [mode] : [])], {
      cwd,
      encoding: "utf-8",
      // Keep the usage line of the unknown-mode case out of the vitest output.
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out: stdout };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const HEADER = "| #   | Title | Status | Summary |\n| --- | ----- | ------ | ------- |\n";

function row(num: string, summary = "Shipped."): string {
  return `| ${num} | Something | ✅     | ${summary} |\n`;
}

describe("scripts/check-specs-index.sh (spec 167 R4, issue #872)", () => {
  let dir: string;

  function seed(opts: { specs: string[]; en: string; fr: string; notes?: string }): void {
    for (const slug of opts.specs) {
      mkdirSync(join(dir, "specs", slug), { recursive: true });
    }
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "specs-index.md"), opts.en);
    writeFileSync(join(dir, "docs", "specs-index.fr.md"), opts.fr);
    writeFileSync(join(dir, "docs", "release-notes.md"), opts.notes ?? "");
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "specs-index-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes when every spec folder has a row in both indexes", () => {
    seed({
      specs: ["175-a-thing", "176-another"],
      en: HEADER + row("175") + row("176"),
      fr: HEADER + row("175") + row("176"),
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(0);
    expect(res.out).toContain("Every spec folder has a row in both indexes");
  });

  it("fails the pull request when a spec folder has no row, naming the file and the row to add", () => {
    seed({
      specs: ["175-a-thing", "176-another"],
      en: HEADER + row("175") + row("176"),
      fr: HEADER + row("175"),
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(1);
    expect(res.out).toContain("docs/specs-index.fr.md has no row for");
    expect(res.out).toContain("| 176 | <titre> |");
    expect(res.out).toContain("`specs/176-another/`");
    // The English index is complete, so it must not be reported.
    expect(res.out).not.toContain("docs/specs-index.md has no row");
  });

  it("suggests the English wording for the English index", () => {
    seed({
      specs: ["175-a-thing"],
      en: HEADER,
      fr: HEADER + row("175"),
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(1);
    expect(res.out).toContain("| 175 | <title> |");
    expect(res.out).toContain("Shipped. See `specs/175-a-thing/`.");
  });

  it("catches a row pasted twice, which a per-folder grep cannot see", () => {
    seed({
      specs: ["175-a-thing"],
      en: HEADER + row("175"),
      fr: HEADER + row("175") + row("175"),
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(1);
    expect(res.out).toContain("docs/specs-index.fr.md lists the same spec more than once: 175");
  });

  it("does not block a tag on a missing row — that is the pull request's job", () => {
    seed({
      specs: ["175-a-thing", "176-another"],
      en: HEADER + row("175"),
      fr: HEADER,
    });

    const res = run(dir, "released");

    expect(res.status).toBe(0);
    expect(res.out).toContain("No shipped spec reads Unreleased");
  });

  it("still refuses a tag whose index claims a shipped spec is unreleased", () => {
    seed({
      specs: ["175-a-thing"],
      en: HEADER + row("175", "Unreleased."),
      fr: HEADER + row("175", "Unreleased."),
      notes: "### v1.67.0\n\n- Spec 175 shipped the thing.\n",
    });

    const res = run(dir, "released");

    expect(res.status).toBe(1);
    expect(res.out).toContain("still marked Unreleased");
    expect(res.out).toContain("175");
  });

  it("keeps working as a local one-shot covering both assertions", () => {
    seed({
      specs: ["175-a-thing", "176-another"],
      en: HEADER + row("175", "Unreleased."),
      fr: HEADER + row("175", "Unreleased."),
      notes: "### v1.67.0\n\n- Spec 175 shipped the thing.\n",
    });

    const res = run(dir);

    expect(res.status).toBe(1);
    expect(res.out).toContain("has no row for");
    expect(res.out).toContain("still marked Unreleased");
  });

  it("reports an empty index instead of dying on its own pipeline", () => {
    // grep exits 1 on an index with no rows, and `set -euo pipefail` turned
    // that into an exit with no output at all: a red gate nobody could read.
    seed({
      specs: ["175-a-thing"],
      en: HEADER,
      fr: HEADER,
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(1);
    expect(res.out).toContain("docs/specs-index.md has no row for");
    expect(res.out).toContain("docs/specs-index.fr.md has no row for");
    expect(res.out).toContain("Add the missing rows to BOTH indexes");
  });

  it("sees a spec number carrying a letter suffix (048a, 048b)", () => {
    seed({
      specs: ["048a-first-half", "048b-second-half"],
      en: HEADER + row("048a") + row("048b"),
      fr: HEADER + row("048a") + row("048b") + row("048b"),
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(1);
    expect(res.out).toContain("docs/specs-index.fr.md lists the same spec more than once: 048b");
  });

  it("ignores a folder that is not a spec rather than inviting a nonsense row", () => {
    mkdirSync(join(dir, "specs", "archive"), { recursive: true });
    seed({
      specs: ["175-a-thing"],
      en: HEADER + row("175"),
      fr: HEADER + row("175"),
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(0);
    expect(res.out).not.toContain("archive");
  });

  it("does not fail the pull request over a status only the release can settle", () => {
    seed({
      specs: ["175-a-thing"],
      en: HEADER + row("175", "Unreleased."),
      fr: HEADER + row("175", "Unreleased."),
      notes: "### v1.67.0\n\n- Spec 175 shipped the thing.\n",
    });

    const res = run(dir, "folders");

    expect(res.status).toBe(0);
  });

  it("says where it is when run from the wrong directory", () => {
    seed({ specs: [], en: HEADER, fr: HEADER });

    const res = run(join(dir, "docs"), "folders");

    expect(res.status).toBe(1);
    expect(res.out).toContain("run this from the repository root");
  });

  it("rejects an unknown mode rather than silently checking nothing", () => {
    seed({ specs: [], en: HEADER, fr: HEADER });

    const res = run(dir, "bogus");

    expect(res.status).toBe(2);
    expect(res.out).toContain("usage:");
  });

  it("holds on the repository itself", () => {
    const res = run(REPO, "folders");

    expect(res.out).toContain("Every spec folder has a row in both indexes");
    expect(res.status).toBe(0);
  });
});
