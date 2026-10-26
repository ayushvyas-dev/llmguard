import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TracesPage from "../app/traces/page";
import TraceDetailPage from "../app/traces/[id]/page";
import * as clientApiModule from "../lib/client-api";

describe("Request Traces & Timeline (F2, UI-005)", () => {
  const mockTraceListResponse = {
    total: 1,
    traces: [
      {
        request_id: "req_test_abc_123",
        correlation_id: "corr_xyz_789",
        client_id: "client_one",
        started_at: new Date().toISOString(),
        status: "success",
        http_status: 200,
        error_code: null,
        provider: "groq",
        provider_model: "openai/gpt-oss-120b",
        fallback_used: true,
        retry_count: 1,
        latency_ms: 125,
        security_decision: "allow",
        risk_score: 0.05,
        cache_status: "miss",
        input_chars: 40,
        output_chars: 120,
      },
    ],
  };

  const mockTraceDetailResponse = {
    request_id: "req_test_abc_123",
    correlation_id: "corr_xyz_789",
    client_id: "client_one",
    started_at: new Date().toISOString(),
    status: "success",
    http_status: 200,
    error_code: null,
    provider: "groq",
    provider_model: "openai/gpt-oss-120b",
    fallback_used: true,
    retry_count: 1,
    latency_ms: 125,
    security_decision: "allow",
    risk_score: 0.05,
    policy_version: 1,
    cache_status: "miss",
    prompt_hash: "hash_abc",
    input_chars: 40,
    output_chars: 120,
    events: [
      { type: "request_received", timestamp: 1000, duration_ms: 1, outcome: "ok" },
      { type: "auth_check", timestamp: 1001, duration_ms: 3, outcome: "ok", attributes: { role: "client" } },
      { type: "security_input", timestamp: 1004, duration_ms: 12, outcome: "allow", attributes: { risk: 0.05 } },
      { type: "provider_attempt", timestamp: 1016, duration_ms: 80, outcome: "error", attributes: { provider: "fake", error: "503" } },
      { type: "provider_attempt", timestamp: 1096, duration_ms: 25, outcome: "success", attributes: { provider: "groq", attempt: 2 } },
      { type: "response_sent", timestamp: 1121, duration_ms: 4, outcome: "ok", attributes: { status: 200 } },
    ],
    content_preview: "User prompt: Summarize architecture",
    content_expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders trace list with request ID, provider, latency, and fallback badge", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(mockTraceListResponse);

    render(<TracesPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/req_test_abc_123/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/125ms/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/groq/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Fallback/)[0]).toBeInTheDocument();
    });
  });

  it("renders trace detail page with lifecycle event timeline and attempts", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(mockTraceDetailResponse);

    render(<TraceDetailPage params={{ id: "req_test_abc_123" }} />);

    await waitFor(() => {
      expect(screen.getAllByText(/req_test_abc_123/)[0]).toBeInTheDocument();
      expect(screen.getByText("Lifecycle Event Timeline")).toBeInTheDocument();
      expect(screen.getByText(/request received/i)).toBeInTheDocument();
      expect(screen.getByText(/auth check/i)).toBeInTheDocument();
      expect(screen.getByText(/security input/i)).toBeInTheDocument();
      expect(screen.getAllByText(/provider attempt/i)).toHaveLength(2);
      expect(screen.getByText("User prompt: Summarize architecture")).toBeInTheDocument();
    });
  });

  it("displays truncated banner when trace_truncated event is recorded", async () => {
    const truncatedDetail = {
      ...mockTraceDetailResponse,
      events: [
        ...mockTraceDetailResponse.events,
        { type: "trace_truncated", timestamp: 1200, duration_ms: 0, outcome: "truncated" },
      ],
    };
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(truncatedDetail);

    render(<TraceDetailPage params={{ id: "req_test_abc_123" }} />);

    await waitFor(() => {
      expect(
        screen.getByText(/This trace reached the telemetry buffer size limit/i)
      ).toBeInTheDocument();
    });
  });
});
