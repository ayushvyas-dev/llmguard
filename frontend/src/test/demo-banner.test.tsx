import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBanner } from "../components/demo-banner";
import * as clientApiModule from "../lib/client-api";

describe("Demo Mode Banner (UI-009)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render banner when demo mode is false", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue({ demo_mode: false });

    render(<DemoBanner />);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("renders amber banner when demo mode is true", async () => {
    vi.spyOn(clientApiModule, "proxyFetch").mockResolvedValue({ demo_mode: true });

    render(<DemoBanner />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Demo Mode Active:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Administrative mutations \(creating\/editing clients, keys, and policies\) are disabled/i)
    ).toBeInTheDocument();
  });
});
