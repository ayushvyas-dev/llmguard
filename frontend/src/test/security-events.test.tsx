import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SecurityEventsPage from "../app/security/page";
import * as clientApiModule from "../lib/client-api";

describe("Security Events Page (F2, UI-004)", () => {
  const mockSecurityResponse = {
    total: 2,
    events: [
      {
        id: "sec_1",
        request_id: "req_injection_101",
        client_id: "client_alpha",
        direction: "input",
        category: "prompt_injection",
        action: "block",
        detector: "PromptInjectionDetector",
        score: 0.95,
        reason_codes: ["DAN_JAILBREAK", "INSTRUCTION_OVERRIDE"],
        policy_version: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "sec_2",
        request_id: "req_pii_102",
        client_id: "client_beta",
        direction: "input",
        category: "pii",
        action: "redact",
        detector: "PIIDetector",
        score: 0.85,
        reason_codes: ["EMAIL_DETECTED", "PHONE_DETECTED"],
        policy_version: 1,
        created_at: new Date().toISOString(),
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders list of security events with category badges and reason codes", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(mockSecurityResponse);

    render(<SecurityEventsPage />);

    await waitFor(() => {
      expect(screen.getByText("req_injection_101")).toBeInTheDocument();
      expect(screen.getByText("req_pii_102")).toBeInTheDocument();
      expect(screen.getByText("DAN_JAILBREAK")).toBeInTheDocument();
      expect(screen.getByText("EMAIL_DETECTED")).toBeInTheDocument();
      expect(screen.getByText("0.95")).toBeInTheDocument();
    });
  });

  it("filters by category and triggers API query", async () => {
    const fetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue(mockSecurityResponse);

    render(<SecurityEventsPage />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("admin/security/events", expect.any(Object));
    });

    const categorySelect = screen.getByRole("combobox", { name: /filter by category/i });
    await userEvent.selectOptions(categorySelect, "prompt_injection");

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "admin/security/events",
        expect.objectContaining({
          params: expect.objectContaining({ category: "prompt_injection" }),
        })
      );
    });
  });

  it("renders empty state when no events exist", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue({ total: 0, events: [] });

    render(<SecurityEventsPage />);

    await waitFor(() => {
      expect(screen.getByText("No security events found")).toBeInTheDocument();
    });
  });
});
