import { ApiClient } from "./api-client";

let cachedCsrfToken: string | null = null;

function getCsrfFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)llmguard_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getCsrfFromStorage(): string | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    return window.sessionStorage.getItem("llmguard_csrf");
  } catch {
    return null;
  }
}

export function setClientCsrfToken(token: string | null) {
  cachedCsrfToken = token;
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      if (token) {
        window.sessionStorage.setItem("llmguard_csrf", token);
      } else {
        window.sessionStorage.removeItem("llmguard_csrf");
      }
    } catch {
      // ignore
    }
  }
}

export function getClientCsrfToken(): string | null {
  if (cachedCsrfToken) return cachedCsrfToken;
  const fromCookie = getCsrfFromCookie();
  if (fromCookie) {
    cachedCsrfToken = fromCookie;
    return fromCookie;
  }
  const fromStorage = getCsrfFromStorage();
  if (fromStorage) {
    cachedCsrfToken = fromStorage;
    return fromStorage;
  }
  return null;
}

let activeCsrfPromise: Promise<string | null> | null = null;

async function resolveCsrfToken(): Promise<string | null> {
  const existing = getClientCsrfToken();
  if (existing) return existing;

  if (typeof window === "undefined") return null;

  if (activeCsrfPromise) {
    return activeCsrfPromise;
  }

  activeCsrfPromise = (async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        if (data.csrfToken) {
          setClientCsrfToken(data.csrfToken);
          return data.csrfToken;
        }
      }
    } catch {
      // ignore network errors
    } finally {
      activeCsrfPromise = null;
    }
    return null;
  })();

  return activeCsrfPromise;
}

/**
 * Dedicated client-side API client that talks to the server-side /api/proxy endpoint,
 * ensuring no admin keys or backend URLs are ever exposed in browser network requests or bundles.
 */
export const clientApi = new ApiClient({
  baseUrl: "/api/proxy",
  timeoutMs: 20000,
});

/**
 * Fetch with CSRF token attached for client-side state mutations.
 * Automatically resolves and persists the CSRF token across page refreshes.
 */
export async function proxyFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  const method = options.method || "GET";
  const headers: Record<string, string> = {};

  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    const token = await resolveCsrfToken();
    if (token) {
      headers["x-csrf-token"] = token;
    }
  } else {
    const token = getClientCsrfToken();
    if (token) {
      headers["x-csrf-token"] = token;
    }
  }

  return clientApi.request<T>(path, {
    method,
    body: options.body,
    params: options.params,
    headers,
  });
}
