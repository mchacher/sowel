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
 * Every `run:` line in the file, whether it introduces a block scalar or a
 * one-liner, and whether or not it is the first key of a compact sequence
 * entry (`- run: npm ci`). Block bodies are found by indentation: the body is
 * the run of lines indented deeper than the `run:` key itself.
 *
 * The compact-sequence form is the one that matters. An earlier version of
 * this parser anchored on `^\s*run:`, which cannot match a leading `-`, so it
 * silently skipped `- run: npm ci` and would have kept passing had someone
 * later written `- run: echo "${{ inputs.test_tag }}"`. A scanner that misses
 * a shape is worse than no scanner, because it reads as coverage.
 */
function runLines(source = workflow): { line: number; body: string }[] {
  const lines = source.split("\n");
  const blocks: { line: number; body: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    // `- run:` counts the dash and its spacing as indentation, which is what
    // YAML itself does for the keys of a compact sequence entry.
    const block = /^(\s*(?:-\s+)?)run: [|>][+-]?\d*\s*$/.exec(lines[i]);
    if (block) {
      const indent = block[1].length;
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
    const single = /^\s*(?:-\s+)?run: (?![|>])(.+)$/.exec(lines[i]);
    if (single) blocks.push({ line: i + 1, body: single[1] });
  }
  return blocks;
}

/** Every line that opens a `run:` script, however it is written. */
function countRunKeys(source = workflow): number {
  return source.split("\n").filter((l) => /^\s*(?:-\s+)?run:/.test(l)).length;
}

describe("release.yml: the GitHub Release is gated on a multi-arch manifest (#764)", () => {
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

  it("does not publish a Release for a tag that was merely dispatched", () => {
    // The "Run workflow" dropdown accepts a tag as its ref. On that path every
    // Resolve version step takes the workflow_dispatch branch and builds only
    // :<test_tag>, so a Release created under the tag's own version would name
    // a version that has no images anywhere, and UpdateChecker would announce
    // it to the fleet.
    expect(jobCondition("release")).toContain("github.event_name == 'push'");
  });

  it("turns the run red when the release was withheld", () => {
    // continue-on-error on the arm64 build means an arm64 failure otherwise
    // produces a green run with a merely grey release job, and GitHub notifies
    // on red runs, not on skipped ones.
    expect(workflow).toContain("  arm64-required:");
    const start = workflow.indexOf("  arm64-required:");
    const job = workflow.slice(start, workflow.indexOf("  prune-ghcr:"));
    expect(job).toContain("needs.docker-arm64.result");
    expect(job).toContain("exit 1");
    expect(jobCondition("arm64-required")).toContain("github.event_name == 'push'");
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
    // `:latest-arm64` is out of scope: it is a per-arch convenience tag, not
    // the tag docker-compose.yml pulls. The lookahead is exercised against a
    // fixture rather than against the live file, so removing that now-unused
    // push (nothing consumes it since :latest stopped being merged from the
    // per-arch tags) does not have to come back through this test.
    const latestTag = /REPO\}:latest(?![-\w])/;
    expect('docker buildx imagetools create --tag "${REPO}:latest-arm64"').not.toMatch(latestTag);
    expect('tags="${REPO}:latest"').toMatch(latestTag);
    expect(buildJobs).not.toMatch(latestTag);
  });
});

