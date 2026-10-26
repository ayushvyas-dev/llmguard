import { z } from "zod";

/**
 * Standard API error model matching FastAPI error_response envelope.
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly errorType?: string;
  public readonly requestId?: string;
  public readonly details?: unknown;

  constructor(params: {
    message: string;
    code: string;
    statusCode: number;
    errorType?: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.errorType = params.errorType;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export class ApiValidationError extends Error {
  public readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "ApiValidationError";
    this.issues = issues;
  }
}

export interface RequestOptions<TResponse = unknown> {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  schema?: z.ZodType<TResponse>;
  timeoutMs?: number;
  apiKey?: string;
}

export interface ApiClientConfig {
  baseUrl: string;
  defaultApiKey?: string;
  timeoutMs?: number;
}

export class ApiClient {
  private baseUrl: string;
  private defaultApiKey?: string;
  private defaultTimeoutMs: number;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.defaultApiKey = config.defaultApiKey;
    this.defaultTimeoutMs = config.timeoutMs ?? 15000;
  }

  /**
   * Parse error payload safely from FastAPI response.
   */
  public async parseErrorResponse(response: Response): Promise<ApiError> {
    const statusCode = response.status;
    let message = `API request failed with status ${statusCode}`;
    let code = "api_error";
    let errorType: string | undefined;
    let requestId: string | undefined;
    let details: unknown = undefined;

    try {
      const data = await response.json();
      if (data && typeof data === "object") {
        if ("error" in data && data.error && typeof data.error === "object") {
          const err = data.error as Record<string, unknown>;
          message = typeof err.message === "string" ? err.message : message;
          code = typeof err.code === "string" ? err.code : code;
          errorType = typeof err.type === "string" ? err.type : undefined;
          requestId = typeof err.request_id === "string" ? err.request_id : undefined;
          details = err.details;
        } else if ("detail" in data) {
          message = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
          code = statusCode === 401 ? "unauthorized" : "bad_request";
          details = data.detail;
        }
      }
    } catch {
      // Fallback to text or generic status message
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {
        // Ignored
      }
    }

    if (statusCode === 401 && code === "api_error") {
      code = "unauthorized";
    }

    return new ApiError({
      message,
      code,
      statusCode,
      errorType,
      requestId,
      details,
    });
  }

  public async request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const {
      method = "GET",
      headers = {},
      body,
      params,
      schema,
      timeoutMs = this.defaultTimeoutMs,
      apiKey = this.defaultApiKey,
    } = options;

    let urlStr = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) urlStr += `?${qs}`;
    }

    const requestHeaders: Record<string, string> = {
      Accept: "application/json",
      ...headers,
    };

    if (apiKey) {
      requestHeaders["Authorization"] = `Bearer ${apiKey}`;
    }

    let serializedBody: string | undefined = undefined;
    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
      serializedBody = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(urlStr, {
        method,
        headers: requestHeaders,
        body: serializedBody,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await this.parseErrorResponse(response);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const json = await response.json();

      if (schema) {
        const parseResult = schema.safeParse(json);
        if (!parseResult.success) {
          throw new ApiValidationError(
            `Response schema validation failed for ${path}: ${parseResult.error.message}`,
            parseResult.error.issues
          );
        }
        return parseResult.data;
      }

      return json as T;
    } catch (err: unknown) {
      if (err instanceof ApiError || err instanceof ApiValidationError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError({
          message: `Request to ${path} timed out after ${timeoutMs}ms`,
          code: "timeout",
          statusCode: 504,
        });
      }
      throw new ApiError({
        message: err instanceof Error ? err.message : "Unknown network error",
        code: "network_error",
        statusCode: 500,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  public get<T>(path: string, options?: Omit<RequestOptions<T>, "method" | "body">): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  public post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions<T>, "method" | "body">
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  public patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions<T>, "method" | "body">
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "PATCH", body });
  }

  public delete<T>(path: string, options?: Omit<RequestOptions<T>, "method" | "body">): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }
}
