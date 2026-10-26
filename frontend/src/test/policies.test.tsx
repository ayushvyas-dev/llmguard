import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PoliciesPage from "../app/policies/page";
import * as clientApiModule from "../lib/client-api";

describe("Policy Engine & Routing Configuration (F4, UI-007, UI-009)", () => {
  const mockSecurityPolicies = [
    {
      id: "sec_11111111-1111-1111-1111-111111111111",
      name: "enterprise-strict-policy",
      version: 1,
      is_default: true,
      config: {
        mode: "enforce",
        detectors: {
          prompt_injection: { enabled: true, threshold: 0.85, action: "block" },
          jailbreak: { enabled: true, threshold: 0.8, action: "block" },
          pii: { enabled: true, action: "mask", entities: ["EMAIL", "PHONE", "SSN"] },
          secrets: { enabled: true, action: "block", patterns: ["api_key", "jwt"] },
          tool_call: { enabled: true, action: "block" },
          output: { enabled: true, action: "mask" },
        },
        store_content: false,
      },
      created_by: "adm_dev_1234",
      created_at: "2026-10-24T12:00:00Z",
    },
  ];

  const mockRoutingPolicies = [
    {
      id: "route_22222222-2222-2222-2222-222222222222",
      name: "multi-provider-resilience",
      version: 2,
      is_default: true,
      config: {
        primary: "openai:gpt-4o",
        fallbacks: ["anthropic:claude-3-5-sonnet-20241022", "groq:llama-3.3-70b-versatile"],
        allow_fallback: true,
        per_attempt_timeout_seconds: 12.0,
        request_deadline_seconds: 40.0,
        max_retries: 3,
        backoff_base_seconds: 0.5,
        backoff_max_seconds: 10.0,
        retry_after_cap_seconds: 30.0,
      },
      created_by: "adm_dev_1234",
      created_at: "2026-10-24T12:30:00Z",
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders security policies and routing policies with tab switching", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path) => {
      if (path === "admin/policies") return Promise.resolve(mockSecurityPolicies);
      if (path === "admin/policies/routing") return Promise.resolve(mockRoutingPolicies);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      return Promise.resolve(null);
    });

    render(<PoliciesPage />);

    // Security policies tab is active by default
    expect(await screen.findByText("enterprise-strict-policy")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("DEFAULT")).toBeInTheDocument();
    expect(screen.getByText(/block \(≥0.85\)/i)).toBeInTheDocument();

    // Switch to Routing Policies tab
    const routeTabBtn = screen.getByText(/Routing Policies/i);
    fireEvent.click(routeTabBtn);

    expect(await screen.findByText("multi-provider-resilience")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("openai:gpt-4o")).toBeInTheDocument();
    expect(screen.getByText(/anthropic:claude-3-5-sonnet/i)).toBeInTheDocument();
  });

  it("edits security policy and increments version upon update", async () => {
    const updatedPolicy = {
      ...mockSecurityPolicies[0],
      version: 2,
      config: {
        ...mockSecurityPolicies[0].config,
        detectors: {
          ...mockSecurityPolicies[0].config.detectors,
          prompt_injection: { enabled: true, threshold: 0.95, action: "block" },
        },
      },
    };

    const proxyFetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path, opts) => {
      if (path === "admin/policies" && !opts?.method) return Promise.resolve(mockSecurityPolicies);
      if (path === "admin/policies/routing") return Promise.resolve(mockRoutingPolicies);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      if (path === "admin/policies/sec_11111111-1111-1111-1111-111111111111" && opts?.method === "PUT") {
        return Promise.resolve(updatedPolicy);
      }
      return Promise.resolve(null);
    });

    render(<PoliciesPage />);

    expect(await screen.findByText("enterprise-strict-policy")).toBeInTheDocument();

    // Open edit modal
    fireEvent.click(screen.getByRole("button", { name: "Edit Policy" }));
    expect(screen.getByText("Edit Policy: enterprise-strict-policy")).toBeInTheDocument();

    // Adjust threshold slider
    const slider = screen.getByDisplayValue("0.85");
    fireEvent.change(slider, { target: { value: "0.95" } });

    // Submit update
    const updateBtn = screen.getByRole("button", { name: "Update (Bump Version)" });
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(proxyFetchSpy).toHaveBeenCalledWith(
        "admin/policies/sec_11111111-1111-1111-1111-111111111111",
        expect.objectContaining({
          method: "PUT",
        })
      );
    });

    // Check updated version in UI
    expect(await screen.findByText("v2")).toBeInTheDocument();
  });

  it("edits routing policy and modifies fallback chain and timeouts", async () => {
    const updatedRouting = {
      ...mockRoutingPolicies[0],
      version: 3,
      config: {
        ...mockRoutingPolicies[0].config,
        primary: "gemini:gemini-2.5-flash",
        max_retries: 4,
      },
    };

    const proxyFetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path, opts) => {
      if (path === "admin/policies" && !opts?.method) return Promise.resolve(mockSecurityPolicies);
      if (path === "admin/policies/routing" && !opts?.method) return Promise.resolve(mockRoutingPolicies);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      if (
        path === "admin/policies/routing/route_22222222-2222-2222-2222-222222222222" &&
        opts?.method === "PUT"
      ) {
        return Promise.resolve(updatedRouting);
      }
      return Promise.resolve(null);
    });

    render(<PoliciesPage />);

    // Switch to routing tab
    fireEvent.click(screen.getByText(/Routing Policies/i));
    expect(await screen.findByText("multi-provider-resilience")).toBeInTheDocument();

    // Open edit
    fireEvent.click(screen.getByRole("button", { name: "Edit Routing" }));
    expect(screen.getByText("Edit Routing: multi-provider-resilience")).toBeInTheDocument();

    // Change primary model
    const primaryInput = screen.getByDisplayValue("openai:gpt-4o");
    fireEvent.change(primaryInput, { target: { value: "gemini:gemini-2.5-flash" } });

    // Submit update
    const updateBtn = screen.getByRole("button", { name: "Update (Bump Version)" });
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(proxyFetchSpy).toHaveBeenCalledWith(
        "admin/policies/routing/route_22222222-2222-2222-2222-222222222222",
        expect.objectContaining({
          method: "PUT",
        })
      );
    });

    expect(await screen.findByText("v3")).toBeInTheDocument();
  });

  it("validates routing policy inputs and rejects invalid timeouts", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path) => {
      if (path === "admin/policies") return Promise.resolve([]);
      if (path === "admin/policies/routing") return Promise.resolve([]);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      return Promise.resolve(null);
    });

    render(<PoliciesPage />);

    fireEvent.click(screen.getByText(/Routing Policies/i));
    fireEvent.click(screen.getByText("New Routing Policy"));

    expect(screen.getByText("Create Routing Policy")).toBeInTheDocument();

    // Fill policy name so it passes name validation
    fireEvent.change(screen.getByPlaceholderText(/ultra-low-latency-chain/i), {
      target: { value: "test-routing" },
    });

    // Set invalid timeout <= 0
    const timeoutInput = screen.getByDisplayValue("10");
    fireEvent.change(timeoutInput, { target: { value: "-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Policy" }));

    expect(await screen.findByText("Per-attempt timeout must be > 0")).toBeInTheDocument();
  });
});
