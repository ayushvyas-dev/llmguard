import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClientsPage from "../app/clients/page";
import * as clientApiModule from "../lib/client-api";

describe("Clients & API Keys Management (F4, UI-006, UI-009)", () => {
  const mockClients = [
    {
      id: "cli_11111111-1111-1111-1111-111111111111",
      name: "acme-customer-support",
      status: "active",
      security_policy_id: null,
      routing_policy_id: null,
      rate_limit_rpm: 120,
      window_seconds: 60,
      daily_token_quota: 1000000,
      monthly_cost_quota: 50.0,
      allowed_models: ["mock:default-chat", "openai:gpt-4o"],
      store_content: true,
      created_at: "2026-10-24T10:00:00Z",
      updated_at: "2026-10-24T10:00:00Z",
    },
    {
      id: "cli_22222222-2222-2222-2222-222222222222",
      name: "internal-analytics",
      status: "disabled",
      security_policy_id: "sec_pol_1",
      routing_policy_id: "route_pol_1",
      rate_limit_rpm: 30,
      window_seconds: 60,
      daily_token_quota: null,
      monthly_cost_quota: null,
      allowed_models: null,
      store_content: false,
      created_at: "2026-10-23T10:00:00Z",
      updated_at: "2026-10-23T10:00:00Z",
    },
  ];

  const mockKeys = [
    {
      id: "key_1",
      client_id: "cli_11111111-1111-1111-1111-111111111111",
      prefix: "lg_dev_a1b2c3d4",
      role: "client",
      status: "active",
      label: "support-bot-key",
      expires_at: null,
      last_used_at: "2026-10-25T09:00:00Z",
    },
    {
      id: "key_2",
      client_id: "cli_11111111-1111-1111-1111-111111111111",
      prefix: "lg_dev_e5f6g7h8",
      role: "client",
      status: "revoked",
      label: "old-deprecated-key",
      expires_at: "2026-12-31T23:59:59Z",
      last_used_at: null,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders client list and supports search filtering", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path) => {
      if (path === "admin/clients") return Promise.resolve(mockClients);
      if (path === "admin/policies") return Promise.resolve([]);
      if (path === "admin/policies/routing") return Promise.resolve([]);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      return Promise.resolve(null);
    });

    render(<ClientsPage />);

    expect(await screen.findByText("acme-customer-support")).toBeInTheDocument();
    expect(screen.getByText("internal-analytics")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();

    // Search filter
    const searchInput = screen.getByPlaceholderText(/Search clients/i);
    fireEvent.change(searchInput, { target: { value: "analytics" } });

    expect(screen.queryByText("acme-customer-support")).not.toBeInTheDocument();
    expect(screen.getByText("internal-analytics")).toBeInTheDocument();
  });

  it("validates and creates a new client", async () => {
    const createdClient = {
      id: "cli_33333333-3333-3333-3333-333333333333",
      name: "new-mobile-app",
      status: "active",
      security_policy_id: null,
      routing_policy_id: null,
      rate_limit_rpm: 60,
      window_seconds: 60,
      daily_token_quota: null,
      monthly_cost_quota: null,
      allowed_models: ["mock:default-chat"],
      store_content: false,
      created_at: "2026-10-25T11:00:00Z",
      updated_at: "2026-10-25T11:00:00Z",
    };

    const proxyFetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path, opts) => {
      if (path === "admin/clients" && !opts?.method) return Promise.resolve(mockClients);
      if (path === "admin/policies") return Promise.resolve([]);
      if (path === "admin/policies/routing") return Promise.resolve([]);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      if (path === "admin/clients" && opts?.method === "POST") return Promise.resolve(createdClient);
      return Promise.resolve(null);
    });

    render(<ClientsPage />);

    expect(await screen.findByText("acme-customer-support")).toBeInTheDocument();

    // Click New Client
    fireEvent.click(screen.getByText("New Client"));
    expect(screen.getByText("Create Client Application")).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByPlaceholderText(/customer-service-prod/i), {
      target: { value: "new-mobile-app" },
    });
    fireEvent.change(screen.getByPlaceholderText(/mock:default-chat/i), {
      target: { value: "mock:default-chat" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: "Create Client" }));

    await waitFor(() => {
      expect(proxyFetchSpy).toHaveBeenCalledWith("admin/clients", expect.objectContaining({
        method: "POST",
      }));
    });

    expect(await screen.findByText("new-mobile-app")).toBeInTheDocument();
  });

  it("toggles client status with confirmation dialog", async () => {
    const proxyFetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path, opts) => {
      if (path === "admin/clients" && !opts?.method) return Promise.resolve(mockClients);
      if (path === "admin/policies") return Promise.resolve([]);
      if (path === "admin/policies/routing") return Promise.resolve([]);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      if (path === "admin/clients/cli_11111111-1111-1111-1111-111111111111" && opts?.method === "PATCH") {
        return Promise.resolve({
          ...mockClients[0],
          status: "disabled",
        });
      }
      return Promise.resolve(null);
    });

    render(<ClientsPage />);

    expect(await screen.findByText("acme-customer-support")).toBeInTheDocument();

    // Click Disable on the first client
    const disableButtons = screen.getAllByRole("button", { name: "Disable" });
    fireEvent.click(disableButtons[0]);

    // Confirmation dialog appears
    expect(screen.getByRole("heading", { name: "Disable Client" })).toBeInTheDocument();
    expect(screen.getByText(/Disabling client "acme-customer-support" will immediately reject/i)).toBeInTheDocument();

    // Click confirm in dialog
    const confirmBtn = screen.getByRole("button", { name: "Disable Client" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(proxyFetchSpy).toHaveBeenCalledWith(
        "admin/clients/cli_11111111-1111-1111-1111-111111111111",
        expect.objectContaining({
          method: "PATCH",
          body: { status: "disabled" },
        })
      );
    });
  });

  it("opens keys modal and enforces ONE-TIME raw secret display (UI-006)", async () => {
    const rawSecret = "lg_dev_secret_one_time_token_987654321_abc";

    vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path, opts) => {
      if (path === "admin/clients" && !opts?.method) return Promise.resolve(mockClients);
      if (path === "admin/policies") return Promise.resolve([]);
      if (path === "admin/policies/routing") return Promise.resolve([]);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      if (path === "admin/clients/cli_11111111-1111-1111-1111-111111111111/keys" && !opts?.method) {
        return Promise.resolve(mockKeys);
      }
      if (path === "admin/clients/cli_11111111-1111-1111-1111-111111111111/keys" && opts?.method === "POST") {
        return Promise.resolve({
          id: "key_new",
          client_id: "cli_11111111-1111-1111-1111-111111111111",
          prefix: "lg_dev_newpref",
          role: "client",
          status: "active",
          label: "generated-test-key",
          expires_at: null,
          last_used_at: null,
          key: rawSecret, // Full raw secret token returned once
        });
      }
      return Promise.resolve(null);
    });

    render(<ClientsPage />);

    expect(await screen.findByText("acme-customer-support")).toBeInTheDocument();

    // Open Keys drawer
    const keysButtons = screen.getAllByTitle("Manage API Keys");
    fireEvent.click(keysButtons[0]);

    expect(await screen.findByText("API Keys: acme-customer-support")).toBeInTheDocument();
    expect(screen.getByText("lg_dev_a1b2c3d4...")).toBeInTheDocument();
    expect(screen.getByText("support-bot-key")).toBeInTheDocument();

    // Generate a new key
    fireEvent.change(screen.getByPlaceholderText(/backend-service-key/i), {
      target: { value: "generated-test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Key" }));

    // ONE-TIME SECRET DIALOG MUST APPEAR
    expect(await screen.findByText("API Key Created Successfully")).toBeInTheDocument();
    expect(screen.getByText(/For security reasons, this secret will/i)).toBeInTheDocument();

    const secretInput = screen.getByTestId("one-time-secret-input") as HTMLInputElement;
    expect(secretInput.value).toBe(rawSecret);

    // Test Copy button
    const copyButton = screen.getByTestId("copy-secret-button");
    fireEvent.click(copyButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(rawSecret);

    // Close the secret dialog
    const closeSecretBtn = screen.getByTestId("close-secret-dialog-button");
    fireEvent.click(closeSecretBtn);

    // Verify secret is completely dismissed and gone from DOM
    await waitFor(() => {
      expect(screen.queryByTestId("one-time-secret-input")).not.toBeInTheDocument();
      expect(screen.queryByText(rawSecret)).not.toBeInTheDocument();
    });
  });

  it("revokes an active API key with confirmation dialog", async () => {
    const proxyFetchSpy = vi.spyOn(clientApiModule, "proxyFetch").mockImplementation((path, opts) => {
      if (path === "admin/clients" && !opts?.method) return Promise.resolve(mockClients);
      if (path === "admin/policies") return Promise.resolve([]);
      if (path === "admin/policies/routing") return Promise.resolve([]);
      if (path === "admin/system/mode") return Promise.resolve({ demo_mode: false });
      if (path === "admin/clients/cli_11111111-1111-1111-1111-111111111111/keys") {
        return Promise.resolve(mockKeys);
      }
      if (path === "admin/keys/lg_dev_a1b2c3d4/revoke" && opts?.method === "POST") {
        return Promise.resolve({
          ...mockKeys[0],
          status: "revoked",
        });
      }
      return Promise.resolve(null);
    });

    render(<ClientsPage />);

    expect(await screen.findByText("acme-customer-support")).toBeInTheDocument();

    // Open Keys drawer
    const keysButtons = screen.getAllByTitle("Manage API Keys");
    fireEvent.click(keysButtons[0]);

    expect(await screen.findByText("lg_dev_a1b2c3d4...")).toBeInTheDocument();

    // Click Revoke on the active key
    const revokeBtn = screen.getByRole("button", { name: "Revoke" });
    fireEvent.click(revokeBtn);

    // Confirm dialog
    expect(screen.getByText("Revoke API Key")).toBeInTheDocument();
    expect(screen.getByText(/permanently prevent this key from authorizing future gateway calls/i)).toBeInTheDocument();

    const confirmRevokeBtn = screen.getByRole("button", { name: "Revoke Key" });
    fireEvent.click(confirmRevokeBtn);

    await waitFor(() => {
      expect(proxyFetchSpy).toHaveBeenCalledWith(
        "admin/keys/lg_dev_a1b2c3d4/revoke",
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
