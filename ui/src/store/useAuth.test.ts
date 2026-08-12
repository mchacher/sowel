import { describe, it, expect, beforeEach, vi } from "vitest";
import type { useAuth as UseAuthStore } from "./useAuth";
import type { AuthTokens, User } from "../types";

// Mock the API layer. The hoisted object is shared with the store under test,
// so each test configures the mock functions it needs.
const api = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  authLogin: vi.fn(),
  authSetup: vi.fn(),
  authRefresh: vi.fn(),
  authLogout: vi.fn(),
  getMe: vi.fn(),
  updateMyPreferences: vi.fn(),
  setAccessToken: vi.fn(),
  setOnUnauthorized: vi.fn(),
}));
vi.mock("../api", () => api);

function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

const USER: User = {
  id: "u1",
  username: "alice",
  displayName: "Alice",
  role: "admin",
  preferences: { language: "fr" },
  enabled: true,
  lastLoginAt: null,
  createdAt: "2026-08-01T00:00:00Z",
};

function tokens(overrides?: Partial<AuthTokens>): AuthTokens {
  return { accessToken: "acc-1", refreshToken: "ref-1", expiresIn: 900, user: USER, ...overrides };
}

const ACCESS_KEY = "sowel_access_token";
const REFRESH_KEY = "sowel_refresh_token";

let useAuth: typeof UseAuthStore;

/** (Re)load the store module with fresh localStorage so each test gets a clean singleton. */
async function loadStore(): Promise<void> {
  vi.resetModules();
  ({ useAuth } = await import("./useAuth"));
}

beforeEach(async () => {
  vi.clearAllMocks();
  globalThis.localStorage = makeStorage();
  await loadStore();
});

describe("useAuth — token bootstrap", () => {
  it("registers a 401 handler on creation", () => {
    expect(api.setOnUnauthorized).toHaveBeenCalledOnce();
  });

  it("restores a persisted access token into the API layer on load", async () => {
    globalThis.localStorage.setItem(ACCESS_KEY, "persisted-token");
    await loadStore();
    expect(api.setAccessToken).toHaveBeenCalledWith("persisted-token");
    expect(useAuth.getState().accessToken).toBe("persisted-token");
  });
});

describe("login", () => {
  it("persists tokens and marks the session authenticated", async () => {
    api.authLogin.mockResolvedValue(tokens());
    await useAuth.getState().login("alice", "pw");

    const s = useAuth.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user).toEqual(USER);
    expect(s.loading).toBe(false);
    expect(localStorage.getItem(ACCESS_KEY)).toBe("acc-1");
    expect(localStorage.getItem(REFRESH_KEY)).toBe("ref-1");
    expect(api.setAccessToken).toHaveBeenCalledWith("acc-1");
  });
});

describe("checkStatus", () => {
  it("flags setup required and does not attempt a session restore", async () => {
    api.getAuthStatus.mockResolvedValue({ setupRequired: true });
    await useAuth.getState().checkStatus();

    const s = useAuth.getState();
    expect(s.setupRequired).toBe(true);
    expect(s.isAuthenticated).toBe(false);
    expect(s.loading).toBe(false);
    expect(api.authRefresh).not.toHaveBeenCalled();
  });

  it("restores a valid session from a stored refresh token", async () => {
    localStorage.setItem(REFRESH_KEY, "ref-1");
    api.getAuthStatus.mockResolvedValue({ setupRequired: false });
    api.authRefresh.mockResolvedValue(tokens({ accessToken: "acc-2" }));

    await useAuth.getState().checkStatus();

    const s = useAuth.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user).toEqual(USER);
    expect(localStorage.getItem(ACCESS_KEY)).toBe("acc-2");
  });

  it("ends unauthenticated when there is no stored refresh token", async () => {
    api.getAuthStatus.mockResolvedValue({ setupRequired: false });
    await useAuth.getState().checkStatus();

    const s = useAuth.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.loading).toBe(false);
    expect(api.authRefresh).not.toHaveBeenCalled();
  });

  it("clears loading and setupRequired when the status probe throws", async () => {
    api.getAuthStatus.mockRejectedValue(new Error("network"));
    await useAuth.getState().checkStatus();

    const s = useAuth.getState();
    expect(s.loading).toBe(false);
    expect(s.setupRequired).toBeNull();
  });
});

