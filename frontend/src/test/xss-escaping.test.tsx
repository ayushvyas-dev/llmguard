import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SecurityEventsPage from "../app/security/page";
import TraceDetailPage from "../app/traces/[id]/page";
import * as clientApiModule from "../lib/client-api";

describe("Strict XSS Escaping & Safe Content Rendering", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("safely escapes malicious script tags in security events without DOM injection", async () => {
    const maliciousPayload = "<script>window.__xss_flag = true;</script><img src='x' onerror='window.__xss_flag=true' />";
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue({
      events: [
        {
          id: "sec-xss-1",
          request_id: "req-malicious-1",
          client_id: "client-bad",
          direction: "inbound",
          category: "prompt_injection",
          action: "block",
          detector: "regex_guard",
          score: 0.95,
          reason_codes: ["Exploit attempt: " + maliciousPayload],
          policy_version: 1,
          created_at: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    render(<SecurityEventsPage />);

    await waitFor(() => {
      const reasonEl = screen.getAllByText(/Exploit attempt/)[0];
      expect(reasonEl).toBeInTheDocument();
      expect(reasonEl.textContent).toContain("<script>");
    });

    // Ensure no actual <script> or <img> DOM elements were created from data
    expect(document.querySelector("script:not([src])")).toBeNull();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect((window as unknown as { __xss_flag?: boolean }).__xss_flag).toBeUndefined();
  });

  it("safely renders trace detail content preview and event attributes without HTML injection", async () => {
    const maliciousPayload = "<svg onload='alert(1)'><b>attack-payload</b></svg>";
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue({
      request_id: "trace-xss-2",
      correlation_id: "corr-xss-2",
      client_id: "client-xss",
      started_at: new Date().toISOString(),
      status: "blocked",
      http_status: 403,
      error_code: "SECURITY_BLOCK",
      provider: "groq",
      provider_model: "fake",
      fallback_used: false,
      retry_count: 0,
      latency_ms: 45,
      security_decision: "block",
      risk_score: 0.99,
      policy_version: 1,
      cache_status: "bypass",
      prompt_hash: "hash_bad",
      input_chars: 50,
      output_chars: 0,
      events: [
        {
          type: "security_input",
          timestamp: 1000,
          duration_ms: 12,
          outcome: "block",
          attributes: {
            reason: maliciousPayload,
          },
        },
      ],
      content_preview: maliciousPayload,
      content_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    render(<TraceDetailPage params={{ id: "trace-xss-2" }} />);

    await waitFor(() => {
      const match = screen.getAllByText(/attack-payload/)[0];
      expect(match).toBeInTheDocument();
      expect(match.textContent).toContain("<svg");
    });

    // Verify no SVG or bold elements were injected into the DOM
    expect(document.querySelector("svg[onload]")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });
});
