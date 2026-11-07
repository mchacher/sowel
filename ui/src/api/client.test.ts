import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, fetchJSON, fetchPublic } from "./client";

// Spec 196, slice 2b — the client used to throw a bare Error carrying only the server's
// text, so a caller could not tell a 429 from a 404. The status now travels with it,
// and the message is unchanged for every caller that reads `err.message`.

function respond(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), { status, statusText, headers: { "retry-after": "0" } });
}

describe("fetchJSON errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws an ApiError with the status and the server's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(404, { error: "Equipment not found" })));
    const err = await fetchJSON("/api/v1/equipments/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("Equipment not found");
  });

  it("still retries a rate-limited read once, then reports the 429", async () => {
    const fetchMock = vi.fn(async () => respond(429, {}, "Too Many Requests"));
    vi.stubGlobal("fetch", fetchMock);
    const err = await fetchJSON("/api/v1/equipments/x").catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).message).toBe("HTTP 429: Too Many Requests");
  });

  it("reports a request that got no answer as status 0, message unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await fetchPublic("/api/v1/auth/status").catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toBe("Failed to fetch");
  });

  it("lets a caller's abort through untouched", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(abort)));
    await expect(fetchJSON("/api/v1/zones")).rejects.toBe(abort);
  });
});
