import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Invariants of `.github/workflows/release.yml` that the running engine depends
 * on. They live beside `version-checker.ts` on purpose: the updater polls the
 * GitHub Release rather than the GHCR manifest, so what the workflow publishes
 * and in what order is part of this module's contract, not a detail of CI.
 *
 * Issue #764 is what these guard. The `release` job condition was missing the
 * `promote-manifest` check for months, so an arm64 build failure still created
 * a Release, every Raspberry Pi was told an update was available, and every
 * `docker pull` then failed with no matching manifest. Nothing went red. A
 * workflow file has no type checker and no test runner of its own, so a
 * condition can be loosened in a one-line edit and nothing notices until a
 * release goes out wrong. Assertions on the text are the cheapest thing that
 * would have caught it.
 */

const WORKFLOW_PATH = resolve(import.meta.dirname, "../../.github/workflows/release.yml");
const workflow = readFileSync(WORKFLOW_PATH, "utf-8");

/**
 * Every `run:` script body in the file, with the step it belongs to.
 * YAML block scalars are found by indentation: the body is the run of lines
 * indented deeper than the `run:` key itself.
 */
function runBlocks(): { line: number; body: string }[] {
  const lines = workflow.split("\n");
  const blocks: { line: number; body: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run: (\||>)-?\s*$/.exec(lines[i]);
    if (m) {
      const indent = m[1].length;
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "") {
          body.push(l);
          continue;
        }
        const lead = l.length - l.trimStart().length;
        if (lead <= indent) break;
        body.push(l);
      }
      blocks.push({ line: i + 1, body: body.join("\n") });
      i = j - 1;
      continue;
    }
    // Single-line form: `run: some command`
    const single = /^\s*run: (?!\||>)(.+)$/.exec(lines[i]);
    if (single) blocks.push({ line: i + 1, body: single[1] });
  }
  return blocks;
}

describe("release.yml — the GitHub Release is gated on a multi-arch manifest (#764)", () => {
  function jobCondition(job: string): string {
    // The `if:` on the job itself, i.e. the first `if:` after the job key at
    // job indentation (4 spaces for keys inside a job).
    const start = workflow.indexOf(`\n  ${job}:\n`);
    expect(start, `job ${job} not found`).toBeGreaterThan(-1);
    const rest = workflow.slice(start + 1);
    const m = /\n {4}if: (.+)/.exec(rest.slice(0, rest.indexOf("\n    steps:")));
    expect(m, `job ${job} has no if: condition`).not.toBeNull();
    return m![1];
  }

  it("does not publish the Release when the arm64 build failed", () => {
    const cond = jobCondition("release");
    // Without this term the job runs on `always() && docker == success` alone,
    // which is exactly the #764 defect: promote-manifest is skipped by its own
    // arm64 gate while the Release goes out regardless.
    expect(cond).toContain("needs.promote-manifest.result == 'success'");
  });

  it("keeps promote-manifest itself gated on both architectures", () => {
    const cond = jobCondition("promote-manifest");
    expect(cond).toContain("needs.docker.result == 'success'");
    expect(cond).toContain("needs.docker-arm64.result == 'success'");
  });

  it("publishes :latest only from promote-manifest, never from a single-arch job", () => {
    // A per-arch job pushing :latest leaves the tag single-arch until the
    // manifest is promoted. Short, but it is a real window on every healthy
    // release, and an arm64 host pulling inside it gets no matching manifest.
    // Scoped to the two per-arch build jobs. The `restore-latest` job also
    // writes :latest, but that is the manual recovery path and it repoints the
    // tag at an already-published multi-arch version.
    const buildJobs = workflow.slice(
      workflow.indexOf("  docker:\n"),
      workflow.indexOf("  promote-manifest:"),
    );
    expect(buildJobs.length).toBeGreaterThan(0);
    expect(buildJobs).toContain("packages: write"); // sanity: we sliced the right region
    // `:latest-arm64` is fine: it is a per-arch convenience tag, not the tag
    // docker-compose.yml pulls. The negative lookahead keeps it out of scope.
    expect(buildJobs).not.toMatch(/REPO\}:latest(?![-\w])/);
    expect(buildJobs).toMatch(/REPO\}:latest-arm64/); // sanity: the lookahead is doing work
  });
});

describe("release.yml — no workflow expression is interpolated into a shell script (#638)", () => {
  it("routes every ${{ }} value through env: instead of the run: body", () => {
    // `${{ inputs.test_tag }}` expanded straight into `run:` is a command
    // injection: the value is substituted before the shell ever sees it, so
    // quoting in the script cannot help. Only actors with workflow-dispatch
    // rights can set it, which bounds the severity but not the shape.
    const offenders = runBlocks()
      .filter((b) => b.body.includes("${{"))
      .map((b) => `line ${b.line}`);
    expect(offenders).toEqual([]);
  });

  it("finds the run blocks it claims to scan", () => {
    // A parser that silently matched nothing would make the assertion above
    // pass forever. Pin a lower bound instead of trusting it.
    expect(runBlocks().length).toBeGreaterThanOrEqual(6);
  });
});

describe("release.yml — least privilege on the release token (#638)", () => {
  it("gives the amd64 docker job packages:write but not contents:write", () => {
    const start = workflow.indexOf("  docker:\n");
    expect(start).toBeGreaterThan(-1);
    const job = workflow.slice(start, workflow.indexOf("  docker-arm64:"));
    expect(job).toContain("packages: write");
    // The job pushes images; it creates no tag, release or commit.
    expect(job).not.toContain("contents: write");
  });
});
