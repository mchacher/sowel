import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Guard for the engine's shutdown sequence (#792).
//
// `EquipmentStatusTracker` was constructed and started in index.ts but never
// destroyed on shutdown. Its own `destroy()` was correct and unit-tested, so no
// test on the class could have caught this: the defect lived in the wiring, in
// the one file that has no test of its own because it is the composition root.
//
// The failure it produced: shutdown is not instant (it awaits the MQTT
// publisher, InfluxDB, the HTTP server, and a per-plugin stop race), and while
// a subsystem stays subscribed to the event bus, live device traffic keeps
// arming work. A 200ms debounce armed just before `db.close()` fires just
// after, and `recompute()` throws "The database connection is not open" on a
// closed connection. Latent since v1.14.0, reachable only since v1.55.0, when
// #696 made the graceful shutdown actually run.
//
// So this asserts the property rather than the instance: anything index.ts
// constructs that owns a `stop()`/`destroy()` must be stopped in `shutdown()`,
// before `db.close()`. Adding a new tracker and forgetting the teardown fails
// here instead of in production.

const INDEX = "src/index.ts";

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

/** The body of the `shutdown` arrow function, up to the end of the file. */
function shutdownBody(src: string): string {
  const start = src.indexOf("const shutdown = async () =>");
  expect(start, "shutdown() is defined in index.ts").toBeGreaterThanOrEqual(0);
  return src.slice(start);
}

/** `const foo = new Bar(` pairs, i.e. every subsystem the composition root owns. */
function constructedSubsystems(src: string): { variable: string; className: string }[] {
  return [...src.matchAll(/const (\w+) = new (\w+)\(/g)].map((m) => ({
    variable: m[1],
    className: m[2],
  }));
}

/** Resolve a class imported from a relative path to its source file, if local. */
function sourceFileFor(src: string, className: string): string | null {
  const imports = [...src.matchAll(/import \{([^}]+)\} from "([^"]+)"/g)];
  for (const [, names, path] of imports) {
    const exported = names.split(",").map((n) => n.trim().replace(/^type /, ""));
    if (!exported.includes(className)) continue;
    if (!path.startsWith(".")) return null;
    const file = "src/" + path.replace(/^\.\.?\//, "").replace(/\.js$/, ".ts");
    return existsSync(resolve(process.cwd(), file)) ? file : null;
  }
  return null;
}

/** True when the class declares a no-arg teardown method. */
function hasTeardown(file: string): boolean {
  return /\n {2}(async )?(destroy|stop|stopAll)\(\)/.test(read(file));
}

describe("engine shutdown completeness", () => {
  const src = read(INDEX);
  const body = shutdownBody(src);
  const stopped = new Set(
    [...body.matchAll(/(\w+)\.(stop|stopAll|destroy|close|flush|disconnect)\(/g)].map((m) => m[1]),
  );

  it("stops every constructed subsystem that owns a teardown method", () => {
    const missing: string[] = [];
    for (const { variable, className } of constructedSubsystems(src)) {
      const file = sourceFileFor(src, className);
      if (!file || !hasTeardown(file)) continue;
      if (!stopped.has(variable)) missing.push(`${variable} (${className}, ${file})`);
    }
    expect(missing, `not torn down in shutdown(): ${missing.join(", ")}`).toEqual([]);
  });

  it("tears the equipment status tracker down, the #792 regression", () => {
    expect(stopped.has("equipmentStatusTracker")).toBe(true);
  });

  it("closes the database only after every subsystem has been stopped", () => {
    // Ordering is the whole point: a teardown call placed after `db.close()`
    // would satisfy the check above while leaving the crash window open.
    // Match the statement, not the word: the surrounding comments discuss
    // `db.close()` by name and an indexOf would land on one of those.
    const stmt = /^\s*db\.close\(\);\s*$/m.exec(body);
    expect(stmt, "db.close(); is called in shutdown()").not.toBeNull();
    const dbClose = stmt!.index;

    const late: string[] = [];
    for (const match of body.matchAll(/(\w+)\.(stop|stopAll|destroy)\(/g)) {
      if (match.index !== undefined && match.index > dbClose) late.push(match[1]);
    }
    expect(late, `stopped after db.close(): ${late.join(", ")}`).toEqual([]);
  });
});
