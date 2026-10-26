"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Code2,
  Database,
  History,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { proxyFetch } from "@/lib/client-api";

interface TraceEvent {
  type: string;
  timestamp: number;
  duration_ms: number;
  outcome: string;
  attributes?: Record<string, unknown>;
}

interface TraceDetail {
  request_id: string;
  correlation_id: string;
  client_id: string | null;
  started_at: string | null;
  status: string;
  http_status: number;
  error_code: string | null;
  provider: string | null;
  provider_model: string | null;
  fallback_used: boolean;
  retry_count: number;
  latency_ms: number | null;
  security_decision: string | null;
  risk_score: number | null;
  policy_version: number;
  cache_status: string | null;
  prompt_hash: string | null;
  input_chars: number | null;
  output_chars: number | null;
  events: TraceEvent[];
  content_preview: string | null;
  content_expires_at: string | null;
  created_at: string | null;
}

export default function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolvedParams =
    params && typeof (params as unknown as Promise<{ id: string }>).then === "function"
      ? use(params as Promise<{ id: string }>)
      : (params as { id: string });
  const id = resolvedParams?.id || "";
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let ignore = false;

    async function load() {
      try {
        const data = await proxyFetch<TraceDetail>(`admin/traces/${encodeURIComponent(id)}`);
        if (!ignore) {
          setTrace(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load trace details.");
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
  }, [id]);

  const getEventIcon = (type: string) => {
    switch (type) {
      case "request_received":
      case "response_sent":
        return <Server className="w-4 h-4 text-blue-400" />;
      case "auth_check":
        return <Lock className="w-4 h-4 text-emerald-400" />;
      case "ratelimit_check":
        return <Clock className="w-4 h-4 text-cyan-400" />;
      case "security_input":
      case "security_output":
        return <ShieldCheck className="w-4 h-4 text-indigo-400" />;
      case "cache_lookup":
        return <Database className="w-4 h-4 text-purple-400" />;
      case "route_select":
      case "provider_attempt":
        return <Zap className="w-4 h-4 text-amber-400" />;
      case "usage_recorded":
        return <Code2 className="w-4 h-4 text-slate-400" />;
      default:
        return <History className="w-4 h-4 text-slate-400" />;
    }
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome?.toLowerCase()) {
      case "ok":
      case "success":
      case "hit":
      case "allow":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "blocked":
      case "block":
      case "error":
      case "miss":
        return outcome === "miss"
          ? "text-slate-400 bg-slate-800 border-white/5"
          : "text-red-400 bg-red-500/10 border-red-500/20";
      default:
        return "text-slate-300 bg-slate-800 border-white/10";
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center space-y-3">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-400" />
        <p className="text-slate-400 text-sm">Loading trace timeline for {id}...</p>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="space-y-6">
        <Link
          href="/traces"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to traces</span>
        </Link>
        <div className="p-8 rounded-2xl glass-card border border-red-500/20 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <h3 className="text-lg font-bold text-white">Trace Not Found</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">{error || "Unable to find the requested trace."}</p>
        </div>
      </div>
    );
  }

  // Check if trace exhibits truncation
  const hasTruncatedEvents = trace.events?.some((e) => e.type === "trace_truncated");

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back navigation */}
      <div>
        <Link
          href="/traces"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to traces</span>
        </Link>
      </div>

      {/* Trace Overview Header Card */}
      <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Trace Details
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  trace.status === "success"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : trace.status === "blocked"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-slate-700 text-slate-200 border-slate-600"
                }`}
              >
                {String(trace.status)}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                HTTP {trace.http_status}
              </span>
            </div>
            <h2 className="text-xl font-mono font-bold text-white break-all">{String(trace.request_id)}</h2>
            <p className="text-xs font-mono text-slate-500">
              Correlation ID: {String(trace.correlation_id || "-")}
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <div>
              <div className="text-[11px] text-slate-500 uppercase font-semibold">Total Latency</div>
              <div className="text-lg font-mono font-bold text-white">
                {trace.latency_ms !== null ? `${trace.latency_ms}ms` : "-"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 uppercase font-semibold">Provider / Model</div>
              <div className="text-sm font-medium text-slate-200">
                {String(trace.provider || "-")} / <span className="font-mono text-xs">{String(trace.provider_model || "-")}</span>
              </div>
            </div>
            {trace.fallback_used && (
              <div className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                <span>Fallback Active</span>
              </div>
            )}
          </div>
        </div>

        {/* Security & Cache Overview Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1">
            <span className="text-slate-500 font-medium">Security Decision</span>
            <div className="font-semibold capitalize text-slate-200">
              {String(trace.security_decision || "N/A")}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1">
            <span className="text-slate-500 font-medium">Risk Score</span>
            <div className="font-mono font-semibold text-slate-200">
              {trace.risk_score !== null ? Number(trace.risk_score).toFixed(2) : "0.00"}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1">
            <span className="text-slate-500 font-medium">Cache Status</span>
            <div className="font-semibold uppercase text-slate-200">
              {String(trace.cache_status || "bypass")}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1">
            <span className="text-slate-500 font-medium">Policy Version</span>
            <div className="font-mono font-semibold text-slate-200">
              v{trace.policy_version || 1}
            </div>
          </div>
        </div>
      </div>

      {/* Truncated Trace Alert Banner */}
      {hasTruncatedEvents && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            This trace reached the telemetry buffer size limit; later events were truncated by system configuration.
          </span>
        </div>
      )}

      {/* Event Timeline */}
      <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-6">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-400" />
            <span>Lifecycle Event Timeline</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Chronological breakdown of each step taken by the gateway during this request.
          </p>
        </div>

        {trace.events && trace.events.length > 0 ? (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
            {trace.events.map((ev, index) => (
              <div key={index} className="relative group">
                {/* Timeline node icon */}
                <div className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                </div>

                <div className="p-4 rounded-xl bg-slate-900/70 border border-white/5 space-y-2 hover:border-white/10 transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {getEventIcon(ev.type)}
                      <span className="font-mono text-xs font-bold text-white capitalize">
                        {String(ev.type).replaceAll("_", " ")}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${getOutcomeColor(ev.outcome)}`}>
                        {String(ev.outcome)}
                      </span>
                      <span className="font-mono text-slate-400 text-[11px]">
                        +{ev.duration_ms}ms
                      </span>
                    </div>
                  </div>

                  {/* Attributes details (safely escaped text) */}
                  {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                    <div className="pt-2 border-t border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                      {Object.entries(ev.attributes).map(([k, v]) => (
                        <div key={k} className="text-slate-400 truncate">
                          <span className="text-slate-500">{k}: </span>
                          <span className="text-slate-200">
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-500">
            No detailed events recorded for this trace.
          </div>
        )}
      </div>

      {/* Content Preview Box (Strictly Escaped Text - No XSS) */}
      <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-white">Sanitized Content Preview</h3>
          </div>
          {trace.content_expires_at && (
            <span className="text-[10px] text-slate-500 font-mono">
              Retention expires: {new Date(trace.content_expires_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <pre className="p-4 rounded-xl bg-slate-950/90 border border-white/5 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-60 leading-relaxed">
          {trace.content_preview
            ? String(trace.content_preview)
            : "[Content storage was not enabled for this request or prompt was blocked by policy]"}
        </pre>
      </div>
    </div>
  );
}
