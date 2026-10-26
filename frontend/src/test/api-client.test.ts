import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient, ApiError, ApiValidationError } from "../lib/api-client";

describe("ApiClient", () => {
  let client: ApiClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    client = new ApiClient({
      baseUrl: "http://api.test",
      defaultApiKey: "test_key_123",
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches Authorization header and parses successful JSON response", async () => {
    const payload = { status: "ok", data: [1, 2, 3] };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await client.get<{ status: string; data: number[] }>("/items");
    expect(result).toEqual(payload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://api.test/items");
    expect(init.method).toBe("GET");
    expect(init.headers["Authorization"]).toBe("Bearer test_key_123");
  });

  it("parses FastAPI error envelope into ApiError with structured details", async () => {
    const errorEnvelope = {
      error: {
        code: "invalid_request",
        message: "Request validation failed.",
        type: "invalid_request_error",
        request_id: "req_xyz_123",
        details: [{ loc: ["body", "temperature"], msg: "Invalid float" }],
      },
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(errorEnvelope), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(client.post("/chat", { temperature: "not_a_float" })).rejects.toThrow(ApiError);

    try {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(errorEnvelope), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        })
      );
      await client.post("/chat", {});
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("invalid_request");
      expect(apiErr.statusCode).toBe(422);
      expect(apiErr.requestId).toBe("req_xyz_123");
      expect(apiErr.message).toBe("Request validation failed.");
      expect(apiErr.details).toBeDefined();
    }
  });

  it("correctly flags 401 Unauthorized errors", async () => {
    const errorBody = { detail: "Not authenticated" };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    try {
      await client.get("/admin/metrics");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(401);
      expect(apiErr.code).toBe("unauthorized");
    }
  });

  it("validates response schema using Zod", async () => {
    const UserSchema = z.object({
      id: z.string(),
      email: z.string().email(),
    });

    // Valid response
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "usr_1", email: "admin@llmguard.io" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const validUser = await client.get("/me", { schema: UserSchema });
    expect(validUser.email).toBe("admin@llmguard.io");

    // Invalid response fails schema validation
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "usr_1", email: "not-an-email" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(client.get("/me", { schema: UserSchema })).rejects.toThrow(ApiValidationError);
  });

  it("handles request timeouts gracefully", async () => {
    // Simulate abort error
    const abortErr = new DOMException("The user aborted a request.", "AbortError");
    mockFetch.mockRejectedValueOnce(abortErr);

    try {
      await client.get("/slow-endpoint", { timeoutMs: 50 });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("timeout");
      expect(apiErr.statusCode).toBe(504);
    }
  });
});