describe("release.yml: no workflow expression is interpolated into a shell script (#638)", () => {
  it("routes every ${{ }} value through env: instead of the run: body", () => {
    // `${{ inputs.test_tag }}` expanded straight into `run:` is a command
    // injection: the value is substituted before the shell ever sees it, so
    // quoting in the script cannot help. Only actors with workflow-dispatch
    // rights can set it, which bounds the severity but not the shape.
    const offenders = runLines()
      .filter((b) => b.body.includes("${{"))
      .map((b) => `line ${b.line}`);
    expect(offenders).toEqual([]);
  });

  it("scans every run: in the file, so the assertion above cannot pass by blindness", () => {
    // Self-calibrating rather than a hand-set lower bound: a shape the parser
    // cannot see still shows up as a `run:` line, so the two counts diverge.
    expect(runLines().length).toBe(countRunKeys());
    expect(countRunKeys()).toBeGreaterThan(6); // sanity: we read the real file
  });

  it("sees the shapes a hand-rolled YAML scanner usually misses", () => {
    const fixture = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - run: echo ${{ inputs.compact_oneliner }}",
      "      - run: |",
      "          echo ${{ inputs.compact_block }}",
      "      - name: keyed",
      "        run: |2",
      "          echo ${{ inputs.indent_indicator }}",
      "      - name: chomped",
      "        run: |+",
      "          echo ${{ inputs.keep_chomping }}",
      "      - name: folded",
      "        run: >-",
      "          echo ${{ inputs.folded }}",
      "",
    ].join("\n");

    const found = runLines(fixture);
    expect(found).toHaveLength(countRunKeys(fixture));
    expect(found).toHaveLength(5);
    // Every one of them carries an interpolation, so a parser that saw them
    // all reports five offenders and a parser with a hole reports fewer.
    expect(found.filter((b) => b.body.includes("${{"))).toHaveLength(5);
  });
});

describe("release.yml: a resolved version is always a valid image tag", () => {
  it("refuses a version carrying a newline or a space", () => {
    // The value reaches an unquoted ${REPO}:${V} and is written to
    // GITHUB_OUTPUT one line at a time, so a newline in a dispatched test_tag
    // injects a second output key and a space word-splits into extra CLI
    // arguments. Routing through env: stops the shell from re-evaluating the
    // value; it does not stop either of those.
    const guards = workflow.match(/\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\*\$/g) ?? [];
    // One per "Resolve version" step: docker, docker-arm64, promote-manifest.
    expect(guards).toHaveLength(3);
    const rejects = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
    expect(rejects.test("1.62.0")).toBe(true);
    expect(rejects.test("ci-test")).toBe(true);
    expect(rejects.test("ci-test\nis_release=true")).toBe(false);
    expect(rejects.test("ci test")).toBe(false);
    expect(rejects.test("-leading-dash")).toBe(false);
  });
});

describe("release.yml: least privilege on the release token (#638)", () => {
  it("gives the amd64 docker job packages:write but not contents:write", () => {
    const start = workflow.indexOf("  docker:\n");
    expect(start).toBeGreaterThan(-1);
    const job = workflow.slice(start, workflow.indexOf("  docker-arm64:"));
    expect(job).toContain("packages: write");
    // The job pushes images; it creates no tag, release or commit.
    expect(job).not.toContain("contents: write");
  });
});

describe("release.yml: supply chain", () => {
  it("pins every third-party action to a commit", () => {
    // A moving tag is a promise the publisher can rewrite. Pinning gives up
    // automatic patch updates, which is why dependabot's github-actions
    // ecosystem is configured: it proposes the new commit and the diff shows
    // what moved.
    const thirdParty = [...workflow.matchAll(/uses: ((?!actions\/)[\w.-]+\/[\w.-]+)@(\S+)/g)];
    expect(thirdParty.length).toBeGreaterThan(0);
    for (const [, action, ref] of thirdParty) {
      expect(ref, `${action} is not pinned to a commit`).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("keeps the human-readable tag beside each pin", () => {
    // A bare 40-character hash tells a reader nothing about which version they
    // are on, and a reviewer cannot tell an upgrade from a downgrade.
    for (const line of workflow.split("\n")) {
      if (/uses: (?!actions\/)[\w.-]+\/[\w.-]+@[0-9a-f]{40}/.test(line)) {
        expect(line, `no version comment: ${line.trim()}`).toMatch(/#\s*v?\d/);
      }
    }
  });

  it("gives every job an explicit permissions block", () => {
    // Without one a job inherits the repository default, which is often write.
    const jobs = [...workflow.matchAll(/\n {2}([a-z0-9-]+):\n/g)].map((m) => m[1]);
    expect(jobs.length).toBeGreaterThan(5);
    for (const job of jobs) {
      const start = workflow.indexOf(`\n  ${job}:\n`);
      const next = workflow.indexOf("\n  ", workflow.indexOf("steps:", start));
      const block = workflow.slice(start, next === -1 ? undefined : next);
      expect(block, `job ${job} has no permissions block`).toMatch(/\n {4}permissions:/);
    }
  });
});
