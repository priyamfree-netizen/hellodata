import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState, useMemo, useEffect } from "react";
import { Plus, Zap, HardDrive, Search, ChevronRight, Check, X, Pencil, Users, CreditCard, RefreshCw, Gift } from "lucide-react";
import {
  usePlans,
  usePlanSubscriberCounts,
  useOrganizations,
  useAdminSettings,
  useSaveAdminSettings,
} from "@/lib/queries";
import { formatBytes, formatINR } from "@/lib/format";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccessToken, silentRefresh } from "@/lib/auth/client";
import type { Plan, Organization } from "@/lib/supabase/types";
import { FREE_PLAN_KEY, FREE_PLAN_DEFAULTS, normalizeFreePlan } from "@/lib/free-plan";

export const Route = createFileRoute("/admin/plans")({
  component: PlanManagement,
});

// =============================================================================
// Mutations
// =============================================================================

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getAccessToken();
  if (!token) { await silentRefresh(); token = getAccessToken(); }
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function adminPost<T>(path: string, body: unknown): Promise<T> {
  return adminFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

function adminGet<T>(path: string): Promise<T> {
  return adminFetch<T>(path);
}

function useUpsertPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan: {
      id?: string;
      code: string;
      name: string;
      price_amount_inr: number;
      is_custom_price: boolean;
      interval: "monthly" | "yearly";
      ai_token_limit: number | null;
      storage_limit_bytes: number | null;
      plan_type: "subscription" | "pay_as_you_go";
    }) => {
      await adminPost("/api/admin/plans", plan);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans"] }),
  });
}

function useGrantCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orgId, credits }: { orgId: string; credits: number }) => {
      await adminPost(`/api/admin/orgs/${orgId}/grant-credits`, { credits });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizations"] });
      qc.invalidateQueries({ queryKey: ["credit-grants"] });
    },
  });
}

function useGrantStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orgId, addBytes }: { orgId: string; addBytes: number }) => {
      await adminPost(`/api/admin/orgs/${orgId}/grant-storage`, { bytes: addBytes });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizations"] });
      qc.invalidateQueries({ queryKey: ["credit-grants"] });
    },
  });
}

// =============================================================================
// Root
// =============================================================================

type Tab = "plans" | "free" | "grants" | "pricing" | "gateway";

