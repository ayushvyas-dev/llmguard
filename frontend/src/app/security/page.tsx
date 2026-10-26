"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { proxyFetch } from "@/lib/client-api";

interface SecurityEventItem {
  id: string;
  request_id: string;
  client_id: string | null;
  direction: string;
  category: string;
  action: string;
  detector: string;
  score: number;
  reason_codes: string[];
  policy_version: number;
  created_at: string | null;
}

interface SecurityEventsResponse {
  total: number;
  events: SecurityEventItem[];
}

export default function SecurityEventsPage() {
  const [events, setEvents] = useState<SecurityEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Filters
  const [category, setCategory] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
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
        if (category !== "all") params.category = category;
        if (action !== "all") params.action = action;

        const data = await proxyFetch<SecurityEventsResponse>("admin/security/events", {
          params,
        });
        if (!ignore) {
          setEvents(data.events || []);
          setTotal(data.total || 0);
          setError(null);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load security events.");
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
  }, [category, action, page, pageSize, reloadTrigger]);

  const totalPages = Math.ceil(total / pageSize) || 1;

  // Category badge helper
  const getCategoryBadge = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "prompt_injection":
        return "bg-red-500/10 text-red-400 border-red-500/20";
      case "jailbreak":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "pii":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "secrets":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  // Action badge helper
  const getActionBadge = (act: string) => {
    switch (act.toLowerCase()) {
      case "block":
        return "bg-red-500 text-white font-bold";
      case "redact":
        return "bg-indigo-600 text-white font-medium";
      case "warn":
        return "bg-amber-500 text-black font-semibold";
      default:
        return "bg-slate-700 text-slate-200";
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Security Events</h2>
          <p className="text-sm text-slate-400 mt-1">
            Real-time inspection logs, prompt injection detections, PII masking, and enforcement actions.
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

      {/* Filter Row */}
      <div className="glass-card rounded-2xl p-4 border border-white/5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
            <span>Filters:</span>
          </div>

          {/* Category Filter */}
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by Category"
            className="glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 border border-white/10 focus:border-indigo-500 bg-slate-900 cursor-pointer"
          >
            <option value="all">All Categories</option>
            <option value="prompt_injection">Prompt Injection</option>
            <option value="jailbreak">Jailbreak Heuristics</option>
            <option value="pii">Sensitive PII</option>
            <option value="secrets">Secret Leakage</option>
          </select>

          {/* Action Filter */}
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by Action"
            className="glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 border border-white/10 focus:border-indigo-500 bg-slate-900 cursor-pointer"
          >
            <option value="all">All Actions</option>
            <option value="block">Blocked</option>
            <option value="redact">Redacted</option>
            <option value="warn">Warned</option>
            <option value="log">Logged</option>
          </select>
        </div>

        <div className="text-xs text-slate-400">
          Showing <span className="font-semibold text-white">{events.length}</span> of{" "}
          <span className="font-semibold text-white">{total}</span> events
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Events Table */}
      <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/60 border-b border-white/5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Request ID</th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Detector & Reason Codes</th>
                <th className="py-3 px-4">Risk Score</th>
                <th className="py-3 px-4 text-right">Trace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                    <span>Loading security events...</span>
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                    <p className="font-medium text-slate-200">No security events found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      No violations match your current filter selection.
                    </p>
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr key={e.id} className="hover:bg-white/[0.02] transition-colors">
                    {/* Request ID (strictly escaped string) */}
                    <td className="py-3 px-4 font-mono text-xs text-slate-300">
                      {String(e.request_id)}
                    </td>

                    {/* Timestamp */}
                    <td className="py-3 px-4 text-xs text-slate-400">
                      {e.created_at ? new Date(e.created_at).toLocaleTimeString() : "-"}
                    </td>

                    {/* Category */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border uppercase ${getCategoryBadge(
                          e.category
                        )}`}
                      >
                        {String(e.category).replace("_", " ")}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] uppercase ${getActionBadge(
                          e.action
                        )}`}
                      >
                        {String(e.action)}
                      </span>
                    </td>

                    {/* Detector & Reason Codes (strictly escaped text, never HTML) */}
                    <td className="py-3 px-4 max-w-xs">
                      <div className="font-mono text-xs text-slate-200 truncate">
                        {String(e.detector)}
                      </div>
                      {e.reason_codes && e.reason_codes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {e.reason_codes.map((code, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300 border border-white/5"
                            >
                              {String(code)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Risk Score */}
                    <td className="py-3 px-4 text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className={e.score > 0.5 ? "text-red-400 font-bold" : "text-slate-300"}>
                          {Number(e.score).toFixed(2)}
                        </span>
                        <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              e.score > 0.5 ? "bg-red-500" : "bg-indigo-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, e.score * 100))}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Trace Action */}
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/traces/${encodeURIComponent(e.request_id)}`}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                      >
                        View Trace &rarr;
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
