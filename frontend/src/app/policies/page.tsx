"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  Check,
  Plus,
  RefreshCw,
  Shield,
  Sliders,
  Trash2,
  X,
} from "lucide-react";
import { z } from "zod";
import { proxyFetch } from "@/lib/client-api";
import { useDemoMode } from "@/components/demo-banner";
import { EmptyState } from "@/components/empty-state";

// --- Types ---

interface SecurityPolicyItem {
  id: string;
  name: string;
  version: number;
  config: {
    version?: number;
    mode?: "enforce" | "audit";
    detectors?: {
      prompt_injection?: { enabled: boolean; threshold: number; action: "block" | "flag" };
      jailbreak?: { enabled: boolean; threshold: number; action: "block" | "flag" };
      pii?: { enabled: boolean; action: "mask" | "block" | "flag"; entities?: string[] };
      secrets?: { enabled: boolean; action: "block" | "flag"; patterns?: string[] };
      tool_call?: { enabled: boolean; action: "block" | "flag" };
      output?: { enabled: boolean; action: "mask" | "block" | "flag" };
    };
    store_content?: boolean;
  };
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

interface RoutingPolicyItem {
  id: string;
  name: string;
  version: number;
  config: {
    primary?: string | null;
    fallbacks?: string[];
    allow_fallback?: boolean;
    per_attempt_timeout_seconds?: number;
    request_deadline_seconds?: number;
    max_retries?: number;
    backoff_base_seconds?: number;
    backoff_max_seconds?: number;
    retry_after_cap_seconds?: number;
  };
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

// --- Zod Validation Schemas ---

const securityPolicySchema = z.object({
  name: z.string().min(1, "Policy name is required").max(255),
  mode: z.enum(["enforce", "audit"]),
  is_default: z.boolean(),
  store_content: z.boolean(),
  prompt_injection_enabled: z.boolean(),
  prompt_injection_threshold: z.number().min(0.0).max(1.0),
  prompt_injection_action: z.enum(["block", "flag"]),
  jailbreak_enabled: z.boolean(),
  jailbreak_threshold: z.number().min(0.0).max(1.0),
  jailbreak_action: z.enum(["block", "flag"]),
  pii_enabled: z.boolean(),
  pii_action: z.enum(["mask", "block", "flag"]),
  pii_entities: z.string(),
  secrets_enabled: z.boolean(),
  secrets_action: z.enum(["block", "flag"]),
  secrets_patterns: z.string(),
  tool_call_enabled: z.boolean(),
  tool_call_action: z.enum(["block", "flag"]),
  output_enabled: z.boolean(),
  output_action: z.enum(["mask", "block", "flag"]),
});

const routingPolicySchema = z.object({
  name: z.string().min(1, "Policy name is required").max(255),
  is_default: z.boolean(),
  primary: z.string().min(1, "Primary model is required"),
  fallbacks: z.array(z.string()),
  allow_fallback: z.boolean(),
  per_attempt_timeout_seconds: z.number().positive("Per-attempt timeout must be > 0"),
  request_deadline_seconds: z.number().positive("Request deadline must be > 0"),
  max_retries: z.number().int().min(0, "Retries must be >= 0"),
  backoff_base_seconds: z.number().positive("Backoff base must be > 0"),
  backoff_max_seconds: z.number().positive("Backoff max must be > 0"),
  retry_after_cap_seconds: z.number().positive("Retry-after cap must be > 0"),
});

export default function PoliciesPage() {
  const { isDemoMode } = useDemoMode();
  const [, startTransition] = useTransition();

  // Active Tab
  const [activeTab, setActiveTab] = useState<"security" | "routing">("security");

  // Policy Lists
  const [secPolicies, setSecPolicies] = useState<SecurityPolicyItem[]>([]);
  const [routePolicies, setRoutePolicies] = useState<RoutingPolicyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Security Policy Editor State
  const [isEditingSec, setIsEditingSec] = useState(false);
  const [selectedSecPolicy, setSelectedSecPolicy] = useState<SecurityPolicyItem | null>(null);
  const [secFormName, setSecFormName] = useState("");
  const [secFormMode, setSecFormMode] = useState<"enforce" | "audit">("enforce");
  const [secFormDefault, setSecFormDefault] = useState(false);
  const [secFormStoreContent, setSecFormStoreContent] = useState(false);
  const [piEnabled, setPiEnabled] = useState(true);
  const [piThreshold, setPiThreshold] = useState(0.8);
  const [piAction, setPiAction] = useState<"block" | "flag">("block");
  const [jbEnabled, setJbEnabled] = useState(true);
  const [jbThreshold, setJbThreshold] = useState(0.8);
  const [jbAction, setJbAction] = useState<"block" | "flag">("block");
  const [piiEnabled, setPiiEnabled] = useState(true);
  const [piiAction, setPiiAction] = useState<"mask" | "block" | "flag">("mask");
  const [piiEntities, setPiiEntities] = useState("EMAIL, PHONE, SSN, CREDIT_CARD, IP_ADDRESS");
  const [secretsEnabled, setSecretsEnabled] = useState(true);
  const [secretsAction, setSecretsAction] = useState<"block" | "flag">("block");
  const [secretsPatterns, setSecretsPatterns] = useState("api_key, jwt, private_key");
  const [tcEnabled, setTcEnabled] = useState(true);
  const [tcAction, setTcAction] = useState<"block" | "flag">("block");
  const [outEnabled, setOutEnabled] = useState(true);
  const [outAction, setOutAction] = useState<"mask" | "block" | "flag">("mask");
  const [secErrors, setSecErrors] = useState<Record<string, string>>({});
  const [isSavingSec, setIsSavingSec] = useState(false);

  // Routing Policy Editor State
  const [isEditingRoute, setIsEditingRoute] = useState(false);
  const [selectedRoutePolicy, setSelectedRoutePolicy] = useState<RoutingPolicyItem | null>(null);
  const [routeFormName, setRouteFormName] = useState("");
  const [routeFormDefault, setRouteFormDefault] = useState(false);
  const [routePrimary, setRoutePrimary] = useState("mock:default-chat");
  const [routeFallbacks, setRouteFallbacks] = useState<string[]>([
    "groq:llama-3.3-70b-versatile",
    "gemini:gemini-2.5-flash",
  ]);
  const [newFallbackInput, setNewFallbackInput] = useState("");
  const [routeAllowFallback, setRouteAllowFallback] = useState(true);
  const [routePerAttemptTimeout, setRoutePerAttemptTimeout] = useState(10.0);
  const [routeDeadline, setRouteDeadline] = useState(30.0);
  const [routeRetries, setRouteRetries] = useState(2);
  const [routeBackoffBase, setRouteBackoffBase] = useState(0.5);
  const [routeBackoffMax, setRouteBackoffMax] = useState(10.0);
  const [routeRetryCap, setRouteRetryCap] = useState(30.0);
  const [routeErrors, setRouteErrors] = useState<Record<string, string>>({});
  const [isSavingRoute, setIsSavingRoute] = useState(false);

  // Load Policies
  const loadPolicies = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setErrorMsg(null);
    try {
      const [secRes, routeRes] = await Promise.all([
        proxyFetch<SecurityPolicyItem[]>("admin/policies"),
        proxyFetch<RoutingPolicyItem[]>("admin/policies/routing"),
      ]);
      setSecPolicies(secRes || []);
      setRoutePolicies(routeRes || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load policies.");
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [secRes, routeRes] = await Promise.all([
          proxyFetch<SecurityPolicyItem[]>("admin/policies"),
          proxyFetch<RoutingPolicyItem[]>("admin/policies/routing"),
        ]);
        if (!ignore) {
          setSecPolicies(secRes || []);
          setRoutePolicies(routeRes || []);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setErrorMsg(err instanceof Error ? err.message : "Failed to load policies.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  // Open Create Security Policy
  const handleOpenCreateSec = () => {
    setSelectedSecPolicy(null);
    setSecFormName("");
    setSecFormMode("enforce");
    setSecFormDefault(false);
    setSecFormStoreContent(false);
    setPiEnabled(true);
    setPiThreshold(0.8);
    setPiAction("block");
    setJbEnabled(true);
    setJbThreshold(0.8);
    setJbAction("block");
    setPiiEnabled(true);
    setPiiAction("mask");
    setPiiEntities("EMAIL, PHONE, SSN, CREDIT_CARD, IP_ADDRESS");
    setSecretsEnabled(true);
    setSecretsAction("block");
    setSecretsPatterns("api_key, jwt, private_key");
    setTcEnabled(true);
    setTcAction("block");
    setOutEnabled(true);
    setOutAction("mask");
    setSecErrors({});
    setIsEditingSec(true);
  };

  // Open Edit Security Policy
  const handleOpenEditSec = (policy: SecurityPolicyItem) => {
    setSelectedSecPolicy(policy);
    setSecFormName(policy.name);
    setSecFormMode(policy.config?.mode || "enforce");
    setSecFormDefault(policy.is_default);
    setSecFormStoreContent(Boolean(policy.config?.store_content));

    const dets = policy.config?.detectors || {};
    setPiEnabled(dets.prompt_injection?.enabled ?? true);
    setPiThreshold(dets.prompt_injection?.threshold ?? 0.8);
    setPiAction(dets.prompt_injection?.action || "block");

    setJbEnabled(dets.jailbreak?.enabled ?? true);
    setJbThreshold(dets.jailbreak?.threshold ?? 0.8);
    setJbAction(dets.jailbreak?.action || "block");

    setPiiEnabled(dets.pii?.enabled ?? true);
    setPiiAction(dets.pii?.action || "mask");
    setPiiEntities(dets.pii?.entities ? dets.pii.entities.join(", ") : "EMAIL, PHONE, SSN");

    setSecretsEnabled(dets.secrets?.enabled ?? true);
    setSecretsAction(dets.secrets?.action || "block");
    setSecretsPatterns(
      dets.secrets?.patterns ? dets.secrets.patterns.join(", ") : "api_key, jwt, private_key"
    );

    setTcEnabled(dets.tool_call?.enabled ?? true);
    setTcAction(dets.tool_call?.action || "block");

    setOutEnabled(dets.output?.enabled ?? true);
    setOutAction(dets.output?.action || "mask");

    setSecErrors({});
    setIsEditingSec(true);
  };

  // Save Security Policy
  const handleSaveSecPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecErrors({});
    setErrorMsg(null);
    setSuccessMsg(null);

    const valResult = securityPolicySchema.safeParse({
      name: secFormName.trim(),
      mode: secFormMode,
      is_default: secFormDefault,
      store_content: secFormStoreContent,
      prompt_injection_enabled: piEnabled,
      prompt_injection_threshold: Number(piThreshold),
      prompt_injection_action: piAction,
      jailbreak_enabled: jbEnabled,
      jailbreak_threshold: Number(jbThreshold),
      jailbreak_action: jbAction,
      pii_enabled: piiEnabled,
      pii_action: piiAction,
      pii_entities: piiEntities,
      secrets_enabled: secretsEnabled,
      secrets_action: secretsAction,
      secrets_patterns: secretsPatterns,
      tool_call_enabled: tcEnabled,
      tool_call_action: tcAction,
      output_enabled: outEnabled,
      output_action: outAction,
    });

    if (!valResult.success) {
      const errs: Record<string, string> = {};
      valResult.error.issues.forEach((err) => {
        if (err.path[0]) errs[String(err.path[0])] = err.message;
      });
      setSecErrors(errs);
      return;
    }

    const piiList = piiEntities
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const secList = secretsPatterns
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const domainConfig = {
      version: 1,
      mode: secFormMode,
      detectors: {
        prompt_injection: {
          enabled: piEnabled,
          threshold: Number(piThreshold),
          action: piAction,
        },
        jailbreak: {
          enabled: jbEnabled,
          threshold: Number(jbThreshold),
          action: jbAction,
        },
        pii: {
          enabled: piiEnabled,
          action: piiAction,
          entities: piiList,
        },
        secrets: {
          enabled: secretsEnabled,
          action: secretsAction,
          patterns: secList,
        },
        tool_call: {
          enabled: tcEnabled,
          action: tcAction,
        },
        output: {
          enabled: outEnabled,
          action: outAction,
        },
      },
      store_content: secFormStoreContent,
    };

    setIsSavingSec(true);
    try {
      if (selectedSecPolicy) {
        // Update existing policy (bumps version)
        const updated = await proxyFetch<SecurityPolicyItem>(
          `admin/policies/${selectedSecPolicy.id}`,
          {
            method: "PUT",
            body: {
              config: domainConfig,
              is_default: secFormDefault,
            },
          }
        );
        startTransition(() => {
          setSecPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          setIsEditingSec(false);
          setSuccessMsg(`Policy "${updated.name}" updated to version ${updated.version}.`);
        });
      } else {
        // Create new policy
        const created = await proxyFetch<SecurityPolicyItem>("admin/policies", {
          method: "POST",
          body: {
            name: secFormName.trim(),
            config: domainConfig,
            is_default: secFormDefault,
          },
        });
        startTransition(() => {
          setSecPolicies((prev) => [created, ...prev]);
          setIsEditingSec(false);
          setSuccessMsg(`Policy "${created.name}" created (v${created.version}).`);
        });
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save security policy.");
    } finally {
      setIsSavingSec(false);
    }
  };

  // Open Create Routing Policy
  const handleOpenCreateRoute = () => {
    setSelectedRoutePolicy(null);
    setRouteFormName("");
    setRouteFormDefault(false);
    setRoutePrimary("mock:default-chat");
    setRouteFallbacks(["groq:llama-3.3-70b-versatile", "gemini:gemini-2.5-flash"]);
    setRouteAllowFallback(true);
    setRoutePerAttemptTimeout(10.0);
    setRouteDeadline(30.0);
    setRouteRetries(2);
    setRouteBackoffBase(0.5);
    setRouteBackoffMax(10.0);
    setRouteRetryCap(30.0);
    setRouteErrors({});
    setIsEditingRoute(true);
  };

  // Open Edit Routing Policy
  const handleOpenEditRoute = (policy: RoutingPolicyItem) => {
    setSelectedRoutePolicy(policy);
    setRouteFormName(policy.name);
    setRouteFormDefault(policy.is_default);

    const cfg = policy.config || {};
    setRoutePrimary(cfg.primary || "mock:default-chat");
    setRouteFallbacks(cfg.fallbacks || []);
    setRouteAllowFallback(cfg.allow_fallback ?? true);
    setRoutePerAttemptTimeout(cfg.per_attempt_timeout_seconds ?? 10.0);
    setRouteDeadline(cfg.request_deadline_seconds ?? 30.0);
    setRouteRetries(cfg.max_retries ?? 2);
    setRouteBackoffBase(cfg.backoff_base_seconds ?? 0.5);
    setRouteBackoffMax(cfg.backoff_max_seconds ?? 10.0);
    setRouteRetryCap(cfg.retry_after_cap_seconds ?? 30.0);

    setRouteErrors({});
    setIsEditingRoute(true);
  };

  // Add Fallback Model
  const handleAddFallback = () => {
    if (!newFallbackInput.trim()) return;
    if (!routeFallbacks.includes(newFallbackInput.trim())) {
      setRouteFallbacks([...routeFallbacks, newFallbackInput.trim()]);
    }
    setNewFallbackInput("");
  };

  // Remove Fallback Model
  const handleRemoveFallback = (idx: number) => {
    setRouteFallbacks(routeFallbacks.filter((_, i) => i !== idx));
  };

  // Save Routing Policy
  const handleSaveRoutePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setRouteErrors({});
    setErrorMsg(null);
    setSuccessMsg(null);

    const valResult = routingPolicySchema.safeParse({
      name: routeFormName.trim(),
      is_default: routeFormDefault,
      primary: routePrimary.trim(),
      fallbacks: routeFallbacks,
      allow_fallback: routeAllowFallback,
      per_attempt_timeout_seconds: Number(routePerAttemptTimeout),
      request_deadline_seconds: Number(routeDeadline),
      max_retries: Number(routeRetries),
      backoff_base_seconds: Number(routeBackoffBase),
      backoff_max_seconds: Number(routeBackoffMax),
      retry_after_cap_seconds: Number(routeRetryCap),
    });

    if (!valResult.success) {
      const errs: Record<string, string> = {};
      valResult.error.issues.forEach((err) => {
        if (err.path[0]) errs[String(err.path[0])] = err.message;
      });
      setRouteErrors(errs);
      return;
    }

    const domainConfig = {
      primary: routePrimary.trim(),
      fallbacks: routeFallbacks,
      allow_fallback: routeAllowFallback,
      per_attempt_timeout_seconds: Number(routePerAttemptTimeout),
      request_deadline_seconds: Number(routeDeadline),
      max_retries: Number(routeRetries),
      backoff_base_seconds: Number(routeBackoffBase),
      backoff_max_seconds: Number(routeBackoffMax),
      retry_after_cap_seconds: Number(routeRetryCap),
    };

    setIsSavingRoute(true);
    try {
      if (selectedRoutePolicy) {
        // Update existing (version bump)
        const updated = await proxyFetch<RoutingPolicyItem>(
          `admin/policies/routing/${selectedRoutePolicy.id}`,
          {
            method: "PUT",
            body: {
              config: domainConfig,
              is_default: routeFormDefault,
            },
          }
        );
        startTransition(() => {
          setRoutePolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          setIsEditingRoute(false);
          setSuccessMsg(`Routing policy "${updated.name}" updated to version ${updated.version}.`);
        });
      } else {
        // Create new
        const created = await proxyFetch<RoutingPolicyItem>("admin/policies/routing", {
          method: "POST",
          body: {
            name: routeFormName.trim(),
            config: domainConfig,
            is_default: routeFormDefault,
          },
        });
        startTransition(() => {
          setRoutePolicies((prev) => [created, ...prev]);
          setIsEditingRoute(false);
          setSuccessMsg(`Routing policy "${created.name}" created (v${created.version}).`);
        });
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save routing policy.");
    } finally {
      setIsSavingRoute(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Policy & Routing Engine</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Define declarative security guardrails and multi-provider fallback policies with version control.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              void loadPolicies();
            }}
            disabled={isLoading}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-white/10 rounded-xl transition-colors cursor-pointer"
            title="Refresh policies"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          {activeTab === "security" ? (
            <button
              onClick={handleOpenCreateSec}
              disabled={isDemoMode}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Security Policy</span>
            </button>
          ) : (
            <button
              onClick={handleOpenCreateRoute}
              disabled={isDemoMode}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Routing Policy</span>
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs sm:text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <div className="flex-1">
            <p className="font-semibold">Error</p>
            <p>{errorMsg}</p>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs sm:text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-2">
        <button
          onClick={() => setActiveTab("security")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === "security"
              ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Security Policies ({secPolicies.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("routing")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === "routing"
              ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Routing Policies ({routePolicies.length})</span>
        </button>
      </div>

      {/* SECURITY POLICIES TAB */}
      {activeTab === "security" && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="glass-panel p-12 text-center text-slate-400 rounded-2xl border border-white/5">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
              <p className="text-sm">Loading security policies...</p>
            </div>
          ) : secPolicies.length === 0 ? (
            <EmptyState
              title="No Security Policies"
              description="Create a security policy to configure injection, jailbreak, and PII guardrails."
              icon={Shield}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {secPolicies.map((pol) => {
                const dets = pol.config?.detectors || {};
                return (
                  <div
                    key={pol.id}
                    className="glass-panel p-5 rounded-2xl border border-white/5 flex flex-col justify-between space-y-4 hover:border-indigo-500/30 transition-all"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-white text-base">{pol.name}</h3>
                          <div className="text-[11px] font-mono text-slate-500 truncate max-w-[180px]">
                            {pol.id}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-mono font-semibold">
                            v{pol.version}
                          </span>
                          {pol.is_default && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                              DEFAULT
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Detector Badges */}
                      <div className="space-y-1.5 pt-2 border-t border-white/5 text-xs text-slate-300">
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Mode:</span>
                          <span className="font-mono uppercase text-indigo-300">
                            {pol.config?.mode || "enforce"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Prompt Injection:</span>
                          <span>
                            {dets.prompt_injection?.enabled ? (
                              <span className="text-emerald-400 font-mono">
                                {dets.prompt_injection.action} (≥{dets.prompt_injection.threshold})
                              </span>
                            ) : (
                              <span className="text-slate-500">Disabled</span>
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">PII Redaction:</span>
                          <span>
                            {dets.pii?.enabled ? (
                              <span className="text-emerald-400 font-mono">{dets.pii.action}</span>
                            ) : (
                              <span className="text-slate-500">Disabled</span>
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Secret Scanner:</span>
                          <span>
                            {dets.secrets?.enabled ? (
                              <span className="text-emerald-400 font-mono">{dets.secrets.action}</span>
                            ) : (
                              <span className="text-slate-500">Disabled</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-white/5 text-xs">
                      <span className="text-slate-500 text-[11px]">
                        {new Date(pol.created_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleOpenEditSec(pol)}
                        disabled={isDemoMode}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-colors font-medium cursor-pointer disabled:opacity-40"
                      >
                        Edit Policy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ROUTING POLICIES TAB */}
      {activeTab === "routing" && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="glass-panel p-12 text-center text-slate-400 rounded-2xl border border-white/5">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-400" />
              <p className="text-sm">Loading routing policies...</p>
            </div>
          ) : routePolicies.length === 0 ? (
            <EmptyState
              title="No Routing Policies"
              description="Create a routing policy to configure primary providers, failover chains, and deadlines."
              icon={Sliders}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {routePolicies.map((pol) => {
                const cfg = pol.config || {};
                return (
                  <div
                    key={pol.id}
                    className="glass-panel p-5 rounded-2xl border border-white/5 flex flex-col justify-between space-y-4 hover:border-emerald-500/30 transition-all"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-white text-base">{pol.name}</h3>
                          <div className="text-[11px] font-mono text-slate-500 truncate max-w-[180px]">
                            {pol.id}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono font-semibold">
                            v{pol.version}
                          </span>
                          {pol.is_default && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                              DEFAULT
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Routing Config Details */}
                      <div className="space-y-1.5 pt-2 border-t border-white/5 text-xs text-slate-300">
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Primary Model:</span>
                          <span className="font-mono text-indigo-300 font-semibold truncate max-w-[140px]">
                            {cfg.primary || "Default"}
                          </span>
                        </div>
                        <div className="text-[11px]">
                          <span className="text-slate-400 block mb-1">Fallback Chain:</span>
                          {cfg.fallbacks && cfg.fallbacks.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {cfg.fallbacks.map((f, i) => (
                                <span
                                  key={f}
                                  className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-emerald-300 border border-white/5"
                                >
                                  {i + 1}. {f}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">None</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] font-mono text-slate-400">
                          <div>
                            Timeout:{" "}
                            <span className="text-slate-200">
                              {cfg.per_attempt_timeout_seconds ?? 10}s
                            </span>
                          </div>
                          <div>
                            Retries:{" "}
                            <span className="text-slate-200">{cfg.max_retries ?? 2}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-white/5 text-xs">
                      <span className="text-slate-500 text-[11px]">
                        {new Date(pol.created_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleOpenEditRoute(pol)}
                        disabled={isDemoMode}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-colors font-medium cursor-pointer disabled:opacity-40"
                      >
                        Edit Routing
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* EDIT / CREATE SECURITY POLICY MODAL */}
      {isEditingSec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel border border-white/10 w-full max-w-2xl p-6 rounded-2xl shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  {selectedSecPolicy ? `Edit Policy: ${selectedSecPolicy.name}` : "Create Security Policy"}
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedSecPolicy
                    ? `Saving will bump this policy to version ${selectedSecPolicy.version + 1}.`
                    : "Configure thresholds and enforcement actions for security detectors."}
                </p>
              </div>
              <button
                onClick={() => setIsEditingSec(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSecPolicy} className="space-y-4">
              {/* General Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Policy Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    disabled={Boolean(selectedSecPolicy)}
                    value={secFormName}
                    onChange={(e) => setSecFormName(e.target.value)}
                    placeholder="e.g. enterprise-strict-policy"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    required
                  />
                  {secErrors.name && <p className="text-rose-400 text-xs mt-1">{secErrors.name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Mode</label>
                  <select
                    value={secFormMode}
                    onChange={(e) => setSecFormMode(e.target.value as "enforce" | "audit")}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="enforce">Enforce (Block & Mask)</option>
                    <option value="audit">Audit (Flag & Monitor Only)</option>
                  </select>
                </div>
              </div>

              {/* Detector Controls */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Detector Thresholds & Actions
                </div>

                {/* Prompt Injection */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="sec-pi-enabled"
                        checked={piEnabled}
                        onChange={(e) => setPiEnabled(e.target.checked)}
                        className="rounded border-white/10 bg-slate-900 text-indigo-600"
                      />
                      <label htmlFor="sec-pi-enabled" className="text-xs font-semibold text-white cursor-pointer">
                        Prompt Injection Detector
                      </label>
                    </div>
                    <select
                      value={piAction}
                      onChange={(e) => setPiAction(e.target.value as "block" | "flag")}
                      disabled={!piEnabled}
                      className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      <option value="block">Block Request</option>
                      <option value="flag">Flag & Continue</option>
                    </select>
                  </div>
                  {piEnabled && (
                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-xs text-slate-400">Sensitivity Threshold:</span>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={piThreshold}
                        onChange={(e) => setPiThreshold(Number(e.target.value))}
                        className="flex-1 accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-xs font-mono font-bold text-indigo-300 w-8">
                        {piThreshold.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Jailbreak Detector */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="sec-jb-enabled"
                        checked={jbEnabled}
                        onChange={(e) => setJbEnabled(e.target.checked)}
                        className="rounded border-white/10 bg-slate-900 text-indigo-600"
                      />
                      <label htmlFor="sec-jb-enabled" className="text-xs font-semibold text-white cursor-pointer">
                        Jailbreak Detector
                      </label>
                    </div>
                    <select
                      value={jbAction}
                      onChange={(e) => setJbAction(e.target.value as "block" | "flag")}
                      disabled={!jbEnabled}
                      className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      <option value="block">Block Request</option>
                      <option value="flag">Flag & Continue</option>
                    </select>
                  </div>
                  {jbEnabled && (
                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-xs text-slate-400">Sensitivity Threshold:</span>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={jbThreshold}
                        onChange={(e) => setJbThreshold(Number(e.target.value))}
                        className="flex-1 accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-xs font-mono font-bold text-indigo-300 w-8">
                        {jbThreshold.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {/* PII Detection */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="sec-pii-enabled"
                        checked={piiEnabled}
                        onChange={(e) => setPiiEnabled(e.target.checked)}
                        className="rounded border-white/10 bg-slate-900 text-indigo-600"
                      />
                      <label htmlFor="sec-pii-enabled" className="text-xs font-semibold text-white cursor-pointer">
                        PII Entity Anonymization
                      </label>
                    </div>
                    <select
                      value={piiAction}
                      onChange={(e) => setPiiAction(e.target.value as "mask" | "block" | "flag")}
                      disabled={!piiEnabled}
                      className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      <option value="mask">Mask (Redact Content)</option>
                      <option value="block">Block Request</option>
                      <option value="flag">Flag & Continue</option>
                    </select>
                  </div>
                  {piiEnabled && (
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Monitored Entities (comma separated)
                      </label>
                      <input
                        type="text"
                        value={piiEntities}
                        onChange={(e) => setPiiEntities(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  )}
                </div>

                {/* Secrets Detection */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="sec-secrets-enabled"
                        checked={secretsEnabled}
                        onChange={(e) => setSecretsEnabled(e.target.checked)}
                        className="rounded border-white/10 bg-slate-900 text-indigo-600"
                      />
                      <label htmlFor="sec-secrets-enabled" className="text-xs font-semibold text-white cursor-pointer">
                        Secret Leakage Prevention
                      </label>
                    </div>
                    <select
                      value={secretsAction}
                      onChange={(e) => setSecretsAction(e.target.value as "block" | "flag")}
                      disabled={!secretsEnabled}
                      className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      <option value="block">Block Request</option>
                      <option value="flag">Flag & Continue</option>
                    </select>
                  </div>
                  {secretsEnabled && (
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Token / Secret Patterns
                      </label>
                      <input
                        type="text"
                        value={secretsPatterns}
                        onChange={(e) => setSecretsPatterns(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Flags */}
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="sec-is-default"
                    checked={secFormDefault}
                    onChange={(e) => setSecFormDefault(e.target.checked)}
                    className="rounded border-white/10 bg-slate-900 text-indigo-600"
                  />
                  <label htmlFor="sec-is-default" className="text-xs text-slate-300 cursor-pointer">
                    Set as system default security policy
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="sec-store-content"
                    checked={secFormStoreContent}
                    onChange={(e) => setSecFormStoreContent(e.target.checked)}
                    className="rounded border-white/10 bg-slate-900 text-indigo-600"
                  />
                  <label htmlFor="sec-store-content" className="text-xs text-slate-300 cursor-pointer">
                    Store content payloads
                  </label>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsEditingSec(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 border border-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingSec || isDemoMode}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 cursor-pointer disabled:opacity-50"
                >
                  {isSavingSec ? "Saving..." : selectedSecPolicy ? "Update (Bump Version)" : "Create Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT / CREATE ROUTING POLICY MODAL */}
      {isEditingRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel border border-white/10 w-full max-w-2xl p-6 rounded-2xl shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  {selectedRoutePolicy ? `Edit Routing: ${selectedRoutePolicy.name}` : "Create Routing Policy"}
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedRoutePolicy
                    ? `Saving will bump this routing policy to version ${selectedRoutePolicy.version + 1}.`
                    : "Configure primary model, ordered fallback chain, and per-attempt deadlines."}
                </p>
              </div>
              <button
                onClick={() => setIsEditingRoute(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRoutePolicy} noValidate className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Routing Policy Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  disabled={Boolean(selectedRoutePolicy)}
                  value={routeFormName}
                  onChange={(e) => setRouteFormName(e.target.value)}
                  placeholder="e.g. ultra-low-latency-chain"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  required
                />
                {routeErrors.name && (
                  <p className="text-rose-400 text-xs mt-1">{routeErrors.name}</p>
                )}
              </div>

              {/* Primary Model */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Primary Model <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={routePrimary}
                  onChange={(e) => setRoutePrimary(e.target.value)}
                  placeholder="e.g. mock:default-chat or openai:gpt-4o"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono text-xs"
                  required
                />
                {routeErrors.primary && (
                  <p className="text-rose-400 text-xs mt-1">{routeErrors.primary}</p>
                )}
              </div>

              {/* Fallback Model Chain */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Ordered Fallback Chain
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newFallbackInput}
                    onChange={(e) => setNewFallbackInput(e.target.value)}
                    placeholder="e.g. anthropic:claude-3-5-sonnet-20241022"
                    className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddFallback}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-white/10 cursor-pointer"
                  >
                    Add Fallback
                  </button>
                </div>

                {routeFallbacks.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
                    {routeFallbacks.map((m, idx) => (
                      <div
                        key={m}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-white/5 text-xs font-mono text-slate-200"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-bold">{idx + 1}.</span>
                          <span>{m}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFallback(idx)}
                          className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                          title="Remove from chain"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Timeouts & Retries */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Per-Attempt Timeout (s)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={routePerAttemptTimeout}
                    onChange={(e) => setRoutePerAttemptTimeout(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                  {routeErrors.per_attempt_timeout_seconds && (
                    <p className="text-rose-400 text-xs mt-1">
                      {routeErrors.per_attempt_timeout_seconds}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Total Request Deadline (s)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={routeDeadline}
                    onChange={(e) => setRouteDeadline(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                  {routeErrors.request_deadline_seconds && (
                    <p className="text-rose-400 text-xs mt-1">
                      {routeErrors.request_deadline_seconds}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Max Retries
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={routeRetries}
                    onChange={(e) => setRouteRetries(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Backoff Base (s)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={routeBackoffBase}
                    onChange={(e) => setRouteBackoffBase(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="route-is-default"
                  checked={routeFormDefault}
                  onChange={(e) => setRouteFormDefault(e.target.checked)}
                  className="rounded border-white/10 bg-slate-900 text-emerald-600"
                />
                <label htmlFor="route-is-default" className="text-xs text-slate-300 cursor-pointer">
                  Set as system default routing policy
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsEditingRoute(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 border border-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingRoute || isDemoMode}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/30 cursor-pointer disabled:opacity-50"
                >
                  {isSavingRoute ? "Saving..." : selectedRoutePolicy ? "Update (Bump Version)" : "Create Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
