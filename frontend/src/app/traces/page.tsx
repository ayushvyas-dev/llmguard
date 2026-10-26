"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  History,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import { proxyFetch } from "@/lib/client-api";

interface TraceListItem {
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
  cache_status: string | null;
  input_chars: number | null;
  output_chars: number | null;
}

interface TracesResponse {
  total: number;
  traces: TraceListItem[];
}

export default function TracesPage() {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const params: Record<string, string | number> = {
          limit: pageSize,
          offset: (page - 1) * pageSize,
        };
        if (statusFilter !== "all") params.status = statusFilter;

        const data = await proxyFetch<TracesResponse>("admin/traces", {
          params,
        });

        let results = data.traces || [];
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          results = results.filter(
            (t) =>
              t.request_id?.toLowerCase().includes(q) ||
              t.correlation_id?.toLowerCase().includes(q)
          );
        }

        if (!ignore) {
          setTraces(results);
          setTotal(data.total || 0);
          setError(null);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load request traces.");
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
  }, [page, pageSize, statusFilter, searchQuery, reloadTrigger]);

  const totalPages = Math.ceil(total / pageSize) || 1;

  // Status badge helper
  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case "success":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "blocked":
        return "bg-red-500/10 text-red-400 border-red-500/20";
      case "error":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      case "cache_hit":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "client_cancelled":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Request Traces</h2>
          <p className="text-sm text-slate-400 mt-1">
            Correlated audit trails, fallback chains, per-attempt telemetry, and security verdicts.
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

      {/* Search & Filter Row */}
      <div className="glass-card rounded-2xl p-4 border border-white/5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 max-w-xl">
          {/* Search box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setReloadTrigger((n) => n + 1)}
              placeholder="Search by Request ID or Correlation ID..."
              className="w-full glass-input rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 font-mono"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by Status"
            className="glass-input rounded-xl px-3 py-2 text-xs text-slate-200 border border-white/10 bg-slate-900 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="success">Success</option>
            <option value="blocked">Blocked</option>
            <option value="error">Error</option>
            <option value="cache_hit">Cache Hit</option>
            <option value="client_cancelled">Cancelled</option>
          </select>
        </div>

        <div className="text-xs text-slate-400">
          Showing <span className="font-semibold text-white">{traces.length}</span> of{" "}
          <span className="font-semibold text-white">{total}</span> total
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Traces Table */}
      <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/60 border-b border-white/5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Request / Correlation ID</th>
                <th className="py-3 px-4">Started At</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Provider & Model</th>
                <th className="py-3 px-4">Latency</th>
                <th className="py-3 px-4">Fallback</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && traces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                    <span>Loading traces...</span>
                  </td>
                </tr>
              ) : traces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <History className="w-8 h-8 text-slate-500 mx-auto mb-2 opacity-60" />
                    <p className="font-medium text-slate-200">No request traces found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Run inference requests through the gateway to populate traces.
                    </p>
                  </td>
                </tr>
              ) : (
                traces.map((t) => (
                  <tr key={t.request_id} className="hover:bg-white/[0.02] transition-colors">
                    {/* IDs (escaped text) */}
                    <td className="py-3 px-4">
                      <div className="font-mono text-xs text-white font-medium truncate max-w-[220px]">
                        {String(t.request_id)}
                      </div>
                      <div className="font-mono text-[10px] text-slate-500 truncate max-w-[220px]">
                        corr: {String(t.correlation_id || "-")}
                      </div>
                    </td>

                    {/* Timestamp */}
                    <td className="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">
                      {t.started_at ? new Date(t.started_at).toLocaleTimeString() : "-"}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border uppercase ${getStatusBadge(
                          t.status
                        )}`}
                      >
                        {String(t.status)}
                      </span>
                    </td>

                    {/* Provider & Model */}
                    <td className="py-3 px-4 text-xs text-slate-300">
                      <div className="font-medium text-white">{String(t.provider || "-")}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {String(t.provider_model || "-")}
                      </div>
                    </td>

                    {/* Latency */}
                    <td className="py-3 px-4 text-xs font-mono text-slate-300">
                      {t.latency_ms !== null ? `${t.latency_ms}ms` : "-"}
                    </td>

                    {/* Fallback Used */}
                    <td className="py-3 px-4 text-xs">
                      {t.fallback_used ? (
                        <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                          <Zap className="w-3.5 h-3.5" />
                          <span>Fallback</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Direct</span>
                      )}
                    </td>

                    {/* Action link */}
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/traces/${encodeURIComponent(t.request_id)}`}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 text-xs font-medium border border-indigo-500/20 transition-all inline-block"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-4 bg-slate-900/40 border-t border-white/5 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Page <span className="font-semibold text-white">{page}</span> of{" "}
            <span className="font-semibold text-white">{totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg bg-slate-800 border border-white/10 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg bg-slate-800 border border-white/10 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
