"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, KeyRound, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { setClientCsrfToken } from "@/lib/client-api";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  const [adminKey, setAdminKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!adminKey.trim()) {
      setError("Please enter your admin API key.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminKey: adminKey.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed. Check your admin API key.");
      }

      if (typeof window !== "undefined") {
        sessionStorage.removeItem("llmguard_demo_session");
        sessionStorage.removeItem("llmguard_demo_banner_seen");
      }

      if (data.csrfToken) {
        setClientCsrfToken(data.csrfToken);
      }

      router.push(from);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setError(null);
    setDemoLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isDemo: true,
          adminKey: "lga_dev_demo0000_recruiter_demo_access_key",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize demo access.");
      }

      if (typeof window !== "undefined") {
        sessionStorage.setItem("llmguard_demo_session", "true");
        sessionStorage.removeItem("llmguard_demo_banner_seen");
      }

      if (data.csrfToken) {
        setClientCsrfToken(data.csrfToken);
      }

      router.push(from);
      router.refresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred entering demo mode."
      );
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#090d16] p-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md glass-card rounded-2xl p-8 shadow-2xl relative z-10 border border-white/10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-4 badge-glow-indigo">
            <ShieldCheck className="w-7 h-7 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">LLMGuard Admin</h1>
          <p className="text-sm text-slate-400 mt-2">
            Enter your admin key to access the gateway control plane
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3 animate-fade-in">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="leading-snug">{error}</div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="adminKey"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2"
            >
              Admin API Key
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <KeyRound className="w-4 h-4" />
              </div>
              <input
                id="adminKey"
                type={showKey ? "text" : "password"}
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Enter admin key..."
                className="w-full glass-input rounded-xl pl-10 pr-12 py-3 text-sm focus:border-indigo-500 transition-all font-mono"
                disabled={loading || demoLoading}
                autoFocus
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200"
                tabIndex={-1}
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Keys are verified server-side and stored in an encrypted httpOnly cookie.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || demoLoading}
            className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Verifying credentials...</span>
              </>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-[#0e1422] px-3 text-slate-400 font-medium">Or explore as reviewer</span>
          </div>
        </div>

        {/* 1-Click Recruiter / Demo Access Button */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleDemoLogin}
            disabled={loading || demoLoading}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600/20 via-teal-600/20 to-cyan-600/20 hover:from-emerald-600/30 hover:via-teal-600/30 hover:to-cyan-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 hover:text-emerald-200 font-medium text-sm transition-all shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group"
          >
            {demoLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Loading Demo Gateway...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                <span>Explore Live Demo (1-Click Access)</span>
              </>
            )}
          </button>
        </div>

        {/* Security Notice */}
        <div className="mt-8 pt-6 border-t border-white/5 text-center">
          <p className="text-xs text-slate-500">
            Protected by LLMGuard Policy Engine &bull; Strictly Audited Access
          </p>
        </div>
      </div>
    </div>
  );
}
