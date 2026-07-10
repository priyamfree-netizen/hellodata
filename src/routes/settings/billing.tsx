import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { Check, Download, Zap, HardDrive, Loader2, X, Minus, Plus, CreditCard, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import { NoSectionAccess, ReadOnlyBanner } from "@/components/section-gate";
import { useSubscription, useInvoices, usePaymentMethods, usePlans, useAdminSettings } from "@/lib/queries";
import { formatBytes, formatDateShort, formatINR } from "@/lib/format";
import { getAccessToken, silentRefresh } from "@/lib/auth/client";
import { useQueryClient } from "@tanstack/react-query";
import { FREE_PLAN_KEY, normalizeFreePlan, isFreePlanRow } from "@/lib/free-plan";

export const Route = createFileRoute("/settings/billing")({
  component: BillingSettings,
});

// ── Storage unit helpers ──────────────────────────────────────────────────────

const STORAGE_MULTIPLIER: Record<StorageUnit, number> = {
  MB: 1_048_576,
  GB: 1_073_741_824,
  TB: 1_099_511_627_776,
};

type StorageUnit = "MB" | "GB" | "TB";

const STORAGE_STEPS: Record<StorageUnit, number> = { MB: 100, GB: 1, TB: 1 };
const STORAGE_MIN: Record<StorageUnit, number> = { MB: 100, GB: 1, TB: 1 };

// ── Razorpay API helpers ──────────────────────────────────────────────────────

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

type RzpOrderResponse = {
  order_id: string;
  rzp_order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  description: string;
};

type RzpPaymentSuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

declare global {
  interface Window {
    Razorpay: new (opts: RazorpayOptions) => { open(): void };
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (response: RzpPaymentSuccess) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
  prefill?: { name?: string; email?: string };
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById("rzp-js")) { resolve(); return; }
    const s = document.createElement("script");
    s.id = "rzp-js";
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.head.appendChild(s);
  });
}

