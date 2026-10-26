import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "llmguard_session";
export const CSRF_HEADER = "x-csrf-token";

export interface SessionPayload {
  adminKey: string;
  role: string;
  csrfToken: string;
  expiresAt: number;
}

const DEFAULT_SECRET = "llmguard_dev_session_secret_key_at_least_32_bytes_long!";

export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET || DEFAULT_SECRET;
  return new TextEncoder().encode(secret);
}

/**
 * Create a cryptographically signed JWT session token.
 */
export async function createSessionToken(
  adminKey: string,
  role = "admin",
  durationSeconds = 86400
): Promise<{ token: string; csrfToken: string }> {
  const secret = getSessionSecret();
  const csrfToken = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;

  const token = await new SignJWT({
    adminKey,
    role,
    csrfToken,
    expiresAt,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${durationSeconds}s`)
    .sign(secret);

  return { token, csrfToken };
}

/**
 * Verify and unpack a JWT session token.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = getSessionSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });

    if (
      typeof payload.adminKey === "string" &&
      typeof payload.role === "string" &&
      typeof payload.csrfToken === "string"
    ) {
      return {
        adminKey: payload.adminKey,
        role: payload.role,
        csrfToken: payload.csrfToken,
        expiresAt: typeof payload.expiresAt === "number" ? payload.expiresAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Standard cookie configuration for the session cookie.
 */
export function getSessionCookieConfig(maxAge = 86400) {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
