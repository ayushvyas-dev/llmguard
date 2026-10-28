"use client";

import { usePathname, useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { useDemoMode } from "./demo-banner";

interface HeaderProps {
  title?: string;
}

const titleMap: Record<string, string> = {
  "/": "Overview & Gateway Metrics",
  "/security": "Security Events & Guardrails",
  "/traces": "Request Traces & Audit Logs",
  "/clients": "Clients & API Key Governance",
  "/policies": "Policy Engine & Rule Config",
  "/providers": "Provider Health & Circuit Breakers",
};

export function Header({ title }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const displayTitle = title || titleMap[pathname] || "Dashboard";
  const { isDemoMode } = useDemoMode();

  const handleLogout = async () => {
    try {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("llmguard_demo_session");
      }
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <header className="h-16 glass-panel border-b border-white/5 flex items-center justify-between px-8 sticky top-0 z-20">
      <div>
        <h1 className="text-lg font-bold text-white tracking-tight">{displayTitle}</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Environment Pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span>PRODUCTION</span>
        </div>

        {/* User Session Badge */}
        <div className="flex items-center gap-2 pl-2 border-l border-white/10">
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-slate-300">
            <User className="w-4 h-4" />
          </div>
          <div className="hidden sm:block text-left">
            <div className="text-xs font-medium text-slate-200">
              {isDemoMode ? "Demo User" : "Admin User"}
            </div>
            <div className="text-[10px] text-slate-500">
              {isDemoMode ? "Demo Access" : "Super Administrator"}
            </div>
          </div>
        </div>

        {/* Quick Logout */}
        <button
          onClick={handleLogout}
          aria-label="Logout"
          className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