async function openRazorpayCheckout(
  order: RzpOrderResponse,
  onSuccess: () => void,
  onError: (msg: string) => void,
  opts?: { name?: string; email?: string },
): Promise<void> {
  await loadRazorpayScript();
  const rzp = new window.Razorpay({
    key: order.key_id,
    amount: order.amount,
    currency: order.currency,
    order_id: order.rzp_order_id,
    name: "HelloData",
    description: order.description,
    prefill: { name: opts?.name, email: opts?.email },
    theme: { color: "#3b82f6" },
    handler: async (response) => {
      try {
        await authFetch("/api/payment/verify", {
          method: "POST",
          body: JSON.stringify({
            order_id: order.order_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        onSuccess();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Payment verification failed");
      }
    },
    modal: { ondismiss: () => onError("Payment cancelled") },
  });
  rzp.open();
}

// ── Pricing defaults (overridden by admin_settings) ───────────────────────────

interface CreditPricing {
  credit_price_inr: number;
  credit_unit: number;
  storage_price_inr: number;
  storage_unit_gb: number;
}

const PRICING_DEFAULTS: CreditPricing = {
  credit_price_inr: 10,
  credit_unit: 1000,
  storage_price_inr: 50,
  storage_unit_gb: 1,
};

// ── Main component ────────────────────────────────────────────────────────────

function BillingSettings() {
  const { currentOrg, user, profile } = useAuth();
  const sectionLevel = useSectionAccess("billing");
  const canEdit = sectionLevel === "edit";
  const orgId = currentOrg?.id;
  const qc = useQueryClient();

  const { data: sub } = useSubscription(orgId);
  const { data: invoices = [], isLoading: invLoading } = useInvoices(orgId, 6);
  const { data: methods = [] } = usePaymentMethods(orgId);
  const { data: plans = [] } = usePlans();
  const { data: pricingRaw } = useAdminSettings("credit_pricing");
  const { data: freeRaw } = useAdminSettings(FREE_PLAN_KEY);
  const pricing = ((pricingRaw ?? PRICING_DEFAULTS) as CreditPricing);
  const freePlan = normalizeFreePlan(freeRaw);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // tracks which action is loading

  // Credits
  const [creditQty, setCreditQty] = useState(pricing.credit_unit || 1000);

  // Storage
  const [storageQty, setStorageQty] = useState(1);
  const [storageUnit, setStorageUnit] = useState<StorageUnit>("GB");

  // Sync creditQty to pricing unit when it loads
  useEffect(() => {
    if (pricing.credit_unit) setCreditQty(pricing.credit_unit);
  }, [pricing.credit_unit]);

  const creditUnit = pricing.credit_unit || 1000;
  const creditPricePerUnit = pricing.credit_price_inr || 10;
  const storagePerGb = pricing.storage_price_inr / (pricing.storage_unit_gb || 1);

  function storagePriceForUnit(unit: StorageUnit, qty: number): number {
    const gb = (qty * STORAGE_MULTIPLIER[unit]) / STORAGE_MULTIPLIER.GB;
    return Math.ceil(gb * storagePerGb);
  }

  const creditCost = Math.ceil((creditQty / creditUnit) * creditPricePerUnit);
  const storageCost = storagePriceForUnit(storageUnit, storageQty);

  const usedStorage = currentOrg?.storage_used_bytes ?? 0;
  const limitStorage = currentOrg?.storage_limit_bytes ?? 0;
  const hasActiveSub = sub?.status === "active" || sub?.status === "trialing";
  const nextPayment = sub?.current_period_end ? formatDateShort(sub.current_period_end) : null;

  // Real available-credits math mirrors the org_credit_summary DB view:
  //   plan credits (only while subscribed) + purchased + granted − used.
  // A null plan credit limit means the active plan is unlimited.
  const planCredits = hasActiveSub ? sub?.plan?.ai_token_limit ?? null : 0;
  const unlimitedCredits = hasActiveSub && sub?.plan?.ai_token_limit == null;
  const grantedCredits = currentOrg?.granted_credits ?? 0;
  const purchasedCredits = currentOrg?.purchased_credits ?? 0;
  const usedCredits = currentOrg?.credits_used ?? 0;
  const creditsTotal = (planCredits ?? 0) + grantedCredits + purchasedCredits;
  const creditsAvailable = Math.max(0, creditsTotal - usedCredits);

  const startPayment = useCallback(
    async (
      type: "subscription" | "credits" | "storage",
      extras: Record<string, unknown> = {},
    ) => {
      if (!canEdit) return;
      setError(null);
      setBusy(type);
      try {
        const order = await authFetch<RzpOrderResponse>("/api/payment/create-order", {
          method: "POST",
          body: JSON.stringify({ type, org_id: orgId, ...extras }),
        });
        await new Promise<void>((resolve, reject) => {
          openRazorpayCheckout(
            order,
            () => {
              qc.invalidateQueries({ queryKey: ["subscription"] });
              qc.invalidateQueries({ queryKey: ["organizations"] });
              resolve();
            },
            (msg) => {
              if (msg !== "Payment cancelled") reject(new Error(msg));
              else resolve();
            },
            { name: profile?.full_name ?? undefined, email: user?.email ?? undefined },
          );
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Payment failed");
      } finally {
        setBusy(null);
      }
    },
    [orgId, qc, user, profile, canEdit],
  );

  if (sectionLevel === "none") {
    return <NoSectionAccess section="billing" />;
  }

  if (!currentOrg) {
    return (
      <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground">
        Create or join an organization to manage billing.
      </div>
    );
  }

  // The free tier is rendered from admin_settings.free_plan (single source of
  // truth) — exclude the legacy seed "free" plans-table row from the paid list.
  const subscriptionPlans = plans.filter(
    (p) => !p.is_custom_price && p.plan_type !== "pay_as_you_go" && !isFreePlanRow(p),
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Billing & Plans</h2>
        <p className="mt-1 text-sm text-muted-foreground">Subscribe to a plan or top up credits and storage anytime.</p>
      </div>

      {sectionLevel === "view" && <ReadOnlyBanner section="billing" />}

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* ── Section 1: Subscribe to a Plan ───────────────────────── */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Subscribe to a Plan</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasActiveSub
                ? `Currently on ${sub?.plan?.name ?? "—"}${nextPayment ? ` · next payment ${nextPayment}` : ""}`
                : `Currently on the ${freePlan.name} plan — upgrade anytime for more credits & storage`}
            </p>
          </div>
        </div>

        <div className="p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Free tier — the baseline every account starts on. */}
            {freePlan.enabled && (
              <div
                className={`relative flex flex-col rounded-xl border p-5 transition-colors ${
                  !hasActiveSub
                    ? "border-blue-500/50 bg-blue-500/5"
                    : "border-border bg-background"
                }`}
              >
                {!hasActiveSub && (
                  <span className="absolute -top-2.5 left-4 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-medium text-blue-400">
                    Current Plan
                  </span>
                )}

                <div className="mb-4">
                  <div className="text-sm font-semibold text-foreground">{freePlan.name}</div>
                  <div className="mt-1">
                    <span className="text-2xl font-bold text-foreground">Free</span>
                    <span className="text-xs text-muted-foreground">/forever</span>
                  </div>
                </div>

                <div className="mb-5 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span>{freePlan.credits.toLocaleString("en-IN")} signup credits</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <HardDrive className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    <span>{formatBytes(freePlan.storage_bytes)} storage</span>
                  </div>
                </div>

                <button
                  disabled
                  className="mt-auto w-full rounded-lg border border-border bg-muted/40 py-2 text-sm font-medium text-muted-foreground cursor-default"
                >
                  {!hasActiveSub ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Check className="h-3.5 w-3.5" /> Current Plan
                    </span>
                  ) : (
                    "Included"
                  )}
                </button>
              </div>
            )}

            {subscriptionPlans.map((p) => {
              const isCurrent = sub?.plan_id === p.id;
              const isPending = busy === "subscription";
              return (
                <div
                  key={p.id}
                  className={`relative flex flex-col rounded-xl border p-5 transition-colors ${
                    isCurrent
                      ? "border-blue-500/50 bg-blue-500/5"
                      : "border-border bg-background hover:border-border/80"
                  }`}
                >
                  {isCurrent && (
                    <span className="absolute -top-2.5 left-4 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-medium text-blue-400">
                      Current Plan
                    </span>
                  )}

                  <div className="mb-4">
                    <div className="text-sm font-semibold text-foreground">{p.name}</div>
                    <div className="mt-1">
                      <span className="text-2xl font-bold text-foreground">
                        {p.price_amount_inr != null ? formatINR(Number(p.price_amount_inr)) : "Free"}
                      </span>
                      <span className="text-xs text-muted-foreground">/{p.interval ?? "mo"}</span>
                    </div>
                  </div>

                  <div className="mb-5 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span>
                        {p.ai_token_limit == null
                          ? "Unlimited credits"
                          : `${p.ai_token_limit.toLocaleString("en-IN")} credits`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <HardDrive className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span>
                        {p.storage_limit_bytes == null
                          ? "Unlimited storage"
                          : `${formatBytes(p.storage_limit_bytes)} storage`}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => !isCurrent && startPayment("subscription", { plan_id: p.id })}
                    disabled={isCurrent || isPending || !canEdit}
                    className={`mt-auto w-full rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                      isCurrent
                        ? "border border-blue-500/30 bg-blue-500/10 text-blue-400 cursor-default"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {isPending && !isCurrent ? (
                      <Loader2 className="h-4 w-4 animate-spin inline" />
                    ) : isCurrent ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Check className="h-3.5 w-3.5" /> Subscribed
                      </span>
                    ) : (
                      "Subscribe"
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Usage Bars */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 rounded-lg border border-border bg-surface-2 p-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <HardDrive className="h-3 w-3 text-blue-400" />
                <span className="text-xs text-muted-foreground">Storage Used</span>
                <span className="ml-auto font-mono text-xs text-foreground/80">
                  {formatBytes(usedStorage)} / {formatBytes(limitStorage)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: limitStorage ? `${Math.min(100, (usedStorage / limitStorage) * 100)}%` : "0%" }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap className="h-3 w-3 text-amber-400" />
                <span className="text-xs text-muted-foreground">Credits Remaining</span>
                <span className="ml-auto font-mono text-xs text-foreground/80">
                  {unlimitedCredits
                    ? "Unlimited"
                    : `${creditsAvailable.toLocaleString("en-IN")} / ${creditsTotal.toLocaleString("en-IN")}`}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all"
                  style={{
                    width: unlimitedCredits
                      ? "100%"
                      : creditsTotal > 0
                        ? `${Math.min(100, (creditsAvailable / creditsTotal) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Buy Credits & Storage ─────────────────────── */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h3 className="font-semibold">Buy as You Need</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Top up credits or storage any time — no plan change required.
          </p>
        </div>

        <div className="p-6 grid gap-4 sm:grid-cols-2">
          {/* Credits Card */}
          <div className="rounded-xl border border-border bg-background p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                <Zap className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">Credits</div>
                <div className="text-xs text-muted-foreground">
                  ₹{creditPricePerUnit} per {creditUnit.toLocaleString("en-IN")}
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Credits to purchase</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCreditQty((q) => Math.max(creditUnit, q - creditUnit))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  type="number"
                  value={creditQty}
                  min={creditUnit}
                  step={creditUnit}
                  onChange={(e) => {
                    const v = Math.max(creditUnit, Math.round(Number(e.target.value) / creditUnit) * creditUnit);
                    setCreditQty(v);
                  }}
                  className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-center font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => setCreditQty((q) => q + creditUnit)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-auto">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-foreground">{formatINR(creditCost)}</span>
              </div>
              <button
                onClick={() => startPayment("credits", { credits: creditQty })}
                disabled={busy === "credits" || !canEdit}
                className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors disabled:opacity-60"
              >
                {busy === "credits" ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" /> Pay {formatINR(creditCost)}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Storage Card */}
          <div className="rounded-xl border border-border bg-background p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <HardDrive className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">Storage</div>
                <div className="text-xs text-muted-foreground">
                  ₹{storagePerGb.toFixed(2)} per GB
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Storage to purchase</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStorageQty((q) => Math.max(STORAGE_MIN[storageUnit], q - STORAGE_STEPS[storageUnit]))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  type="number"
                  value={storageQty}
                  min={STORAGE_MIN[storageUnit]}
                  step={STORAGE_STEPS[storageUnit]}
                  onChange={(e) => {
                    const v = Math.max(STORAGE_MIN[storageUnit], Number(e.target.value));
                    setStorageQty(v);
                  }}
                  className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-center font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => setStorageQty((q) => q + STORAGE_STEPS[storageUnit])}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Unit Selector */}
              <div className="mt-2 flex gap-1">
                {(["MB", "GB", "TB"] as StorageUnit[]).map((u) => (
                  <button
                    key={u}
                    onClick={() => {
                      setStorageUnit(u);
                      setStorageQty(STORAGE_MIN[u]);
                    }}
                    className={`flex-1 rounded-md border py-1 text-xs font-medium transition-colors ${
                      storageUnit === u
                        ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>

              <p className="mt-1.5 text-xs text-muted-foreground/70">
                = {formatBytes(storageQty * STORAGE_MULTIPLIER[storageUnit])} added to your limit
              </p>
            </div>

            <div className="mt-auto">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-foreground">{formatINR(storageCost)}</span>
              </div>
              <button
                onClick={() =>
                  startPayment("storage", { bytes: storageQty * STORAGE_MULTIPLIER[storageUnit] })
                }
                disabled={busy === "storage" || !canEdit}
                className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {busy === "storage" ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" /> Pay {formatINR(storageCost)}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Payment Method & Invoices ─────────────────── */}
      {methods.length > 0 && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="border-b border-border px-6 py-4">
            <h3 className="font-semibold">Payment Methods</h3>
          </div>
          <div className="divide-y divide-border">
            {methods.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-foreground capitalize">{m.type}</span>
                {m.last4 && (
                  <span className="text-muted-foreground">•••• {m.last4}</span>
                )}
                {m.is_default && (
                  <span className="ml-auto rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                    Default
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 4: Invoice History ────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h3 className="font-semibold">Invoice History</h3>
        </div>
        {invLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : invoices.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">No invoices yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-4 px-6 py-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="text-foreground">{formatDateShort(inv.issue_date)}</div>
                  <div className="text-xs text-muted-foreground truncate">{inv.id}</div>
                </div>
                <span className="font-medium text-foreground">{formatINR(Number(inv.amount_inr))}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    inv.status === "paid"
                      ? "border-emerald-500/20 text-emerald-400"
                      : "border-amber-500/20 text-amber-400"
                  }`}
                >
                  {inv.status}
                </span>
                {inv.pdf_url && (
                  <a
                    href={inv.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
