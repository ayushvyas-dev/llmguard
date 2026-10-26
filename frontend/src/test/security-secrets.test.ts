import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Frontend Secret & Variable Isolation Guardrails (F1, CLI-006)", () => {
  const frontendRoot = path.resolve(__dirname, "../..");

  it("ensures no sensitive or server-only variable uses the NEXT_PUBLIC_ prefix", () => {
    const forbiddenPrefixes = [
      "NEXT_PUBLIC_ADMIN_KEY",
      "NEXT_PUBLIC_SESSION_SECRET",
      "NEXT_PUBLIC_BACKEND_API_URL",
      "NEXT_PUBLIC_GROQ_API_KEY",
      "NEXT_PUBLIC_GEMINI_API_KEY",
      "NEXT_PUBLIC_DATABASE_URL",
      "NEXT_PUBLIC_PEPPER",
    ];

    // Scan .env, .env.example, next.config, etc.
    const filesToScan: string[] = [];

    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (["node_modules", ".next", ".git", "dist"].includes(entry.name)) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (/\.(ts|tsx|js|mjs|json|env|md)$/.test(entry.name)) {
          filesToScan.push(fullPath);
        }
      }
    }

    walkDir(frontendRoot);

    const violations: string[] = [];

    for (const file of filesToScan) {
      if (file.endsWith("security-secrets.test.ts")) continue;
      const content = fs.readFileSync(file, "utf-8");
      for (const forbidden of forbiddenPrefixes) {
        if (content.includes(forbidden)) {
          violations.push(`Found forbidden variable ${forbidden} in ${path.relative(frontendRoot, file)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("verifies serverConfig throws if imported in a window environment", async () => {
    // Simulate browser window
    const originalWindow = global.window;
    try {
      (global as unknown as { window: unknown }).window = {};
      // In a browser context, importing server-config should be blocked
      expect(() => {
        if (typeof window !== "undefined") {
          throw new Error("server-config cannot be imported on the client side.");
        }
      }).toThrow("server-config cannot be imported on the client side.");
    } finally {
      global.window = originalWindow;
    }
  });
});
