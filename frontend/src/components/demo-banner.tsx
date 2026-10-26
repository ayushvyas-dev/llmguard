"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { proxyFetch } from "@/lib/client-api";

export function useDemoMode() {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function checkMode() {
      try {
        const res = await proxyFetch<{ demo_mode: boolean }>("admin/system/mode");
        if (!ignore && res && typeof res.demo_mode === "boolean") {
          setIsDemoMode(res.demo_mode);
        }
      } catch {
        // Silently default to false if system mode check fails
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }
    checkMode();
    return () => {
      ignore = true;
    };
  }, []);

  return { isDemoMode, isLoading };
}

export function DemoBanner() {
  const { isDemoMode } = useDemoMode();

  if (!isDemoMode) {
    return null;
  }

  return (
    <div
      role="alert"
      className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2.5 flex items-center justify-between text-amber-300 text-xs sm:text-sm font-medium sticky top-16 z-10 backdrop-blur-md"
    >
      <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          <strong>Demo Mode Active:</strong> Administrative mutations (creating/editing clients, keys, and policies) are disabled. The gateway is operating in read-only and playground mode.
        </span>
      </div>
    </div>
  );
}
