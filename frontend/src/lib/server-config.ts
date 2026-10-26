/**
 * Server-only configuration.
 *
 * BACKEND_API_URL and SESSION_SECRET must NEVER be prefixed with NEXT_PUBLIC_
 * or exposed to client-side bundles.
 */

if (typeof window !== "undefined") {
  throw new Error("server-config cannot be imported on the client side.");
}

export const serverConfig = {
  backendApiUrl: (process.env.BACKEND_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, ""),
  sessionSecret:
    process.env.SESSION_SECRET || "llmguard_dev_session_secret_key_at_least_32_bytes_long!",
  isProduction: process.env.NODE_ENV === "production",
};
