"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
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
  const pathname = usePathname();
  const isOverviewPage = pathname === "/" || pathname === "/overview";
  const { isDemoMode } = useDemoMode();
  const [isVisible, setIsVisible] = useState(true);
  const [alreadyShown] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        return sessionStorage.getItem("llmguard_demo_banner_seen") === "true";
      } catch {
        return false;
      }
    }
    return false;
  });

  useEffect(() => {
    if (!isDemoMode || !isOverviewPage || alreadyShown) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
      try {
        sessionStorage.setItem("llmguard_demo_banner_seen", "true");
      } catch {
        // ignore
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [isDemoMode, isOverviewPage, alreadyShown]);

  const handleDismiss = () => {
    setIsVisible(false);
    try {
      sessionStorage.setItem("llmguard_demo_banner_seen", "true");
    } catch {
      // ignore
    }
  };

  if (!isDemoMode || !isOverviewPage || !isVisible || alreadyShown) {
    return null;
  }

  return (
    <div
      role="alert"
      className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2.5 flex items-center justify-between text-amber-300 text-xs sm:text-sm font-medium sticky top-16 z-10 backdrop-blur-md transition-all animate-fade-in"
    >
      <div className="flex items-center justify-between max-w-7xl mx-auto w-full gap-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>Demo Mode Active:</strong> Administrative mutations (creating/editing clients, keys, and policies) are disabled. The gateway is operating in read-only and playground mode.
          </span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 hover:bg-amber-500/20 rounded-md transition-colors text-amber-400/80 hover:text-amber-200 cursor-pointer shrink-0"
          aria-label="Dismiss banner"
          title="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
