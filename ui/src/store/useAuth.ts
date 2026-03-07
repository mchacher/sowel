import { create } from "zustand";
import type { User, UserPreferences } from "../types";
import {
  getAuthStatus,
  authLogin,
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

  // Actions
  checkStatus: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setup: (data: { username: string; password: string; displayName: string; language?: "fr" | "en" }) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  updatePreferences: (prefs: UserPreferences) => Promise<void>;
  fetchMe: () => Promise<void>;
}

const STORAGE_KEY_ACCESS = "sowel_access_token";
const STORAGE_KEY_REFRESH = "sowel_refresh_token";

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

export const useAuth = create<AuthState>((set, get) => {
  // Restore access token from localStorage on init
  const storedToken = localStorage.getItem(STORAGE_KEY_ACCESS);
  if (storedToken) {
    setAccessToken(storedToken);
  }

  // Register 401 handler
  setOnUnauthorized(async () => {
    const success = await get().refreshSession();
    if (!success) {
      get().logout();
    }
  });

  return {
    user: null,
    isAuthenticated: false,
    setupRequired: null,
    loading: true,
    accessToken: storedToken,

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
      const tokens = await authLogin(username, password);
      saveTokens(tokens.accessToken, tokens.refreshToken);
      set({ user: tokens.user, isAuthenticated: true, loading: false });
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
