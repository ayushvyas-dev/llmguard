import { cookies } from "next/headers";
import { ApiClient, ApiError } from "./api-client";
import { serverConfig } from "./server-config";
import { COOKIE_NAME, verifySessionToken } from "./session";

/**
 * Get an authenticated ApiClient instance for Server Components and Route Handlers.
 */
export async function getServerApiClient(): Promise<ApiClient> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(COOKIE_NAME);

  if (!sessionCookie?.value) {
    throw new ApiError({
      message: "Unauthenticated: No active session",
      code: "unauthorized",
      statusCode: 401,
    });
  }

  const session = await verifySessionToken(sessionCookie.value);
  if (!session?.adminKey) {
    throw new ApiError({
      message: "Unauthenticated: Invalid or expired session",
      code: "unauthorized",
      statusCode: 401,
    });
  }

  return new ApiClient({
    baseUrl: serverConfig.backendApiUrl,
    defaultApiKey: session.adminKey,
  });
}

/**
 * Get an unauthenticated ApiClient instance pointing directly to backend.
 */
export function getDirectBackendClient(apiKey?: string): ApiClient {
  return new ApiClient({
    baseUrl: serverConfig.backendApiUrl,
    defaultApiKey: apiKey,
  });
}
