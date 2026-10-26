"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navItems: NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "API Playground", href: "/playground", icon: Terminal },
  { title: "Security Events", href: "/security", icon: ShieldAlert },
  { title: "Request Traces", href: "/traces", icon: History },
  { title: "Clients & Keys", href: "/clients", icon: KeyRound },
  { title: "Policy Engine", href: "/policies", icon: Sliders },
  { title: "Provider Health", href: "/providers", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <aside className="w-64 glass-panel border-r border-white/5 flex flex-col h-screen fixed inset-y-0 left-0 z-30">
      {/* Brand logo */}
      <div className="h-16 flex items-center px-6 border-b border-white/5 gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 badge-glow-indigo">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <span className="font-bold text-white text-base tracking-tight">LLMGuard</span>
          <span className="text-[10px] text-indigo-400 font-mono block leading-none mt-0.5">GATEWAY v0.1.0</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          Control Plane
        </div>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all group",
                isActive
                  ? "bg-indigo-600/15 text-indigo-300 border border-indigo-500/25 shadow-sm shadow-indigo-500/10"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={cn(
                    "w-4 h-4 transition-colors",
                    isActive ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-300"
                  )}
                />
                <span>{item.title}</span>
              </div>
              {isActive && (
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400" />
              )}
            </a>
          );
        })}
      </nav>

      {/* Footer / System Status & Logout */}
      <div className="p-4 border-t border-white/5 space-y-3">
        {/* Gateway Pulse */}
        <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-emerald-300">Gateway Online</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">127.0.0.1:8000</span>
        </div>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out Admin</span>
        </button>
      </div>
    </aside>
  );
}
