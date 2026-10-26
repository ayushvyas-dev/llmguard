import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlaygroundPage from "../app/playground/page";
import * as clientApiModule from "../lib/client-api";

describe("API Playground (F3, UI-008)", () => {
  const mockModelsResponse = {
    models: [
      {
        alias: "default-chat",
        provider: "fake",
        provider_model_id: "fake-chat",
        capabilities: { streaming: false },
        enabled: true,
      },
      {
        alias: "groq-chat",
        provider: "groq",
        provider_model_id: "openai/gpt-oss-120b",
        capabilities: { streaming: true, tools: true },
        enabled: true,
      },
    ],
  };

  const mockSuccessCompletion = {
    status: "success",
    http_status: 200,
    response: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Zero-trust enforces strict continuous authentication at every boundary.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 18,
        completion_tokens: 12,
        total_tokens: 30,
        estimated_cost_usd: 0.00015,
      },
    },
    trace_summary: {
      request_id: "req_play_success_123",
      correlation_id: "corr_play_123",
      provider: "groq",
      provider_model: "openai/gpt-oss-120b",
      latency_ms: 88,
      prompt_tokens: 18,
      completion_tokens: 12,
      total_tokens: 30,
      estimated_cost_usd: 0.00015,
      cost_is_estimate: true,
      cache_status: "miss",
      security_decision: "allow",
      risk_score: 0.02,
      findings: [],
      fallback_used: false,
      attempts: [],
      trace_id: "req_play_success_123",
    },
  };

  const mockBlockedCompletion = {
    status: "blocked",
    http_status: 403,
    error: {
      code: "blocked_by_policy",
      message: "The request was blocked by a security policy.",
      error_type: "security_error",
      details: {
        categories: ["prompt_injection"],
        risk_score: 0.98,
      },
    },
    trace_summary: {
      request_id: "req_play_blocked_456",
      correlation_id: "corr_play_456",
      status: "blocked",
      latency_ms: 12,
      security_decision: "block",
      risk_score: 0.98,
      findings: ["prompt_injection"],
      fallback_used: false,
      attempts: [],
      trace_id: "req_play_blocked_456",
    },
  };

  const mockFallbackCompletion = {
    status: "success",
    http_status: 200,
    response: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Fallback response received from secondary provider.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 10,
        total_tokens: 25,
      },
    },
    trace_summary: {
      request_id: "req_play_fallback_789",
      correlation_id: "corr_play_789",
      provider: "groq",
      provider_model: "openai/gpt-oss-120b",
      latency_ms: 245,
      prompt_tokens: 15,
      completion_tokens: 10,
      total_tokens: 25,
      estimated_cost_usd: 0.00025,
      cost_is_estimate: true,
      cache_status: "bypass",
      security_decision: "allow",
      risk_score: 0.0,
      findings: [],
      fallback_used: true,
      attempts: [
        { provider: "gemini", model: "gemini-3.5-flash-lite", duration_ms: 180, outcome: "error", error: "503" },
        { provider: "groq", model: "openai/gpt-oss-120b", duration_ms: 65, outcome: "success" },
      ],
      trace_id: "req_play_fallback_789",
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders playground interface with models and presets", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(mockModelsResponse);

    render(<PlaygroundPage />);

    expect(screen.getByText("API Playground")).toBeInTheDocument();
    expect(screen.getByText(/Live Pipeline/i)).toBeInTheDocument();
    expect(screen.getByText("Safe Prompt")).toBeInTheDocument();
    expect(screen.getByText("Prompt Injection Test")).toBeInTheDocument();
    expect(screen.getByText("PII Redaction Test")).toBeInTheDocument();
    expect(screen.getByText("Deterministic Cache Test")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Model Alias" })).toBeInTheDocument();
    });
  });

  it("executes completion and displays response text, provider, tokens, and ESTIMATE cost badge", async () => {
    const fetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path) => {
      if (path === "admin/playground/models") {
        return Promise.resolve(mockModelsResponse);
      }
      return Promise.resolve(mockSuccessCompletion);
    });

    render(<PlaygroundPage />);

    // Click a preset prompt to populate user prompt
    const safePromptBtn = screen.getByText("Safe Prompt");
    fireEvent.click(safePromptBtn);

    // Submit completion
    const runBtn = screen.getByText(/Run Completion/i);
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("admin/playground/completions", expect.objectContaining({
        method: "POST",
      }));
      expect(
        screen.getByText("Zero-trust enforces strict continuous authentication at every boundary.")
      ).toBeInTheDocument();
      expect(screen.getByText(/HTTP 200 OK/i)).toBeInTheDocument();
      expect(screen.getByText("ESTIMATE")).toBeInTheDocument();
      expect(screen.getByText(/88ms/)).toBeInTheDocument();
      expect(screen.getByText(/Inspect Full Trace/i)).toBeInTheDocument();
    });
  });

  it("renders security block verdict when prompt is blocked by policy", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path) => {
      if (path === "admin/playground/models") {
        return Promise.resolve(mockModelsResponse);
      }
      return Promise.resolve(mockBlockedCompletion);
    });

    render(<PlaygroundPage />);

    // Click injection preset
    const injectionBtn = screen.getByText("Prompt Injection Test");
    fireEvent.click(injectionBtn);

    const runBtn = screen.getByText(/Run Completion/i);
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Blocked \(403\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Prompt Blocked by Security Policy/i)).toBeInTheDocument();
      expect(screen.getAllByText(/prompt_injection/)[0]).toBeInTheDocument();
    });
  });

  it("renders fallback indication when secondary provider was used", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path) => {
      if (path === "admin/playground/models") {
        return Promise.resolve(mockModelsResponse);
      }
      return Promise.resolve(mockFallbackCompletion);
    });

    render(<PlaygroundPage />);

    const safePromptBtn = screen.getByText("Safe Prompt");
    fireEvent.click(safePromptBtn);

    const runBtn = screen.getByText(/Run Completion/i);
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Fallback route was triggered/i)).toBeInTheDocument();
      expect(
        screen.getByText("Fallback response received from secondary provider.")
      ).toBeInTheDocument();
    });
  });

  it("ensures zero credentials or secret keys are rendered in the DOM", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path) => {
      if (path === "admin/playground/models") {
        return Promise.resolve(mockModelsResponse);
      }
      return Promise.resolve(mockSuccessCompletion);
    });

    render(<PlaygroundPage />);

    await waitFor(() => {
      expect(screen.getByText("API Playground")).toBeInTheDocument();
    });

    const html = document.body.innerHTML;
    expect(html).not.toMatch(/gsk_[a-zA-Z0-9_-]+/);
    expect(html).not.toMatch(/AIza[a-zA-Z0-9_-]+/);
    expect(html).not.toMatch(/lga_[a-zA-Z0-9_-]+/);
  });
});