function PlanManagement() {
  const [tab, setTab] = useState<Tab>("plans");

  const tabs: { id: Tab; label: string }[] = [
    { id: "plans", label: "Plans" },
    { id: "free", label: "Free Plan Limits" },
    { id: "grants", label: "Add Credits / Storage" },
    { id: "pricing", label: "Credit Pricing" },
    { id: "gateway", label: "Payment Gateway" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Plans & Subscriptions</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">Credit & storage based billing — system validates only these two resources</p>
        </div>
        <button
          onClick={() => setTab("gateway")}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
            tab === "gateway"
              ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400"
              : "border-border/80 bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <CreditCard className="h-3 w-3" /> Payment Gateway
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 font-mono text-xs transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "border-blue-500 text-foreground"
                : "border-transparent text-muted-foreground/80 hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "plans" && <PlansTab />}
      {tab === "free" && <FreePlanTab />}
      {tab === "grants" && <GrantsTab />}
      {tab === "pricing" && <PricingTab />}
      {tab === "gateway" && <PaymentGatewayTab />}
    </div>
  );
}

// =============================================================================
// Plans Tab
// =============================================================================

interface PlanForm {
  id?: string;
  code: string;
  name: string;
  price: string;
  is_custom_price: boolean;
  interval: "monthly" | "yearly";
  plan_type: "subscription" | "pay_as_you_go";
  creditLimit: string;
  storageLimit: string;
  storageUnit: "MB" | "GB" | "TB";
}

const EMPTY_FORM: PlanForm = {
  code: "",
  name: "",
  price: "",
  is_custom_price: false,
  interval: "monthly",
  plan_type: "subscription",
  creditLimit: "",
  storageLimit: "",
  storageUnit: "GB",
};

const STORAGE_MULTIPLIER: Record<string, number> = {
  MB: 1_048_576,
  GB: 1_073_741_824,
  TB: 1_099_511_627_776,
};

function bytesToUnit(bytes: number): { value: string; unit: "MB" | "GB" | "TB" } {
  if (bytes >= STORAGE_MULTIPLIER.TB) return { value: String(bytes / STORAGE_MULTIPLIER.TB), unit: "TB" };
  if (bytes >= STORAGE_MULTIPLIER.GB) return { value: String(bytes / STORAGE_MULTIPLIER.GB), unit: "GB" };
  return { value: String(bytes / STORAGE_MULTIPLIER.MB), unit: "MB" };
}

function PlansTab() {
  const { data: dbPlans = [] } = usePlans();
  const { data: subCounts = {} } = usePlanSubscriberCounts();
  const upsert = useUpsertPlan();
  const [modal, setModal] = useState<PlanForm | null>(null);

  function openCreate() {
    setModal({ ...EMPTY_FORM });
  }

  function openEdit(p: Plan) {
    const storage = p.storage_limit_bytes != null ? bytesToUnit(p.storage_limit_bytes) : { value: "", unit: "GB" as const };
    setModal({
      id: p.id,
      code: p.code,
      name: p.name,
      price: p.is_custom_price ? "" : String(p.price_amount_inr ?? ""),
      is_custom_price: p.is_custom_price,
      interval: p.interval,
      plan_type: p.plan_type ?? "subscription",
      creditLimit: p.ai_token_limit == null ? "" : String(p.ai_token_limit),
      storageLimit: storage.value,
      storageUnit: storage.unit,
    });
  }

  async function handleSave() {
    if (!modal) return;
    const storageBytes = modal.storageLimit
      ? Math.round(parseFloat(modal.storageLimit) * STORAGE_MULTIPLIER[modal.storageUnit])
      : null;
    await upsert.mutateAsync({
      id: modal.id,
      code: modal.code || modal.name.toLowerCase().replace(/\s+/g, "_"),
      name: modal.name,
      price_amount_inr: modal.is_custom_price ? 0 : Number(modal.price),
      is_custom_price: modal.is_custom_price,
      interval: modal.interval,
      plan_type: modal.plan_type,
      ai_token_limit: modal.creditLimit ? Number(modal.creditLimit) : null,
      storage_limit_bytes: storageBytes,
    });
    setModal(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-md border border-border/80 bg-muted px-3 py-1.5 font-mono text-[11px] text-foreground/80 hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" /> Create Plan
        </button>
      </div>

      {/* Plan Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {dbPlans.map((plan) => {
          const subs = subCounts[plan.id] ?? 0;
          return (
            <div key={plan.id} className="rounded-lg border border-border bg-surface">
              {/* Header */}
              <div className="border-b border-border/50 px-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{plan.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${
                      plan.status === "active"
                        ? "border-emerald-500/20 text-emerald-400"
                        : plan.status === "archived"
                          ? "border-zinc-600/20 text-muted-foreground/80"
                          : "border-amber-500/20 text-amber-400"
                    }`}
                  >
                    {plan.status}
                  </span>
                </div>
                <div className="mt-2 font-mono text-2xl font-bold text-foreground">
                  {plan.plan_type === "pay_as_you_go"
                    ? "Pay As You Go"
                    : plan.is_custom_price ? "Custom" : formatINR(Number(plan.price_amount_inr ?? 0))}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground/80">
                  {plan.plan_type === "pay_as_you_go" ? "per usage" : `/${plan.interval}`}
                </div>
                <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                  {subs} subscriber{subs !== 1 ? "s" : ""}
                </div>
              </div>

              {/* Credits + Storage */}
              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span className="font-mono text-[11px] text-muted-foreground/80">Credits</span>
                  <span className="ml-auto font-mono text-[11px] text-foreground/80">
                    {plan.ai_token_limit == null ? "Unlimited" : plan.ai_token_limit.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span className="font-mono text-[11px] text-muted-foreground/80">Storage</span>
                  <span className="ml-auto font-mono text-[11px] text-foreground/80">
                    {plan.storage_limit_bytes == null ? "Unlimited" : formatBytes(plan.storage_limit_bytes)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="border-t border-border/50 px-3 py-2">
                <button
                  onClick={() => openEdit(plan)}
                  className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] text-muted-foreground/80 hover:text-foreground/80 hover:bg-muted"
                >
                  <Pencil className="h-2.5 w-2.5" /> Edit
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h2 className="text-sm font-semibold">{modal.id ? "Edit Plan" : "Create Plan"}</h2>

            <div className="mt-4 space-y-3">
              <Field label="Plan Name">
                <input
                  value={modal.name}
                  onChange={(e) => setModal((m) => m && { ...m, name: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. Starter"
                />
              </Field>

              <Field label="Plan Type">
                <div className="flex gap-2">
                  {(["subscription", "pay_as_you_go"] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setModal((m) => m && { ...m, plan_type: pt })}
                      className={`flex-1 rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                        modal.plan_type === pt
                          ? "border-blue-500/60 bg-blue-500/10 text-blue-400"
                          : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {pt === "subscription" ? "Subscription" : "Pay As You Go"}
                    </button>
                  ))}
                </div>
              </Field>

              {modal.plan_type === "subscription" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Interval">
                      <select
                        value={modal.interval}
                        onChange={(e) =>
                          setModal((m) => m && { ...m, interval: e.target.value as "monthly" | "yearly" })
                        }
                        className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </Field>

                    <Field label="Price (INR)">
                      <input
                        value={modal.price}
                        onChange={(e) =>
                          setModal((m) => m && { ...m, price: e.target.value, is_custom_price: false })
                        }
                        disabled={modal.is_custom_price}
                        type="number"
                        min="0"
                        className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                        placeholder="e.g. 1999"
                      />
                    </Field>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modal.is_custom_price}
                      onChange={(e) => setModal((m) => m && { ...m, is_custom_price: e.target.checked })}
                      className="accent-blue-500"
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">Custom / Enterprise pricing</span>
                  </label>
                </>
              )}

              {modal.plan_type === "pay_as_you_go" && (
                <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 font-mono text-[10px] text-amber-400/80">
                  Pay As You Go orgs are billed per credit/storage unit — set unit prices in the Credit Pricing tab.
                </p>
              )}

              <Field label="Credits (blank = unlimited)">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <input
                    value={modal.creditLimit}
                    onChange={(e) => setModal((m) => m && { ...m, creditLimit: e.target.value })}
                    type="number"
                    min="0"
                    className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. 500000"
                  />
                </div>
              </Field>

              <Field label="Storage (blank = unlimited)">
                <div className="flex gap-2">
                  <HardDrive className="h-3.5 w-3.5 text-blue-400 shrink-0 self-center" />
                  <input
                    value={modal.storageLimit}
                    onChange={(e) => setModal((m) => m && { ...m, storageLimit: e.target.value })}
                    type="number"
                    min="0"
                    className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. 50"
                  />
                  <select
                    value={modal.storageUnit}
                    onChange={(e) =>
                      setModal((m) => m && { ...m, storageUnit: e.target.value as "MB" | "GB" | "TB" })
                    }
                    className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option>MB</option>
                    <option>GB</option>
                    <option>TB</option>
                  </select>
                </div>
              </Field>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setModal(null)}
                className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!modal.name || upsert.isPending}
                className="rounded-md bg-blue-600 px-4 py-1.5 font-mono text-[11px] text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {upsert.isPending ? "Saving…" : "Save Plan"}
              </button>
            </div>

            {upsert.isError && (
              <p className="mt-2 font-mono text-[10px] text-red-400">
                {String((upsert.error as Error)?.message ?? "Unknown error")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Grants Tab
// =============================================================================

interface GrantLog {
  orgName: string;
  type: "Credits" | "Storage";
  amount: string;
  at: string;
}

function GrantsTab() {
  const { data: orgs = [] } = useOrganizations({ limit: 200 });
  const grantCredits = useGrantCredits();
  const grantStorage = useGrantStorage();

  const [search, setSearch] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [credits, setCredits] = useState("");
  const [storageAmt, setStorageAmt] = useState("");
  const [storageUnit, setStorageUnit] = useState<"MB" | "GB" | "TB">("GB");
  const [log, setLog] = useState<GrantLog[]>([]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orgs.filter((o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q));
  }, [orgs, search]);

  const isPending = grantCredits.isPending || grantStorage.isPending;
  const isError = grantCredits.isError || grantStorage.isError;

  async function handleGrant() {
    if (!selectedOrg || isPending) return;
    const newEntries: GrantLog[] = [];

    if (credits) {
      await grantCredits.mutateAsync({ orgId: selectedOrg.id, credits: Number(credits) });
      newEntries.push({
        orgName: selectedOrg.name,
        type: "Credits",
        amount: `+${Number(credits).toLocaleString("en-IN")}`,
        at: new Date().toLocaleTimeString(),
      });
    }

    if (storageAmt) {
      const addBytes = Math.round(parseFloat(storageAmt) * STORAGE_MULTIPLIER[storageUnit]);
      await grantStorage.mutateAsync({ orgId: selectedOrg.id, addBytes });
      newEntries.push({
        orgName: selectedOrg.name,
        type: "Storage",
        amount: `+${storageAmt} ${storageUnit}`,
        at: new Date().toLocaleTimeString(),
      });
    }

    if (newEntries.length) {
      setLog((l) => [...newEntries, ...l].slice(0, 20));
      setCredits("");
      setStorageAmt("");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Org Search List */}
      <div className="rounded-lg border border-border bg-surface flex flex-col">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 pl-8 pr-3 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Search organisations…"
            />
          </div>
        </div>
        <div className="flex-1 divide-y divide-border/50 overflow-y-auto max-h-[420px]">
          {filtered.map((org) => (
            <button
              key={org.id}
              onClick={() => {
                setSelectedOrg(org);
                setCredits("");
                setStorageAmt("");
              }}
              className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors ${
                selectedOrg?.id === org.id
                  ? "bg-blue-500/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="flex-1 font-mono text-[11px] truncate">{org.name}</span>
              <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
            </button>
          ))}
        </div>
      </div>

      {/* Right Panel */}
      <div className="space-y-4">
        {selectedOrg ? (
          <>
            {/* Org Info Card */}
            <div className="rounded-lg border border-border bg-surface px-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{selectedOrg.name}</h3>
                  <p className="font-mono text-[10px] text-muted-foreground/80">{selectedOrg.slug}</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${
                    selectedOrg.status === "active"
                      ? "border-emerald-500/20 text-emerald-400"
                      : "border-zinc-600/20 text-muted-foreground/80"
                  }`}
                >
                  {selectedOrg.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <HardDrive className="h-3 w-3 text-blue-400" />
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80">Storage</span>
                  </div>
                  <p className="font-mono text-[12px] text-foreground">
                    {formatBytes(selectedOrg.storage_used_bytes)}{" "}
                    <span className="text-muted-foreground/60">/ {formatBytes(selectedOrg.storage_limit_bytes)}</span>
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Users className="h-3 w-3 text-purple-400" />
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80">Team</span>
                  </div>
                  <p className="font-mono text-[12px] text-foreground">{selectedOrg.team_size} members</p>
                </div>
              </div>
            </div>

            {/* Grant Form */}
            <div className="rounded-lg border border-border bg-surface px-4 py-4">
              <h3 className="text-sm font-medium mb-3">Grant Credits / Storage</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Credits to Add">
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <input
                      value={credits}
                      onChange={(e) => setCredits(e.target.value)}
                      type="number"
                      min="0"
                      className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>
                </Field>

                <Field label="Storage to Add">
                  <div className="flex gap-2">
                    <HardDrive className="h-3.5 w-3.5 text-blue-400 shrink-0 self-center" />
                    <input
                      value={storageAmt}
                      onChange={(e) => setStorageAmt(e.target.value)}
                      type="number"
                      min="0"
                      className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="0"
                    />
                    <select
                      value={storageUnit}
                      onChange={(e) => setStorageUnit(e.target.value as "MB" | "GB" | "TB")}
                      className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option>MB</option>
                      <option>GB</option>
                      <option>TB</option>
                    </select>
                  </div>
                </Field>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleGrant}
                  disabled={isPending || (!credits && !storageAmt)}
                  className="rounded-md bg-blue-600 px-4 py-1.5 font-mono text-[11px] text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Granting…" : "Grant"}
                </button>
                {(grantCredits.isSuccess || grantStorage.isSuccess) && !isPending && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                    <Check className="h-3 w-3" /> Granted
                  </span>
                )}
                {isError && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-red-400">
                    <X className="h-3 w-3" /> Failed —{" "}
                    {String((grantCredits.error as Error | null)?.message ?? (grantStorage.error as Error | null)?.message ?? "Unknown error")}
                  </span>
                )}
              </div>
            </div>

            {/* Session Log */}
            {log.length > 0 && (
              <div className="rounded-lg border border-border bg-surface">
                <div className="border-b border-border px-4 py-2.5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Session Grant Log</p>
                </div>
                <div className="divide-y divide-border/50">
                  {log.map((g, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2 font-mono text-[11px]">
                      <span className="w-16 shrink-0 text-muted-foreground/60">{g.at}</span>
                      <span className="flex-1 truncate text-foreground/80">{g.orgName}</span>
                      <span className={`w-16 text-right ${g.type === "Credits" ? "text-amber-400" : "text-blue-400"}`}>
                        {g.type}
                      </span>
                      <span className="w-24 text-right text-emerald-400">{g.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border">
            <p className="font-mono text-[11px] text-muted-foreground/60">
              Select an organisation to grant credits or storage
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Free Plan Limits Tab — reads/writes admin_settings.free_plan
// -----------------------------------------------------------------------------
// Controls the allotment every user receives on their first sign-up. Applied at
// first-org creation by the apply_free_plan_grant() DB function. Also drives the
// "Free" card on the public pricing page and the in-app Billing & Plans page.
// =============================================================================

function FreePlanTab() {
  const { data: raw, isLoading } = useAdminSettings(FREE_PLAN_KEY);
  const save = useSaveAdminSettings();

  const [form, setForm] = useState({
    enabled: FREE_PLAN_DEFAULTS.enabled,
    name: FREE_PLAN_DEFAULTS.name,
    description: FREE_PLAN_DEFAULTS.description,
    credits: String(FREE_PLAN_DEFAULTS.credits),
    storage: bytesToUnit(FREE_PLAN_DEFAULTS.storage_bytes).value,
    storageUnit: bytesToUnit(FREE_PLAN_DEFAULTS.storage_bytes).unit as "MB" | "GB" | "TB",
  });

  // Sync DB values into the form once they load.
  useEffect(() => {
    if (raw == null) return;
    const cfg = normalizeFreePlan(raw);
    const s = bytesToUnit(cfg.storage_bytes);
    setForm({
      enabled: cfg.enabled,
      name: cfg.name,
      description: cfg.description,
      credits: String(cfg.credits),
      storage: s.value,
      storageUnit: s.unit,
    });
  }, [raw]);

  const storageBytes = form.storage
    ? Math.round(parseFloat(form.storage) * STORAGE_MULTIPLIER[form.storageUnit])
    : 0;

  function handleSave() {
    save.mutate({
      key: FREE_PLAN_KEY,
      value: {
        enabled: form.enabled,
        name: form.name.trim() || FREE_PLAN_DEFAULTS.name,
        description: form.description.trim(),
        credits: Math.max(0, Math.floor(Number(form.credits) || 0)),
        storage_bytes: Math.max(0, storageBytes),
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 font-mono text-[11px] text-muted-foreground/60">
        <RefreshCw className="h-3 w-3 animate-spin" /> Loading free plan config…
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      {/* Summary banner */}
      <div
        className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 font-mono text-[11px] ${
          form.enabled
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
            : "border-zinc-600/30 bg-muted/40 text-muted-foreground"
        }`}
      >
        <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {form.enabled ? (
            <>
              Every new user receives{" "}
              <strong className="text-foreground">
                {Math.max(0, Math.floor(Number(form.credits) || 0)).toLocaleString("en-IN")} credits
              </strong>{" "}
              and <strong className="text-foreground">{formatBytes(storageBytes)}</strong> storage on
              their first sign-up.
            </>
          ) : (
            "Free plan is disabled — new users receive no signup grant and no free card is shown."
          )}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        {/* Enabled toggle */}
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div>
            <div className="text-sm font-medium text-foreground">Free plan enabled</div>
            <p className="font-mono text-[10px] text-muted-foreground/80">
              Grant credits/storage at signup &amp; show the free card publicly
            </p>
          </div>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            className="h-4 w-4 accent-emerald-500"
          />
        </label>

        <div className="h-px bg-border/60" />

        <Field label="Display Name">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Free"
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <Field label="Description (shown on pricing page)">
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            placeholder="Everything you need to get started…"
            className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <Field label="Signup Credits">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <input
              value={form.credits}
              onChange={(e) => setForm((f) => ({ ...f, credits: e.target.value }))}
              type="number"
              min="0"
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="50"
            />
          </div>
        </Field>

        <Field label="Signup Storage">
          <div className="flex gap-2">
            <HardDrive className="h-3.5 w-3.5 text-blue-400 shrink-0 self-center" />
            <input
              value={form.storage}
              onChange={(e) => setForm((f) => ({ ...f, storage: e.target.value }))}
              type="number"
              min="0"
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="100"
            />
            <select
              value={form.storageUnit}
              onChange={(e) =>
                setForm((f) => ({ ...f, storageUnit: e.target.value as "MB" | "GB" | "TB" }))
              }
              className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option>MB</option>
              <option>GB</option>
              <option>TB</option>
            </select>
          </div>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={save.isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 font-mono text-[11px] text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {save.isPending ? "Saving…" : "Save Free Plan"}
        </button>
        {save.isSuccess && !save.isPending && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
            <Check className="h-3 w-3" /> Saved to database
          </span>
        )}
        {save.isError && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-red-400">
            <X className="h-3 w-3" /> {String((save.error as Error)?.message ?? "Failed")}
          </span>
        )}
      </div>

      <p className="font-mono text-[10px] text-muted-foreground/60">
        Changes apply to new sign-ups going forward. Existing organizations are unaffected — use the
        “Add Credits / Storage” tab to adjust them individually.
      </p>
    </div>
  );
}

// =============================================================================
// Pricing Tab — reads/writes admin_settings.credit_pricing via RPC
// =============================================================================

interface PricingConfig {
  credit_price_inr: number;
  credit_unit: number;
  storage_price_inr: number;
  storage_unit_gb: number;
}

const PRICING_KEY = "credit_pricing";
const PRICING_DEFAULTS: PricingConfig = {
  credit_price_inr: 10,
  credit_unit: 1000,
  storage_price_inr: 50,
  storage_unit_gb: 1,
};

function PricingTab() {
  const { data: raw, isLoading } = useAdminSettings(PRICING_KEY);
  const save = useSaveAdminSettings();

  const db = (raw ?? PRICING_DEFAULTS) as PricingConfig;

  const [form, setForm] = useState({
    creditPrice: String(PRICING_DEFAULTS.credit_price_inr),
    creditUnit: String(PRICING_DEFAULTS.credit_unit),
    storagePrice: String(PRICING_DEFAULTS.storage_price_inr),
    storageUnitGb: String(PRICING_DEFAULTS.storage_unit_gb),
  });

  // Sync DB values into local form once they load
  useEffect(() => {
    if (!raw) return;
    setForm({
      creditPrice: String(db.credit_price_inr),
      creditUnit: String(db.credit_unit),
      storagePrice: String(db.storage_price_inr),
      storageUnitGb: String(db.storage_unit_gb),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function handleSave() {
    save.mutate({
      key: PRICING_KEY,
      value: {
        credit_price_inr: Number(form.creditPrice),
        credit_unit: Number(form.creditUnit),
        storage_price_inr: Number(form.storagePrice),
        storage_unit_gb: Number(form.storageUnitGb),
      },
    });
  }

  const creditPerK = ((Number(form.creditPrice) / Number(form.creditUnit || 1)) * 1000).toFixed(4);
  const storagePerGb = (Number(form.storagePrice) / Number(form.storageUnitGb || 1)).toFixed(2);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 font-mono text-[11px] text-muted-foreground/60">
        <div className="h-3 w-3 animate-spin rounded-full border border-muted-foreground/40 border-t-transparent" />
        Loading pricing config…
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      {/* Credit Pricing */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="text-sm font-medium">Credit Pricing</h3>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80 mb-4">
          Price users pay when self-purchasing additional credits
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="font-mono text-[11px] text-muted-foreground/80">₹</span>
          <input
            value={form.creditPrice}
            onChange={set("creditPrice")}
            type="number"
            min="0"
            className="w-24 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="font-mono text-[11px] text-muted-foreground/80">per</span>
          <input
            value={form.creditUnit}
            onChange={set("creditUnit")}
            type="number"
            min="1"
            className="w-24 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="font-mono text-[11px] text-muted-foreground/80">credits</span>
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground/60">= ₹{creditPerK} per 1,000 credits</p>
      </div>

      {/* Storage Pricing */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="text-sm font-medium">Storage Pricing</h3>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80 mb-4">
          Price users pay when self-purchasing additional storage
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <HardDrive className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          <span className="font-mono text-[11px] text-muted-foreground/80">₹</span>
          <input
            value={form.storagePrice}
            onChange={set("storagePrice")}
            type="number"
            min="0"
            className="w-24 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="font-mono text-[11px] text-muted-foreground/80">per</span>
          <input
            value={form.storageUnitGb}
            onChange={set("storageUnitGb")}
            type="number"
            min="1"
            className="w-24 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="font-mono text-[11px] text-muted-foreground/80">GB</span>
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground/60">= ₹{storagePerGb} per GB</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={save.isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 font-mono text-[11px] text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {save.isPending ? "Saving…" : "Save Pricing"}
        </button>
        {save.isSuccess && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
            <Check className="h-3 w-3" /> Saved to database
          </span>
        )}
        {save.isError && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-red-400">
            <X className="h-3 w-3" /> {String((save.error as Error)?.message ?? "Failed")}
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Payment Gateway Tab
// =============================================================================

interface RazorpayConfigView {
  key_id: string;
  key_secret_masked: string;
  webhook_secret_masked: string;
  test_mode: boolean;
  currency: string;
  configured: boolean;
}

function PaymentGatewayTab() {
  const [form, setForm] = useState({
    key_id: "",
    key_secret: "",
    webhook_secret: "",
    test_mode: true,
    currency: "INR",
  });
  const [masks, setMasks] = useState({ key_secret: "", webhook_secret: "" });
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    adminGet<RazorpayConfigView>("/api/admin/razorpay-config")
      .then((data) => {
        setForm((f) => ({ ...f, key_id: data.key_id, test_mode: data.test_mode, currency: data.currency }));
        setMasks({ key_secret: data.key_secret_masked, webhook_secret: data.webhook_secret_masked });
        setConfigured(data.configured);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    try {
      await adminPost("/api/admin/razorpay-config", {
        key_id: form.key_id,
        key_secret: form.key_secret || undefined,
        webhook_secret: form.webhook_secret || undefined,
        test_mode: form.test_mode,
        currency: form.currency,
      });
      setStatus("saved");
      setConfigured(Boolean(form.key_id));
      setForm((f) => ({ ...f, key_secret: "", webhook_secret: "" }));
    } catch (e) {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/payment/webhook`
    : "/api/payment/webhook";

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 font-mono text-[11px] text-muted-foreground/60">
        <RefreshCw className="h-3 w-3 animate-spin" /> Loading configuration…
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      {/* Status Banner */}
      <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 font-mono text-[11px] ${
        configured
          ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
          : "border-amber-500/20 bg-amber-500/5 text-amber-400"
      }`}>
        <CreditCard className="h-3.5 w-3.5 shrink-0" />
        <span>{configured ? "Razorpay is configured and active" : "Razorpay not configured — enter your API keys below"}</span>
        {form.test_mode && configured && (
          <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-400">TEST MODE</span>
        )}
      </div>

      {/* Keys Form */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <h3 className="text-sm font-medium">API Credentials</h3>

        <Field label="Key ID (Public)">
          <input
            value={form.key_id}
            onChange={(e) => setForm((f) => ({ ...f, key_id: e.target.value }))}
            placeholder="rzp_test_... or rzp_live_..."
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <Field label={masks.key_secret ? `Key Secret (current: ${masks.key_secret})` : "Key Secret"}>
          <input
            type="password"
            value={form.key_secret}
            onChange={(e) => setForm((f) => ({ ...f, key_secret: e.target.value }))}
            placeholder={masks.key_secret ? "Leave blank to keep existing" : "Enter key secret…"}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <Field label={masks.webhook_secret ? `Webhook Secret (current: ${masks.webhook_secret})` : "Webhook Secret"}>
          <input
            type="password"
            value={form.webhook_secret}
            onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
            placeholder={masks.webhook_secret ? "Leave blank to keep existing" : "Enter webhook secret…"}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency">
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="SGD">SGD (S$)</option>
            </select>
          </Field>

          <Field label="Mode">
            <label className="flex h-9 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.test_mode}
                onChange={(e) => setForm((f) => ({ ...f, test_mode: e.target.checked }))}
                className="accent-amber-500"
              />
              <span className="font-mono text-[11px] text-muted-foreground">Test Mode</span>
            </label>
          </Field>
        </div>
      </div>

      {/* Webhook Info */}
      <div className="rounded-lg border border-border/50 bg-surface-2 p-4 space-y-2">
        <p className="font-mono text-[10px] text-muted-foreground/80 font-semibold">Webhook Configuration</p>
        <p className="font-mono text-[10px] text-muted-foreground/70">
          Add this URL to Razorpay Dashboard → Settings → Webhooks:
        </p>
        <code className="block rounded bg-surface px-3 py-2 font-mono text-[11px] text-blue-400 select-all break-all">
          {webhookUrl}
        </code>
        <p className="font-mono text-[10px] text-muted-foreground/60">
          Active events: <strong className="text-muted-foreground">payment.captured</strong>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !form.key_id}
          className="rounded-md bg-blue-600 px-4 py-1.5 font-mono text-[11px] text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Configuration"}
        </button>
        {status === "saved" && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
        {status === "error" && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-red-400">
            <X className="h-3 w-3" /> {errMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Shared
// =============================================================================

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">{label}</label>
      {children}
    </div>
  );
}
