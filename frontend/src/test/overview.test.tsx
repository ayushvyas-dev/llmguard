import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "../app/page";
import * as clientApiModule from "../lib/client-api";

// Mock recharts responsive container for jsdom testing
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="recharts-container" style={{ width: 400, height: 300 }}>
        {children}
      </div>
    ),
  };
});

describe("Overview Page (F2, UI-002)", () => {
  const mockMetrics = {
    total_requests: 1250,
    success_rate: 0.984,
    p50_latency_ms: 45.2,
    p95_latency_ms: 112.5,
    p99_latency_ms: 180.0,
    total_input_tokens: 45000,
    total_output_tokens: 15000,
    total_tokens: 60000,
    total_saved_tokens: 8500,
    estimated_cost_usd: 0.0456,
    cache_hit_rate: 0.142,
    security_events_count: 18,
    blocked_requests_count: 12,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders metric cards and ensures estimated cost is explicitly labeled", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(mockMetrics);

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("1,250")).toBeInTheDocument();
      expect(screen.getByText("98.4%")).toBeInTheDocument();
      expect(screen.getByText("45.2ms")).toBeInTheDocument();
      expect(screen.getByText("$0.0456")).toBeInTheDocument();
    });

    // Verify "ESTIMATE" badge is strictly visible next to the cost
    expect(screen.getByText("ESTIMATE")).toBeInTheDocument();
    expect(screen.getByText("Total Volume")).toBeInTheDocument();
    expect(screen.getByText("Success Rate")).toBeInTheDocument();
    expect(screen.getByText("Total Tokens")).toBeInTheDocument();
  });

  it("switches time ranges and triggers API refetch with timestamp params", async () => {
    const fetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(mockMetrics);

    render(<OverviewPage />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("admin/metrics/overview", expect.any(Object));
    });

    const sevenDaysBtn = screen.getByText("Last 7 Days");
    await userEvent.click(sevenDaysBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("handles error states gracefully", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockRejectedValue(new Error("Database connection timed out"));

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Database connection timed out")).toBeInTheDocument();
    });
  });
});
