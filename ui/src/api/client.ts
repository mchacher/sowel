// Shared HTTP client for the api/* domain modules: base URL, access-token
// state, the authenticated (`fetchJSON`) and public (`fetchPublic`) fetch
// wrappers, and the 401-refresh / 429-retry logic.

export const API_BASE = "/api/v1";

// Token management — used by the useAuth store
let _accessToken: string | null = null;
let _onUnauthorized: (() => Promise<boolean>) | null = null;
let _refreshing: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function setOnUnauthorized(handler: () => Promise<boolean>): void {
  _onUnauthorized = handler;
}

/** Current access token — for endpoints that build their own request (media proxy, downloads). */
export function getAccessToken(): string | null {
  return _accessToken;
}

/** Server-side global rate limit is 300 req/min per IP — a burst can 429 a legitimate read. */
const RATE_LIMIT_MAX_WAIT_MS = 5000;

function parseRetryAfter(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1000;
  return Math.min(seconds * 1000, RATE_LIMIT_MAX_WAIT_MS);
}

export async function fetchJSON<T>(
  url: string,
  options?: RequestInit,
  isRetry = false,
  rateLimitRetried = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    headers,
    ...options,
  });

  // Rate limited (429): retry reads once after the server-advertised delay. Only GETs are
  // retried — replaying a mutation blindly could apply it twice.
  const method = (options?.method ?? "GET").toUpperCase();
  if (response.status === 429 && !rateLimitRetried && method === "GET") {
    await new Promise((resolve) =>
      setTimeout(resolve, parseRetryAfter(response.headers.get("retry-after"))),
    );
    return fetchJSON<T>(url, options, isRetry, true);
  }

  if (response.status === 401 && _onUnauthorized && !isRetry) {
    // Deduplicate concurrent refresh attempts
    if (!_refreshing) {
      _refreshing = _onUnauthorized().finally(() => {
        _refreshing = null;
      });
    }
    const success = await _refreshing;
    if (success) {
      // Retry with new token
      return fetchJSON<T>(url, options, true);
    }
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${response.status}: ${response.statusText}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// Unauthenticated fetch (for auth endpoints)
export async function fetchPublic<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { headers, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${response.status}: ${response.statusText}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
