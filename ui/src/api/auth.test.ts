import { describe, it, expect, vi, afterEach } from "vitest";
import { changeMyPassword } from "./auth";

// Issue #1305 — the server ends every other session on a password change.
// The browser that made the change sends its own refresh token so it stays in.

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("changeMyPassword", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends this browser's refresh token so this session survives", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetchMock);
    await changeMyPassword("old", "new-password", "rt-me");
    expect(sentBody(fetchMock)).toEqual({
      currentPassword: "old",
      newPassword: "new-password",
      refreshToken: "rt-me",
    });
  });

  it("omits the field when there is no stored refresh token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetchMock);
    await changeMyPassword("old", "new-password", null);
    expect(sentBody(fetchMock)).toEqual({ currentPassword: "old", newPassword: "new-password" });
  });
});
