import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  CHUNK_RELOAD_WINDOW_MS,
  importWithReload,
  lazyPage,
  type ChunkReloadDeps,
} from "./lazy-page";

// #1187 — pages are lazy-loaded; a chunk that vanished with an update must
// reload the tab once, never loop.

function memoryDeps(now = 1_000_000): ChunkReloadDeps & {
  reload: Mock<() => void>;
  clock: { t: number };
} {
  const m = new Map<string, string>();
  const clock = { t: now };
  return {
    storage: {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
    },
    reload: vi.fn<() => void>(),
    now: () => clock.t,
    clock,
  };
}

const chunkError = () => new TypeError("Failed to fetch dynamically imported module");

describe("importWithReload", () => {
  it("passes a successful import through, without reloading", async () => {
    const deps = memoryDeps();
    await expect(importWithReload(() => Promise.resolve("module"), deps)).resolves.toBe("module");
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("reloads once when a chunk fails, and leaves the promise pending", async () => {
    const deps = memoryDeps();
    let settled = false;
    void importWithReload(() => Promise.reject(chunkError()), deps).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
  });

  it("rethrows instead of reloading again inside the window", async () => {
    const deps = memoryDeps();
    void importWithReload(() => Promise.reject(chunkError()), deps);
    await new Promise((r) => setTimeout(r, 0));
    // The page reloaded and the chunk is still missing: show the error.
    deps.clock.t += CHUNK_RELOAD_WINDOW_MS - 1;
    await expect(importWithReload(() => Promise.reject(chunkError()), deps)).rejects.toThrow(
      /dynamically imported/,
    );
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again for a later update, once the window has passed", async () => {
    const deps = memoryDeps();
    void importWithReload(() => Promise.reject(chunkError()), deps);
    await new Promise((r) => setTimeout(r, 0));
    deps.clock.t += CHUNK_RELOAD_WINDOW_MS + 1;
    void importWithReload(() => Promise.reject(chunkError()), deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.reload).toHaveBeenCalledTimes(2);
  });

  it("rethrows rather than risk a loop when storage is blocked", async () => {
    const deps = memoryDeps();
    deps.storage.getItem = () => {
      throw new Error("SecurityError");
    };
    await expect(importWithReload(() => Promise.reject(chunkError()), deps)).rejects.toThrow(
      /dynamically imported/,
    );
    expect(deps.reload).not.toHaveBeenCalled();
  });
});

describe("lazyPage", () => {
  it("renders the module's named export once it arrives", async () => {
    const Page = lazyPage(
      () => Promise.resolve({ LogsPage: () => <p>logs page</p>, Other: () => <p>other</p> }),
      "LogsPage",
    );
    render(
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>,
    );
    expect(await screen.findByText("logs page")).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
  });
});
