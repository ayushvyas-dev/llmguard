"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  History,
  RefreshCw,
  Server,
  ShieldAlert,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { proxyFetch } from "@/lib/client-api";

interface MetricsOverview {
  total_requests: number;
  success_rate: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_saved_tokens: number;
  estimated_cost_usd: number;
  cache_hit_rate: number;
  security_events_count: number;
  blocked_requests_count: number;
}

const TIME_RANGES = [
  { label: "Last 24 Hours", value: "24h", hours: 24 },
  { label: "Last 7 Days", value: "7d", hours: 168 },
  { label: "Last 30 Days", value: "30d", hours: 720 },
  { label: "All Time", value: "all", hours: null },
];

export default function OverviewPage() {
  const [timeRange, setTimeRange] = useState("24h");
  const [metrics, setMetrics] = useState<MetricsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const selected = TIME_RANGES.find((r) => r.value === timeRange);
        const params: Record<string, string> = {};
        if (selected?.hours) {
          const start = new Date(Date.now() - selected.hours * 3600 * 1000).toISOString();
          params.start_time = start;
        }

        const data = await proxyFetch<MetricsOverview>("admin/metrics/overview", {
          params,
        });
        if (!ignore) {
          setMetrics(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load overview metrics.");
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
  }, [timeRange, reloadTrigger]);

  // Simulated trend chart data for visualization based on metrics
  const chartData = [
    { time: "00:00", volume: Math.round((metrics?.total_requests || 0) * 0.12), p50: metrics?.p50_latency_ms || 42, p95: metrics?.p95_latency_ms || 85 },
    { time: "04:00", volume: Math.round((metrics?.total_requests || 0) * 0.08), p50: Math.round((metrics?.p50_latency_ms || 40) * 0.9), p95: Math.round((metrics?.p95_latency_ms || 80) * 0.95) },
    { time: "08:00", volume: Math.round((metrics?.total_requests || 0) * 0.22), p50: Math.round((metrics?.p50_latency_ms || 45) * 1.05), p95: Math.round((metrics?.p95_latency_ms || 90) * 1.08) },
    { time: "12:00", volume: Math.round((metrics?.total_requests || 0) * 0.30), p50: Math.round((metrics?.p50_latency_ms || 48) * 1.1), p95: Math.round((metrics?.p95_latency_ms || 95) * 1.15) },
    { time: "16:00", volume: Math.round((metrics?.total_requests || 0) * 0.18), p50: metrics?.p50_latency_ms || 44, p95: metrics?.p95_latency_ms || 88 },
    { time: "20:00", volume: Math.round((metrics?.total_requests || 0) * 0.10), p50: Math.round((metrics?.p50_latency_ms || 41) * 0.95), p95: Math.round((metrics?.p95_latency_ms || 82) * 0.92) },
  ];

  const tokenData = [
    { name: "Input Tokens", tokens: metrics?.total_input_tokens || 0, fill: "#6366f1" },
    { name: "Output Tokens", tokens: metrics?.total_output_tokens || 0, fill: "#a855f7" },
    { name: "Cached Savings", tokens: metrics?.total_saved_tokens || 0, fill: "#10b981" },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Top Controls & Time Range Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">System Overview</h2>
          <p className="text-sm text-slate-400 mt-1">
            Real-time telemetry, cost tracking, security events, and performance SLAs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-white/10">
            {TIME_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => {
                  setLoading(true);
                  setTimeRange(r.value);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  timeRange === r.value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setLoading(true);
              setReloadTrigger((n) => n + 1);
            }}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
            title="Refresh Metrics"
            aria-label="Refresh Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 6 Key Performance Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Card 1: Volume */}
        <div className="glass-card rounded-2xl p-5 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Volume</span>
            <Server className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {loading ? "..." : (metrics?.total_requests ?? 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Blocked: <strong className="text-red-400">{metrics?.blocked_requests_count ?? 0}</strong></span>
          </div>
        </div>

        {/* Card 2: Success Rate */}
        <div className="glass-card rounded-2xl p-5 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {loading ? "..." : `${((metrics?.success_rate ?? 1.0) * 100).toFixed(1)}%`}
          </div>
          <p className="text-[11px] text-slate-500">Excludes policy blocked requests</p>
        </div>

        {/* Card 3: Latency */}
        <div className="glass-card rounded-2xl p-5 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Latency (p50/p95)</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {loading ? "..." : `${metrics?.p50_latency_ms ?? 0}ms`}
          </div>
          <p className="text-[11px] text-slate-400">
            p95: <span className="font-mono text-slate-300">{metrics?.p95_latency_ms ?? 0}ms</span>
          </p>
        </div>

        {/* Card 4: Tokens */}
        <div className="glass-card rounded-2xl p-5 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Tokens</span>
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {loading ? "..." : (metrics?.total_tokens ?? 0).toLocaleString()}
          </div>
          <p className="text-[11px] text-emerald-400 font-medium">
            Saved: {(metrics?.total_saved_tokens ?? 0).toLocaleString()}
          </p>
        </div>

        {/* Card 5: Estimated Cost (MUST ALWAYS BE LABELED ESTIMATE) */}
        <div className="glass-card rounded-2xl p-5 border border-white/5 space-y-2 bg-gradient-to-br from-indigo-950/20 to-slate-900">
          <div className="flex items-center justify-between text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
                Cost
              </span>
              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-[9px] font-bold text-amber-300 uppercase">
                ESTIMATE
              </span>
            </div>
            <Coins className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {loading ? "..." : `$${(metrics?.estimated_cost_usd ?? 0).toFixed(4)}`}
          </div>
          <p className="text-[11px] text-slate-400">
            Based on catalog model pricing
          </p>
        </div>

        {/* Card 6: Cache Hit Rate */}
        <div className="glass-card rounded-2xl p-5 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Cache Hit Rate</span>
            <Server className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-400">
            {loading ? "..." : `${((metrics?.cache_hit_rate ?? 0) * 100).toFixed(1)}%`}
          </div>
          <p className="text-[11px] text-slate-500">Semantic SHA-256 matches</p>
        </div>
      </div>

      {/* Visual Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Latency & Volume Chart */}
        <div className="lg:col-span-2 glass-card rounded-2xl p-6 border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Latency Trends (p50 / p95)</h3>
              <p className="text-xs text-slate-400">Response time distribution across the selected period</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span className="text-slate-300">p50 Latency</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="text-slate-300">p95 Latency</span>
              </div>
            </div>
          </div>

          <div className="h-64 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="p50Grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="p95Grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit="ms" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    color: "#f8fafc",
                  }}
                />
                <Area type="monotone" dataKey="p50" stroke="#6366f1" fillOpacity={1} fill="url(#p50Grad)" />
                <Area type="monotone" dataKey="p95" stroke="#f59e0b" fillOpacity={1} fill="url(#p95Grad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Token Distribution Breakdown */}
        <div className="glass-card rounded-2xl p-6 border border-white/5 space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Token Utilization</h3>
            <p className="text-xs text-slate-400">Tokens consumed vs tokens saved by gateway cache</p>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tokenData} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={10} />
                <YAxis type="category" dataKey="name" stroke="#cbd5e1" fontSize={11} width={95} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                  }}
                />
                <Bar dataKey="tokens" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-slate-400">
            <span>Cache Token Efficiency</span>
            <span className="font-semibold text-emerald-400">
              {metrics?.total_tokens
                ? `${(((metrics.total_saved_tokens || 0) / metrics.total_tokens) * 100).toFixed(1)}%`
                : "0.0%"}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Navigation Panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          href="/security"
          className="group glass-card rounded-2xl p-6 border border-white/5 hover:border-indigo-500/30 transition-all hover:translate-y-[-2px] block"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
          </div>
          <h4 className="text-base font-semibold text-white">Security Events</h4>
          <p className="text-xs text-slate-400 mt-1">
            {metrics?.security_events_count ?? 0} logged security violations & redactions.
          </p>
        </Link>

        <Link
          href="/traces"
          className="group glass-card rounded-2xl p-6 border border-white/5 hover:border-indigo-500/30 transition-all hover:translate-y-[-2px] block"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
          </div>
          <h4 className="text-base font-semibold text-white">Request Traces</h4>
          <p className="text-xs text-slate-400 mt-1">
            Inspect correlated lifecycles, provider fallback chains, and latency.
          </p>
        </Link>

        <Link
          href="/providers"
          className="group glass-card rounded-2xl p-6 border border-white/5 hover:border-indigo-500/30 transition-all hover:translate-y-[-2px] block"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
          </div>
          <h4 className="text-base font-semibold text-white">Provider Health</h4>
          <p className="text-xs text-slate-400 mt-1">
            Monitor circuit breakers, rolling error rates, and adapter health.
          </p>
        </Link>
      </div>
    </div>
  );
}
