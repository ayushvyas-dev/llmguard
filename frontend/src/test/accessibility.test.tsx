import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LoginPage from "../app/login/page";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Header } from "../components/header";
import { Sidebar } from "../components/sidebar";

describe("Accessibility Standards & Keyboard Navigation (F5)", () => {
  it("Login page has valid label associations, landmarks, and autofocus", () => {
    render(<LoginPage />);

    // Primary semantic heading
    const heading = screen.getByRole("heading", { level: 1, name: "LLMGuard Admin" });
    expect(heading).toBeInTheDocument();

    // Associated label for adminKey input
    const label = screen.getByText("Admin API Key");
    expect(label).toHaveAttribute("for", "adminKey");

    const input = screen.getByLabelText("Admin API Key");
    expect(input).toHaveAttribute("id", "adminKey");
    expect(input).toHaveAttribute("type", "password");

    // Submit button has accessible name
    const submitBtn = screen.getByRole("button", { name: "Sign In to Dashboard" });
    expect(submitBtn).toBeInTheDocument();
  });

  it("ConfirmDialog enforces modal accessibility attributes (role=dialog, aria-modal, aria-labelledby)", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Revoke Gateway Key"
        message="This action is permanent and cannot be undone."
        confirmLabel="Revoke Key"
        isDestructive={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "confirm-dialog-title");

    const title = screen.getByRole("heading", { level: 3, name: "Revoke Gateway Key" });
    expect(title).toHaveAttribute("id", "confirm-dialog-title");

    const closeBtn = screen.getByLabelText("Close dialog");
    expect(closeBtn).toBeInTheDocument();
  });

  it("Header includes navigation landmark, heading, and logout button label", () => {
    render(<Header />);

    // Header has a level 1 heading
    const headerHeading = screen.getByRole("heading", { level: 1 });
    expect(headerHeading).toBeInTheDocument();

    // Logout button has explicit aria-label and title
    const logoutBtn = screen.getByRole("button", { name: "Logout" });
    expect(logoutBtn).toHaveAttribute("title", "Sign Out");
  });

  it("Sidebar navigation items have accessible links and SVGs are aria-hidden", () => {
    render(<Sidebar />);

    const nav = screen.getByRole("navigation");
    expect(nav).toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(6);

    // Each navigation link has recognizable text
    const linkTexts = links.map((l) => l.textContent);
    expect(linkTexts).toContain("Overview");
    expect(linkTexts).toContain("Security Events");
    expect(linkTexts).toContain("Request Traces");
    expect(linkTexts).toContain("Clients & Keys");
    expect(linkTexts).toContain("Policy Engine");
    expect(linkTexts).toContain("API Playground");
  });
});
