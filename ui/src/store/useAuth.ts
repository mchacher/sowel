import { create } from "zustand";
import type { User, UserPreferences, MfaChallenge } from "../types";
import {
  getAuthStatus,
  authLogin,
  authMfaVerify,
  authSetup,
  authRefresh,
  authLogout,
  getMe,
  updateMyPreferences,
  setAccessToken,
  setOnUnauthorized,
} from "../api";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setupRequired: boolean | null; // null = loading
  loading: boolean;
  accessToken: string | null;
  /** Spec 151 — set by login() instead of authenticating when the account has
   *  MFA enabled and no valid trusted-device token was presented. */
  mfaChallenge: MfaChallenge | null;

  // Actions
  checkStatus: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  /** Second factor for the pending mfaChallenge. Throws on an invalid code. */
  verifyMfa: (
    code: string,
    options?: { isBackupCode?: boolean; trustDevice?: boolean },
  ) => Promise<void>;
  /** Abandon the pending MFA challenge and return to the username/password form. */
  cancelMfaChallenge: () => void;
  setup: (data: { username: string; password: string; displayName: string; language?: "fr" | "en" }) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  updatePreferences: (prefs: UserPreferences) => Promise<void>;
  fetchMe: () => Promise<void>;
}

const STORAGE_KEY_ACCESS = "sowel_access_token";
const STORAGE_KEY_REFRESH = "sowel_refresh_token";
const TRUSTED_DEVICE_PREFIX = "sowel_trusted_device_";

function saveTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(STORAGE_KEY_ACCESS, accessToken);
  localStorage.setItem(STORAGE_KEY_REFRESH, refreshToken);
  setAccessToken(accessToken);
  useAuth.setState({ accessToken });
}

function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEY_ACCESS);
  localStorage.removeItem(STORAGE_KEY_REFRESH);
  setAccessToken(null);
  useAuth.setState({ accessToken: null });
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_KEY_REFRESH);
}

// Spec 151 — keyed by username, not global: a shared browser/tablet may see
// logins from multiple household accounts, each with its own device trust.
function getStoredTrustedDeviceToken(username: string): string | null {
  return localStorage.getItem(TRUSTED_DEVICE_PREFIX + username);
}

function saveTrustedDeviceToken(username: string, token: string): void {
  localStorage.setItem(TRUSTED_DEVICE_PREFIX + username, token);
}

export const useAuth = create<AuthState>((set, get) => {
  // Restore access token from localStorage on init
  const storedToken = localStorage.getItem(STORAGE_KEY_ACCESS);
  if (storedToken) {
    setAccessToken(storedToken);
  }

  // Register 401 handler — returns true if refresh succeeded (request will be retried)
  setOnUnauthorized(async () => {
    const success = await get().refreshSession();
    if (!success) {
      get().logout();
    }
    return success;
  });

  // Spec 151 — the username behind the current mfaChallenge, so verifyMfa()
  // knows which per-username localStorage key to write a trusted-device
  // token into. Not part of AuthState: it's an implementation detail of the
  // login/verifyMfa handoff, not something a component should read.
  let pendingUsername: string | null = null;

  return {
    user: null,
    isAuthenticated: false,
    setupRequired: null,
    loading: true,
    accessToken: storedToken,
    mfaChallenge: null,

    checkStatus: async () => {
      set({ loading: true });
      try {
        const { setupRequired } = await getAuthStatus();
        if (setupRequired) {
          set({ setupRequired: true, loading: false, isAuthenticated: false });
          return;
        }

        set({ setupRequired: false });

        // Try to restore session from stored tokens
        const refreshToken = getStoredRefreshToken();
        if (refreshToken) {
          const success = await get().refreshSession();
          if (success) return;
        }

        set({ loading: false, isAuthenticated: false });
      } catch {
        set({ loading: false, setupRequired: null });
      }
    },

    login: async (username, password) => {
      const trustedDeviceToken = getStoredTrustedDeviceToken(username) ?? undefined;
      const result = await authLogin(username, password, trustedDeviceToken);

      if ("mfaRequired" in result) {
        pendingUsername = username;
        set({ mfaChallenge: result });
        return;
      }

      set({ mfaChallenge: null });
      saveTokens(result.accessToken, result.refreshToken);
      set({ user: result.user, isAuthenticated: true, loading: false });
    },

    verifyMfa: async (code, options) => {
      const { mfaChallenge } = get();
      if (!mfaChallenge) throw new Error("No pending MFA challenge");

      const result = await authMfaVerify(mfaChallenge.mfaToken, code, options);
      if (result.trustedDeviceToken && pendingUsername) {
        saveTrustedDeviceToken(pendingUsername, result.trustedDeviceToken);
      }
      pendingUsername = null;

      saveTokens(result.accessToken, result.refreshToken);
      set({ user: result.user, isAuthenticated: true, loading: false, mfaChallenge: null });
    },

    cancelMfaChallenge: () => {
      pendingUsername = null;
      set({ mfaChallenge: null });
    },

    setup: async (data) => {
      const tokens = await authSetup(data);
      saveTokens(tokens.accessToken, tokens.refreshToken);
      set({ user: tokens.user, isAuthenticated: true, setupRequired: false, loading: false });
    },

    logout: async () => {
      const refreshToken = getStoredRefreshToken();
      if (refreshToken) {
        try {
          await authLogout(refreshToken);
        } catch {
          // Ignore logout errors
        }
      }
      clearTokens();
      set({ user: null, isAuthenticated: false });
    },

    refreshSession: async () => {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) return false;

      try {
        const tokens = await authRefresh(refreshToken);
        saveTokens(tokens.accessToken, tokens.refreshToken);
        set({ user: tokens.user, isAuthenticated: true, loading: false });
        return true;
      } catch {
        clearTokens();
        set({ user: null, isAuthenticated: false, loading: false });
        return false;
      }
    },

    updatePreferences: async (prefs) => {
      const updatedUser = await updateMyPreferences(prefs);
      set({ user: updatedUser });
    },

    fetchMe: async () => {
      try {
        const user = await getMe();
        set({ user });
      } catch {
        // Ignore
      }
    },
  };
});
