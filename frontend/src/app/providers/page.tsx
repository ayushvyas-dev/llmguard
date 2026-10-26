"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Cpu,
  RefreshCw,
  Server,
  ZapOff,
} from "lucide-react";
import { proxyFetch } from "@/lib/client-api";

interface ModelHealth {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  success_rate: number;
  avg_latency_ms: number;
  circuit_state: "closed" | "half_open" | "open" | string;
  error_counts: Record<string, number>;
}

type ProviderHealthData = Record<string, Record<string, ModelHealth>>;

export default function ProvidersHealthPage() {
  const [healthData, setHealthData] = useState<ProviderHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const data = await proxyFetch<ProviderHealthData>("admin/providers/health");
        if (!ignore) {
          setHealthData(data || {});
          setError(null);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load provider health.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [reloadTrigger]);

  const getCircuitBadge = (state: string) => {
    switch (state?.toLowerCase()) {
      case "closed":
        return {
          text: "Closed (Healthy)",
          classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
        };
      case "half_open":
        return {
          text: "Half-Open (Probing)",
          classes: "bg-amber-500/10 text-amber-400 border-amber-500/20",
          icon: <Activity className="w-3.5 h-3.5 text-amber-400" />,
        };
      case "open":
        return {
          text: "Open (Tripped)",
          classes: "bg-red-500/10 text-red-400 border-red-500/20",
          icon: <ZapOff className="w-3.5 h-3.5 text-red-400" />,
        };
      default:
        return {
          text: state,
          classes: "bg-slate-700 text-slate-300 border-slate-600",
          icon: <Cpu className="w-3.5 h-3.5 text-slate-400" />,
        };
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Provider Health & Circuits</h2>
          <p className="text-sm text-slate-400 mt-1">
            Real-time circuit breaker status, error categorization, and upstream latency for each provider adapter.
          </p>
        </div>

        <button
          onClick={() => {
            setLoading(true);
            setReloadTrigger((n) => n + 1);
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-medium cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && !healthData ? (
        <div className="py-24 text-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-400" />
          <p className="text-slate-400 text-sm">Checking provider circuits and adapters...</p>
        </div>
      ) : healthData && Object.keys(healthData).length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center border border-white/5 space-y-3">
          <Server className="w-8 h-8 text-slate-500 mx-auto" />
          <h3 className="text-base font-semibold text-white">No Providers Registered</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No active provider health records available in the gateway router.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(healthData || {}).map(([providerName, models]) => (
            <div key={providerName} className="glass-card rounded-2xl p-6 border border-white/5 space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white capitalize">{providerName} Provider</h3>
                    <p className="text-xs text-slate-400">
                      {Object.keys(models).length} configured model endpoint{Object.keys(models).length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid of Models under this Provider */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(models).map(([modelId, health]) => {
                  const badge = getCircuitBadge(health.circuit_state);
                  return (
                    <div
                      key={modelId}
                      className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-3 hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white truncate max-w-[160px]">
                          {modelId}
                        </span>
                        <div
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.classes}`}
                        >
                          {badge.icon}
                          <span>{badge.text}</span>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Success Rate</div>
                          <div className={`font-bold ${health.success_rate < 0.9 ? "text-amber-400" : "text-emerald-400"}`}>
                            {(health.success_rate * 100).toFixed(1)}%
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Latency</div>
                          <div className="font-mono text-slate-300">
                            {health.avg_latency_ms.toFixed(1)}ms
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Calls</div>
                          <div className="font-mono text-slate-200">{health.total_requests}</div>
                        </div>

                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Failures</div>
                          <div className={`font-mono ${health.failed_requests > 0 ? "text-red-400 font-bold" : "text-slate-400"}`}>
                            {health.failed_requests}
                          </div>
                        </div>
                      </div>

                      {/* Error breakdown tags */}
                      {health.error_counts && Object.keys(health.error_counts).length > 0 && (
                        <div className="pt-2 border-t border-white/5 space-y-1">
                          <span className="text-[10px] text-slate-500 uppercase font-semibold block">
                            Error Categories
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(health.error_counts).map(([errType, count]) => (
                              <span
                                key={errType}
                                className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-mono"
                              >
                                {errType}: {count}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
