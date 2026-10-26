// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  COOKIE_NAME,
  createSessionToken,
  getSessionCookieConfig,
  verifySessionToken,
} from "../lib/session";

describe("Session Management", () => {
  it("creates and verifies a valid session token", async () => {
    const adminKey = "lg_admin_test_1234567890abcdef";
    const { token, csrfToken } = await createSessionToken(adminKey, "admin", 3600);

    expect(token).toBeDefined();
    expect(csrfToken).toBeDefined();

    const session = await verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session?.adminKey).toBe(adminKey);
    expect(session?.role).toBe("admin");
    expect(session?.csrfToken).toBe(csrfToken);
    expect(session?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a tampered or invalid token", async () => {
    const { token } = await createSessionToken("key", "admin");
    const tampered = token.slice(0, -4) + "XXXX";

    const session = await verifySessionToken(tampered);
    expect(session).toBeNull();
  });

  it("rejects an empty or malformed token", async () => {
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("invalid.token.structure")).toBeNull();
  });

  it("provides correct cookie security configuration", () => {
    const config = getSessionCookieConfig(86400);
    expect(config.name).toBe(COOKIE_NAME);
    expect(config.httpOnly).toBe(true);
    expect(config.sameSite).toBe("lax");
    expect(config.path).toBe("/");
    expect(config.maxAge).toBe(86400);
  });
});
