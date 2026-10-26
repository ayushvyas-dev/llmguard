"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sliders,
  X,
} from "lucide-react";
import { z } from "zod";
import { proxyFetch } from "@/lib/client-api";
import { useDemoMode } from "@/components/demo-banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";

interface ClientItem {
  id: string;
  name: string;
  status: "active" | "disabled";
  security_policy_id: string | null;
  routing_policy_id: string | null;
  rate_limit_rpm: number;
  window_seconds: number;
  daily_token_quota: number | null;
  monthly_cost_quota: number | null;
  allowed_models: string[] | null;
  store_content: boolean;
  created_at: string;
  updated_at: string;
}

interface ApiKeyItem {
  id: string;
  client_id: string;
  prefix: string;
  role: "client" | "admin";
  status: "active" | "revoked";
  label: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

interface PolicyOption {
  id: string;
  name: string;
  version: number;
  is_default: boolean;
}

const clientFormSchema = z.object({
  name: z.string().min(1, "Client name is required").max(255),
  rate_limit_rpm: z.number().int().min(1, "Rate limit must be at least 1 RPM"),
  window_seconds: z.number().int().min(1, "Window must be at least 1 second"),
  daily_token_quota: z.number().int().positive().nullable(),
  monthly_cost_quota: z.number().positive().nullable(),
  allowed_models: z.string(),
  store_content: z.boolean(),
  security_policy_id: z.string().nullable(),
  routing_policy_id: z.string().nullable(),
});

export default function ClientsPage() {
  const { isDemoMode } = useDemoMode();
  const [, startTransition] = useTransition();

  // State
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [secPolicies, setSecPolicies] = useState<PolicyOption[]>([]);
  const [routePolicies, setRoutePolicies] = useState<PolicyOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Client Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<ClientItem | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [formName, setFormName] = useState("");
  const [formRpm, setFormRpm] = useState(60);
  const [formWindow, setFormWindow] = useState(60);
  const [formDailyTokens, setFormDailyTokens] = useState<string>("");
  const [formMonthlyCost, setFormMonthlyCost] = useState<string>("");
  const [formAllowedModels, setFormAllowedModels] = useState("");
  const [formStoreContent, setFormStoreContent] = useState(false);
  const [formSecPolicyId, setFormSecPolicyId] = useState<string>("");
  const [formRoutePolicyId, setFormRoutePolicyId] = useState<string>("");

  // Keys Drawer / Modal
  const [selectedClientForKeys, setSelectedClientForKeys] = useState<ClientItem | null>(null);
  const [clientKeys, setClientKeys] = useState<ApiKeyItem[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [keyRole, setKeyRole] = useState<"client" | "admin">("client");
  const [keyLabel, setKeyLabel] = useState("");
  const [keyExpiresDays, setKeyExpiresDays] = useState<string>("");
  const [isCreatingKey, setIsCreatingKey] = useState(false);

  // One-time secret display dialog (UI-006: Secret shown exactly once)
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [hasCopiedSecret, setHasCopiedSecret] = useState(false);

  // Revocation Confirmation
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyItem | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  // Client Status Toggle Confirmation
  const [clientToToggle, setClientToToggle] = useState<ClientItem | null>(null);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  // Load clients & policies
  const loadData = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setErrorMsg(null);
    try {
      const [clientsData, secData, routeData] = await Promise.all([
        proxyFetch<ClientItem[]>("admin/clients"),
        proxyFetch<PolicyOption[]>("admin/policies").catch(() => []),
        proxyFetch<PolicyOption[]>("admin/policies/routing").catch(() => []),
      ]);
      setClients(clientsData || []);
      setSecPolicies(secData || []);
      setRoutePolicies(routeData || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load clients and policies.");
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [clientsData, secData, routeData] = await Promise.all([
          proxyFetch<ClientItem[]>("admin/clients"),
          proxyFetch<PolicyOption[]>("admin/policies").catch(() => []),
          proxyFetch<PolicyOption[]>("admin/policies/routing").catch(() => []),
        ]);
        if (!ignore) {
          setClients(clientsData || []);
          setSecPolicies(secData || []);
          setRoutePolicies(routeData || []);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setErrorMsg(err instanceof Error ? err.message : "Failed to load clients and policies.");
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

  // Open Create Modal
  const handleOpenCreate = () => {
    setFormName("");
    setFormRpm(60);
    setFormWindow(60);
    setFormDailyTokens("");
    setFormMonthlyCost("");
    setFormAllowedModels("");
    setFormStoreContent(false);
    setFormSecPolicyId("");
    setFormRoutePolicyId("");
    setFormErrors({});
    setIsCreateOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (client: ClientItem) => {
    setEditClient(client);
    setFormName(client.name);
    setFormRpm(client.rate_limit_rpm);
    setFormWindow(client.window_seconds);
    setFormDailyTokens(client.daily_token_quota ? String(client.daily_token_quota) : "");
    setFormMonthlyCost(client.monthly_cost_quota ? String(client.monthly_cost_quota) : "");
    setFormAllowedModels(client.allowed_models ? client.allowed_models.join(", ") : "");
    setFormStoreContent(client.store_content);
    setFormSecPolicyId(client.security_policy_id || "");
    setFormRoutePolicyId(client.routing_policy_id || "");
    setFormErrors({});
  };

  // Save Create Client
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});
    setErrorMsg(null);

    const parseResult = clientFormSchema.safeParse({
      name: formName.trim(),
      rate_limit_rpm: Number(formRpm),
      window_seconds: Number(formWindow),
      daily_token_quota: formDailyTokens ? Number(formDailyTokens) : null,
      monthly_cost_quota: formMonthlyCost ? Number(formMonthlyCost) : null,
      allowed_models: formAllowedModels,
      store_content: formStoreContent,
      security_policy_id: formSecPolicyId || null,
      routing_policy_id: formRoutePolicyId || null,
    });

    if (!parseResult.success) {
      const errs: Record<string, string> = {};
      parseResult.error.issues.forEach((err) => {
        if (err.path[0]) errs[String(err.path[0])] = err.message;
      });
      setFormErrors(errs);
      return;
    }

    const allowed = formAllowedModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    setIsSubmitting(true);
    try {
      const newClient = await proxyFetch<ClientItem>("admin/clients", {
        method: "POST",
        body: {
          name: parseResult.data.name,
          rate_limit_rpm: parseResult.data.rate_limit_rpm,
          window_seconds: parseResult.data.window_seconds,
          daily_token_quota: parseResult.data.daily_token_quota,
          monthly_cost_quota: parseResult.data.monthly_cost_quota,
          allowed_models: allowed.length > 0 ? allowed : null,
          store_content: parseResult.data.store_content,
          security_policy_id: parseResult.data.security_policy_id,
          routing_policy_id: parseResult.data.routing_policy_id,
          status: "active",
        },
      });

      startTransition(() => {
        setClients((prev) => [newClient, ...prev]);
        setIsCreateOpen(false);
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create client.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Save Edit Client
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editClient) return;

    setFormErrors({});
    setErrorMsg(null);

    const parseResult = clientFormSchema.safeParse({
      name: formName.trim(),
      rate_limit_rpm: Number(formRpm),
      window_seconds: Number(formWindow),
      daily_token_quota: formDailyTokens ? Number(formDailyTokens) : null,
      monthly_cost_quota: formMonthlyCost ? Number(formMonthlyCost) : null,
      allowed_models: formAllowedModels,
      store_content: formStoreContent,
      security_policy_id: formSecPolicyId || null,
      routing_policy_id: formRoutePolicyId || null,
    });

    if (!parseResult.success) {
      const errs: Record<string, string> = {};
      parseResult.error.issues.forEach((err) => {
        if (err.path[0]) errs[String(err.path[0])] = err.message;
      });
      setFormErrors(errs);
      return;
    }

    const allowed = formAllowedModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    setIsSubmitting(true);
    try {
      const updated = await proxyFetch<ClientItem>(`admin/clients/${editClient.id}`, {
        method: "PATCH",
        body: {
          name: parseResult.data.name,
          rate_limit_rpm: parseResult.data.rate_limit_rpm,
          window_seconds: parseResult.data.window_seconds,
          daily_token_quota: parseResult.data.daily_token_quota,
          monthly_cost_quota: parseResult.data.monthly_cost_quota,
          allowed_models: allowed.length > 0 ? allowed : null,
          store_content: parseResult.data.store_content,
          security_policy_id: parseResult.data.security_policy_id,
          routing_policy_id: parseResult.data.routing_policy_id,
        },
      });

      startTransition(() => {
        setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setEditClient(null);
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update client.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Client Status (Active <-> Disabled)
  const handleToggleStatus = (client: ClientItem) => {
    setClientToToggle(client);
  };

  const confirmToggleStatus = async () => {
    if (!clientToToggle) return;
    setIsTogglingStatus(true);
    try {
      const newStatus = clientToToggle.status === "active" ? "disabled" : "active";
      const updated = await proxyFetch<ClientItem>(`admin/clients/${clientToToggle.id}`, {
        method: "PATCH",
        body: { status: newStatus },
      });
      setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setClientToToggle(null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to change client status.");
    } finally {
      setIsTogglingStatus(false);
    }
  };

  // Open Keys Modal
  const handleOpenKeys = async (client: ClientItem) => {
    setSelectedClientForKeys(client);
    setIsLoadingKeys(true);
    setKeyLabel("");
    setKeyExpiresDays("");
    try {
      const keys = await proxyFetch<ApiKeyItem[]>(`admin/clients/${client.id}/keys`);
      setClientKeys(keys || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load client keys.");
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // Create Key
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientForKeys) return;

    setIsCreatingKey(true);
    setErrorMsg(null);
    try {
      const body: { role: string; label?: string; expires_in_days?: number } = {
        role: keyRole,
        label: keyLabel.trim() || undefined,
      };
      if (keyExpiresDays) {
        body.expires_in_days = Number(keyExpiresDays);
      }

      // Backend returns KeyCreatedResponse containing plaintext raw `key`
      const res = await proxyFetch<ApiKeyItem & { key: string }>(
        `admin/clients/${selectedClientForKeys.id}/keys`,
        {
          method: "POST",
          body,
        }
      );

      // Add to key list
      setClientKeys((prev) => [res, ...prev]);

      // Trigger one-time secret display dialog
      setOneTimeSecret(res.key);
      setHasCopiedSecret(false);

      // Reset form
      setKeyLabel("");
      setKeyExpiresDays("");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to issue key.");
    } finally {
      setIsCreatingKey(false);
    }
  };

  // Close One-time Secret Dialog (UI-006: Wipe secret from memory)
  const handleCloseSecretDialog = () => {
    setOneTimeSecret(null);
    setHasCopiedSecret(false);
  };

  // Copy secret to clipboard
  const handleCopySecret = async () => {
    if (!oneTimeSecret) return;
    try {
      await navigator.clipboard.writeText(oneTimeSecret);
      setHasCopiedSecret(true);
      setTimeout(() => setHasCopiedSecret(false), 2500);
    } catch {
      // Fallback
    }
  };

  // Revoke Key
  const handleRevokeKey = (key: ApiKeyItem) => {
    setKeyToRevoke(key);
  };

  const confirmRevokeKey = async () => {
    if (!keyToRevoke) return;
    setIsRevoking(true);
    try {
      await proxyFetch(`admin/keys/${keyToRevoke.prefix}/revoke`, {
        method: "POST",
      });

      // Update key status immediately in the list
      setClientKeys((prev) =>
        prev.map((k) => (k.prefix === keyToRevoke.prefix ? { ...k, status: "revoked" } : k))
      );
      setKeyToRevoke(null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to revoke key.");
    } finally {
      setIsRevoking(false);
    }
  };

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Client Governance & API Keys</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Provision API tenants, set rate limits and quotas, and manage cryptographically secured API keys.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              void loadData();
            }}
            disabled={isLoading}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-white/10 rounded-xl transition-colors cursor-pointer"
            title="Refresh clients"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleOpenCreate}
            disabled={isDemoMode}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Client</span>
          </button>
        </div>
      </div>

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

      {/* Filter / Search Bar */}
      <div className="flex items-center gap-3 glass-panel p-3 rounded-2xl border border-white/5">
        <Search className="w-4 h-4 text-slate-400 ml-2 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search clients by name or UUID..."
          className="bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none flex-1"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="text-xs text-slate-400 hover:text-white mr-2"
          >
            Clear
          </button>
        )}
      </div>

      {/* Clients Table */}
      {isLoading ? (
        <div className="glass-panel p-12 text-center text-slate-400 rounded-2xl border border-white/5">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
          <p className="text-sm">Loading client records...</p>
        </div>
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title="No Clients Found"
          description={
            searchQuery
              ? "No clients match your search criteria."
              : "No clients provisioned yet. Create your first client application above."
          }
          icon={KeyRound}
        />
      ) : (
        <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-slate-900/50 text-slate-400 font-medium">
                  <th className="p-4">Client Name</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Rate Limits</th>
                  <th className="p-4">Quotas</th>
                  <th className="p-4">Allowed Models</th>
                  <th className="p-4">Policy Link</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {filteredClients.map((client) => {
                  const isActive = client.status === "active";
                  const secPolicyName =
                    secPolicies.find((p) => p.id === client.security_policy_id)?.name ||
                    (client.security_policy_id ? "Custom Policy" : "Default");
                  const routePolicyName =
                    routePolicies.find((p) => p.id === client.routing_policy_id)?.name ||
                    (client.routing_policy_id ? "Custom Routing" : "Default");

                  return (
                    <tr key={client.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4">
                        <div className="font-semibold text-white">{client.name}</div>
                        <div className="text-[11px] font-mono text-slate-500 truncate max-w-[140px]">
                          {client.id}
                        </div>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                            isActive
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isActive ? "bg-emerald-400" : "bg-slate-400"
                            }`}
                          />
                          {isActive ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="font-mono text-slate-200">
                          {client.rate_limit_rpm} <span className="text-slate-400">RPM</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Window: {client.window_seconds}s
                        </div>
                      </td>
                      <td className="p-4 font-mono text-xs">
                        <div>
                          Tokens:{" "}
                          <span className="text-slate-200">
                            {client.daily_token_quota ? client.daily_token_quota.toLocaleString() : "∞"}
                          </span>
                        </div>
                        <div>
                          Cost:{" "}
                          <span className="text-slate-200">
                            {client.monthly_cost_quota ? `$${client.monthly_cost_quota}` : "∞"}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        {client.allowed_models && client.allowed_models.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {client.allowed_models.map((m) => (
                              <span
                                key={m}
                                className="px-1.5 py-0.5 rounded bg-slate-800 text-[11px] font-mono text-indigo-300 border border-white/5"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 text-xs italic">All Models (*)</span>
                        )}
                      </td>
                      <td className="p-4 text-xs">
                        <div className="flex items-center gap-1 text-slate-300">
                          <Shield className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate max-w-[100px]">{secPolicyName}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-400 mt-1">
                          <Sliders className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate max-w-[100px]">{routePolicyName}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenKeys(client)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 text-xs font-medium transition-colors cursor-pointer"
                            title="Manage API Keys"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Keys</span>
                          </button>
                          <button
                            onClick={() => handleOpenEdit(client)}
                            disabled={isDemoMode}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors cursor-pointer disabled:opacity-40"
                            title="Edit Client"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(client)}
                            disabled={isDemoMode}
                            className={`px-2 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-40 ${
                              isActive
                                ? "text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20"
                                : "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20"
                            }`}
                            title={isActive ? "Disable Client" : "Enable Client"}
                          >
                            {isActive ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE CLIENT MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel border border-white/10 w-full max-w-lg p-6 rounded-2xl shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <h3 className="text-base font-semibold text-white">Create Client Application</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Client Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. customer-service-prod"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  required
                />
                {formErrors.name && <p className="text-rose-400 text-xs mt-1">{formErrors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Rate Limit (RPM)
                  </label>
                  <input
                    type="number"
                    value={formRpm}
                    onChange={(e) => setFormRpm(Number(e.target.value))}
                    min={1}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                  {formErrors.rate_limit_rpm && (
                    <p className="text-rose-400 text-xs mt-1">{formErrors.rate_limit_rpm}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Window (Seconds)
                  </label>
                  <input
                    type="number"
                    value={formWindow}
                    onChange={(e) => setFormWindow(Number(e.target.value))}
                    min={1}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Daily Token Quota (optional)
                  </label>
                  <input
                    type="number"
                    value={formDailyTokens}
                    onChange={(e) => setFormDailyTokens(e.target.value)}
                    placeholder="e.g. 500000"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Monthly Spend Cap ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formMonthlyCost}
                    onChange={(e) => setFormMonthlyCost(e.target.value)}
                    placeholder="e.g. 50.00"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Allowed Models (comma separated, or empty for all)
                </label>
                <input
                  type="text"
                  value={formAllowedModels}
                  onChange={(e) => setFormAllowedModels(e.target.value)}
                  placeholder="e.g. mock:default-chat, openai:gpt-4o"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Security Policy
                  </label>
                  <select
                    value={formSecPolicyId}
                    onChange={(e) => setFormSecPolicyId(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">(Default Policy)</option>
                    {secPolicies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (v{p.version})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Routing Policy
                  </label>
                  <select
                    value={formRoutePolicyId}
                    onChange={(e) => setFormRoutePolicyId(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">(Default Routing)</option>
                    {routePolicies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (v{p.version})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="create-store-content"
                  checked={formStoreContent}
                  onChange={(e) => setFormStoreContent(e.target.checked)}
                  className="rounded border-white/10 bg-slate-900 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="create-store-content" className="text-xs text-slate-300 cursor-pointer">
                  Opt-in to content payload storage in traces (store prompt/output)
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 border border-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? "Creating..." : "Create Client"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CLIENT MODAL */}
      {editClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel border border-white/10 w-full max-w-lg p-6 rounded-2xl shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <h3 className="text-base font-semibold text-white">Edit Client: {editClient.name}</h3>
              <button
                onClick={() => setEditClient(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Client Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  required
                />
                {formErrors.name && <p className="text-rose-400 text-xs mt-1">{formErrors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Rate Limit (RPM)
                  </label>
                  <input
                    type="number"
                    value={formRpm}
                    onChange={(e) => setFormRpm(Number(e.target.value))}
                    min={1}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Window (Seconds)
                  </label>
                  <input
                    type="number"
                    value={formWindow}
                    onChange={(e) => setFormWindow(Number(e.target.value))}
                    min={1}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Daily Token Quota (optional)
                  </label>
                  <input
                    type="number"
                    value={formDailyTokens}
                    onChange={(e) => setFormDailyTokens(e.target.value)}
                    placeholder="e.g. 500000"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Monthly Spend Cap ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formMonthlyCost}
                    onChange={(e) => setFormMonthlyCost(e.target.value)}
                    placeholder="e.g. 50.00"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Allowed Models (comma separated, or empty for all)
                </label>
                <input
                  type="text"
                  value={formAllowedModels}
                  onChange={(e) => setFormAllowedModels(e.target.value)}
                  placeholder="e.g. mock:default-chat, openai:gpt-4o"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Security Policy
                  </label>
                  <select
                    value={formSecPolicyId}
                    onChange={(e) => setFormSecPolicyId(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">(Default Policy)</option>
                    {secPolicies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (v{p.version})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Routing Policy
                  </label>
                  <select
                    value={formRoutePolicyId}
                    onChange={(e) => setFormRoutePolicyId(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">(Default Routing)</option>
                    {routePolicies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (v{p.version})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="edit-store-content"
                  checked={formStoreContent}
                  onChange={(e) => setFormStoreContent(e.target.checked)}
                  className="rounded border-white/10 bg-slate-900 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="edit-store-content" className="text-xs text-slate-300 cursor-pointer">
                  Opt-in to content payload storage in traces
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setEditClient(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 border border-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* KEY MANAGEMENT MODAL / DRAWER */}
      {selectedClientForKeys && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel border border-white/10 w-full max-w-2xl p-6 rounded-2xl shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-indigo-400" />
                  API Keys: {selectedClientForKeys.name}
                </h3>
                <p className="text-xs text-slate-400">
                  Manage active and revoked access credentials for this client.
                </p>
              </div>
              <button
                onClick={() => setSelectedClientForKeys(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Issue New Key Section */}
            <form
              onSubmit={handleCreateKey}
              className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-3"
            >
              <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                Issue New API Key
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Key Label</label>
                  <input
                    type="text"
                    value={keyLabel}
                    onChange={(e) => setKeyLabel(e.target.value)}
                    placeholder="e.g. backend-service-key"
                    className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Key Role</label>
                  <select
                    value={keyRole}
                    onChange={(e) => setKeyRole(e.target.value as "client" | "admin")}
                    className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="client">Client (Gateway Chat)</option>
                    <option value="admin">Admin (Full Control)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Expires (Days)</label>
                  <input
                    type="number"
                    min={1}
                    value={keyExpiresDays}
                    onChange={(e) => setKeyExpiresDays(e.target.value)}
                    placeholder="Never (leave blank)"
                    className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isCreatingKey || isDemoMode}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1.5 shadow-md shadow-indigo-500/20"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{isCreatingKey ? "Generating..." : "Generate Key"}</span>
                </button>
              </div>
            </form>

            {/* Keys Table */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Existing Keys ({clientKeys.length})
              </div>

              {isLoadingKeys ? (
                <div className="p-8 text-center text-slate-400">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-indigo-400" />
                  <p className="text-xs">Fetching keys...</p>
                </div>
              ) : clientKeys.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs bg-slate-900/30 rounded-xl border border-white/5">
                  No API keys issued for this client yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-white/5">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900/70 border-b border-white/5 text-slate-400">
                        <th className="p-3">Prefix</th>
                        <th className="p-3">Role</th>
                        <th className="p-3">Label</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Expires</th>
                        <th className="p-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-slate-300">
                      {clientKeys.map((k) => {
                        const isRevoked = k.status === "revoked";
                        return (
                          <tr key={k.id || k.prefix} className="hover:bg-white/[0.02]">
                            <td className="p-3 font-mono font-semibold text-indigo-300">
                              {k.prefix}...
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                                {k.role}
                              </span>
                            </td>
                            <td className="p-3 text-slate-400">{k.label || "—"}</td>
                            <td className="p-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                  isRevoked
                                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                }`}
                              >
                                {isRevoked ? "Revoked" : "Active"}
                              </span>
                            </td>
                            <td className="p-3 text-slate-400">
                              {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "Never"}
                            </td>
                            <td className="p-3 text-right">
                              {!isRevoked ? (
                                <button
                                  onClick={() => handleRevokeKey(k)}
                                  disabled={isDemoMode}
                                  className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40"
                                >
                                  Revoke
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-600">Inactive</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => setSelectedClientForKeys(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 border border-white/10 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ONE-TIME SECRET DISPLAY DIALOG (UI-006: Shown exactly once, wiped on dismiss) */}
      {oneTimeSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="secret-dialog-title"
            className="glass-panel border-2 border-amber-500/40 w-full max-w-lg p-6 rounded-2xl shadow-2xl relative space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 id="secret-dialog-title" className="text-base font-bold text-white">
                  API Key Created Successfully
                </h3>
                <p className="text-xs text-amber-300 mt-0.5">
                  Save this key immediately. For security reasons, this secret will{" "}
                  <strong>NEVER be shown again</strong> and cannot be retrieved later.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-950/90 rounded-xl border border-white/10 space-y-2">
              <div className="text-[11px] font-semibold text-slate-400">Full Raw API Key:</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={oneTimeSecret}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 select-all focus:outline-none"
                  data-testid="one-time-secret-input"
                />
                <button
                  type="button"
                  onClick={handleCopySecret}
                  data-testid="copy-secret-button"
                  className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                    hasCopiedSecret
                      ? "bg-emerald-600 text-white"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white"
                  }`}
                >
                  {hasCopiedSecret ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
              Closing this dialog will completely discard the raw token from browser memory. Store it
              securely in your secret manager or environment configuration.
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleCloseSecretDialog}
                data-testid="close-secret-dialog-button"
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 border border-white/10 transition-colors cursor-pointer"
              >
                I have copied my secret key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM REVOCATION DIALOG */}
      <ConfirmDialog
        isOpen={Boolean(keyToRevoke)}
        title="Revoke API Key"
        message={`Are you sure you want to revoke API key prefix "${keyToRevoke?.prefix}"? This action is immediate and will permanently prevent this key from authorizing future gateway calls.`}
        confirmLabel="Revoke Key"
        isDestructive={true}
        isLoading={isRevoking}
        onConfirm={confirmRevokeKey}
        onCancel={() => setKeyToRevoke(null)}
      />

      {/* CONFIRM TOGGLE STATUS DIALOG */}
      <ConfirmDialog
        isOpen={Boolean(clientToToggle)}
        title={clientToToggle?.status === "active" ? "Disable Client" : "Enable Client"}
        message={
          clientToToggle?.status === "active"
            ? `Disabling client "${clientToToggle?.name}" will immediately reject all inbound API requests made by its keys with an unauthorized error.`
            : `Enabling client "${clientToToggle?.name}" will restore gateway access for all its active keys.`
        }
        confirmLabel={clientToToggle?.status === "active" ? "Disable Client" : "Enable Client"}
        isDestructive={clientToToggle?.status === "active"}
        isLoading={isTogglingStatus}
        onConfirm={confirmToggleStatus}
        onCancel={() => setClientToToggle(null)}
      />
    </div>
  );
}