describe("refreshSession", () => {
  it("returns false without calling the API when no refresh token is stored", async () => {
    const ok = await useAuth.getState().refreshSession();
    expect(ok).toBe(false);
    expect(api.authRefresh).not.toHaveBeenCalled();
  });

  it("rotates tokens and authenticates on success", async () => {
    localStorage.setItem(REFRESH_KEY, "ref-old");
    api.authRefresh.mockResolvedValue(tokens({ accessToken: "acc-new", refreshToken: "ref-new" }));

    const ok = await useAuth.getState().refreshSession();

    expect(ok).toBe(true);
    expect(useAuth.getState().isAuthenticated).toBe(true);
    expect(localStorage.getItem(ACCESS_KEY)).toBe("acc-new");
    expect(localStorage.getItem(REFRESH_KEY)).toBe("ref-new");
  });

  it("clears tokens and de-authenticates when refresh fails", async () => {
    localStorage.setItem(ACCESS_KEY, "acc-old");
    localStorage.setItem(REFRESH_KEY, "ref-old");
    api.authRefresh.mockRejectedValue(new Error("expired"));

    const ok = await useAuth.getState().refreshSession();

    expect(ok).toBe(false);
    const s = useAuth.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(api.setAccessToken).toHaveBeenLastCalledWith(null);
  });
});

describe("401 handler (setOnUnauthorized)", () => {
  it("refreshes on 401 and returns true when refresh succeeds", async () => {
    localStorage.setItem(REFRESH_KEY, "ref-1");
    api.authRefresh.mockResolvedValue(tokens());
    const handler = api.setOnUnauthorized.mock.calls[0][0] as () => Promise<boolean>;

    const result = await handler();

    expect(result).toBe(true);
    expect(api.authRefresh).toHaveBeenCalledOnce();
    expect(api.authLogout).not.toHaveBeenCalled();
  });

  it("logs out when the 401 refresh fails", async () => {
    localStorage.setItem(ACCESS_KEY, "acc-1");
    localStorage.setItem(REFRESH_KEY, "ref-1");
    useAuth.setState({ user: USER, isAuthenticated: true });
    api.authRefresh.mockRejectedValue(new Error("expired"));
    const handler = api.setOnUnauthorized.mock.calls[0][0] as () => Promise<boolean>;

    const result = await handler();

    expect(result).toBe(false);
    // The failed refresh already cleared the tokens, so the subsequent logout()
    // has no refresh token left to revoke — but the session must end regardless.
    expect(useAuth.getState().isAuthenticated).toBe(false);
    expect(useAuth.getState().user).toBeNull();
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
  });
});

describe("logout", () => {
  it("revokes the refresh token, clears storage and resets state", async () => {
    localStorage.setItem(ACCESS_KEY, "acc-1");
    localStorage.setItem(REFRESH_KEY, "ref-1");
    useAuth.setState({ user: USER, isAuthenticated: true });
    api.authLogout.mockResolvedValue(undefined);

    await useAuth.getState().logout();

    expect(api.authLogout).toHaveBeenCalledWith("ref-1");
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull();
    expect(useAuth.getState().isAuthenticated).toBe(false);
    expect(useAuth.getState().user).toBeNull();
  });

  it("still clears local state when the server logout call fails", async () => {
    localStorage.setItem(REFRESH_KEY, "ref-1");
    api.authLogout.mockRejectedValue(new Error("boom"));

    await useAuth.getState().logout();

    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(useAuth.getState().isAuthenticated).toBe(false);
  });
});

describe("updatePreferences / fetchMe", () => {
  it("updatePreferences stores the updated user", async () => {
    const updated = { ...USER, preferences: { language: "en" as const } };
    api.updateMyPreferences.mockResolvedValue(updated);

    await useAuth.getState().updatePreferences({ language: "en" });
    expect(useAuth.getState().user).toEqual(updated);
  });

  it("fetchMe swallows errors and leaves the user untouched", async () => {
    api.getMe.mockRejectedValue(new Error("401"));
    await useAuth.getState().fetchMe();
    expect(useAuth.getState().user).toBeNull();
  });
});
