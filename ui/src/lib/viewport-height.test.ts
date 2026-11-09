import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Since #1164 the home-screen app on iOS starts below the status bar, so
// 100vh (h-screen) is taller than the page: a full-height layout overflowed
// by the status bar's height and the bottom bar lost its labels. Full-height
// containers use the dynamic viewport (h-dvh, min-h-dvh) instead.
const srcRoot = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("viewport height", () => {
  it("no full-height container uses the whole screen (h-screen, 100vh)", () => {
    const offenders = sources(srcRoot).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((text, i) =>
          /\b(?:min-|max-)?h-screen\b|100vh/.test(text)
            ? [`${path.slice(srcRoot.length)}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
