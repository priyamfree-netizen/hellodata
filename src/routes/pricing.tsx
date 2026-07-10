import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Check,
  Zap,
  HardDrive,
  ArrowUpRight,
  Users,
  Gauge,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { usePlans, useAdminSettings } from "@/lib/queries";
import { formatINR, formatBytes } from "@/lib/format";
import type { Plan } from "@/lib/supabase/types";
import { FREE_PLAN_KEY, normalizeFreePlan, isFreePlanRow, type FreePlanConfig } from "@/lib/free-plan";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — HelloData" },
      {
        name: "description",
        content:
          "Simple, transparent pricing. Choose a subscription plan or pay as you go — only for the credits and storage you use.",
      },
    ],
  }),
  component: PricingPage,
});

// Pay-as-you-go unit pricing lives in admin_settings.credit_pricing (superadmin).
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

type Tab = "plans" | "payg";

function PricingPage() {
  const { data: plans = [], isLoading } = usePlans();
  const { data: pricingRaw } = useAdminSettings("credit_pricing");
  const { data: freeRaw } = useAdminSettings(FREE_PLAN_KEY);
  const pricing = (pricingRaw ?? PRICING_DEFAULTS) as CreditPricing;
  const freePlan = normalizeFreePlan(freeRaw);

  const [tab, setTab] = useState<Tab>("plans");

  // The free tier is shown from admin_settings.free_plan (single source of
  // truth) — exclude the legacy seed "free" plans-table row so it isn't
  // duplicated as a paid ₹0 card.
  const subscriptionPlans = plans.filter((p) => p.plan_type !== "pay_as_you_go" && !isFreePlanRow(p));
  const paygPlans = plans.filter((p) => p.plan_type === "pay_as_you_go");

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      {/* Header */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="font-mono text-[11px] uppercase tracking-wider text-brand-lime">
            Pricing
          </div>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight md:text-6xl">
            Pay for a plan, or just for what you use.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Every plan includes AI extraction, computer-vision fallback, and export to CSV, Excel,
            ERP or webhook. Scale up or top up anytime.
          </p>

          {/* Tabs */}
          <div className="mt-10 inline-flex rounded-full border border-border bg-surface p-1">
            <TabButton active={tab === "plans"} onClick={() => setTab("plans")}>
              Subscription plans
            </TabButton>
            <TabButton active={tab === "payg"} onClick={() => setTab("payg")}>
              Pay as you go
            </TabButton>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-16">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-96 animate-pulse rounded-2xl border border-border bg-surface"
                />
              ))}
            </div>
          ) : tab === "plans" ? (
            <PlansTab plans={subscriptionPlans} freePlan={freePlan} />
          ) : (
            <PaygTab pricing={pricing} plans={paygPlans} freePlan={freePlan} />
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// =============================================================================
// Subscription plans tab
// =============================================================================

function planFeatures(p: Plan): string[] {
  const f: string[] = [];
  f.push(
    p.ai_token_limit == null
      ? "Unlimited credits"
      : `${p.ai_token_limit.toLocaleString("en-IN")} credits / ${p.interval}`,
  );
  f.push(
    p.storage_limit_bytes == null
      ? "Unlimited storage"
      : `${formatBytes(p.storage_limit_bytes)} storage`,
  );
  if (p.team_seats != null) f.push(`${p.team_seats} team seats`);
  if (p.priority_queue) f.push("Priority processing queue");
  if (p.dedicated_workers) f.push("Dedicated workers");
  if (p.sla_support) f.push("SLA-backed support");
  if (p.white_label) f.push("White-label exports");
  return f;
}

function FreePlanCard({ freePlan }: { freePlan: FreePlanConfig }) {
  const features = [
    `${freePlan.credits.toLocaleString("en-IN")} credits on sign-up`,
    `${formatBytes(freePlan.storage_bytes)} storage`,
    "No credit card required",
    "Upgrade anytime",
  ];

  return (
    <div className="relative flex flex-col rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-border/60">
      <span className="absolute -top-2.5 left-6 inline-flex items-center gap-1 rounded-full border border-brand-lime/30 bg-brand-lime/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand-lime">
        <Sparkles className="h-2.5 w-2.5" /> Free forever
      </span>

      <div className="text-sm font-medium text-foreground">{freePlan.name}</div>
      {freePlan.description && (
        <p className="mt-1 text-xs text-muted-foreground">{freePlan.description}</p>
      )}

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight">{formatINR(0)}</span>
        <span className="text-sm text-muted-foreground">/ forever</span>
      </div>

      <ul className="mt-6 space-y-2.5">
        {features.map((feat) => (
          <li key={feat} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-lime" />
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      <Link
        to="/signup"
        className="group mt-8 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-foreground px-5 text-sm font-medium text-background transition-colors hover:opacity-90"
      >
        Start free
        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function PlansTab({ plans, freePlan }: { plans: Plan[]; freePlan: FreePlanConfig }) {
  if (plans.length === 0 && !freePlan.enabled) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        No subscription plans are available right now. Please check back soon.
      </div>
    );
  }

  // Highlight the middle plan when there are 3, otherwise none.
  const highlightIdx = plans.length === 3 ? 1 : -1;

  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {freePlan.enabled && <FreePlanCard freePlan={freePlan} />}
      {plans.map((p, i) => {
        const highlighted = i === highlightIdx;
        return (
          <div
            key={p.id}
            className={`relative flex flex-col rounded-2xl border p-6 transition-colors ${
              highlighted
                ? "border-brand-lime/50 bg-surface shadow-[0_0_0_1px_rgba(132,204,22,0.25)]"
                : "border-border bg-surface hover:border-border/60"
            }`}
          >
            {highlighted && (
              <span className="absolute -top-2.5 left-6 inline-flex items-center gap-1 rounded-full border border-brand-lime/30 bg-brand-lime/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand-lime">
                <Sparkles className="h-2.5 w-2.5" /> Most popular
              </span>
            )}

            <div className="text-sm font-medium text-foreground">{p.name}</div>
            {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}

            <div className="mt-4 flex items-baseline gap-1">
              {p.is_custom_price ? (
                <span className="text-4xl font-semibold tracking-tight">Custom</span>
              ) : (
                <>
                  <span className="text-4xl font-semibold tracking-tight">
                    {p.price_amount_inr != null ? formatINR(Number(p.price_amount_inr)) : "Free"}
                  </span>
                  <span className="text-sm text-muted-foreground">/{p.interval}</span>
                </>
              )}
            </div>

            <ul className="mt-6 space-y-2.5">
              {planFeatures(p).map((feat) => (
                <li key={feat} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-lime" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>

            <Link
              to={p.is_custom_price ? "/contact" : "/signup"}
              className={`group mt-8 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-medium transition-colors ${
                highlighted
                  ? "bg-brand-lime text-background hover:opacity-90"
                  : "bg-foreground text-background hover:opacity-90"
              }`}
            >
              {p.is_custom_price ? "Talk to sales" : "Start free"}
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Pay-as-you-go tab
// =============================================================================

function PaygTab({
  pricing,
  plans,
  freePlan,
}: {
  pricing: CreditPricing;
  plans: Plan[];
  freePlan: FreePlanConfig;
}) {
  const creditPer1000 = ((pricing.credit_price_inr / (pricing.credit_unit || 1)) * 1000).toFixed(2);
  const storagePerGb = (pricing.storage_price_inr / (pricing.storage_unit_gb || 1)).toFixed(2);

  return (
    <div className="space-y-10">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm text-muted-foreground">
          No commitment. No monthly fee. Add credits or storage whenever you need them and pay only
          for what you consume — the same rates you'll see inside your workspace.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Credits */}
        <div className="flex flex-col rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
              <Zap className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-medium">Credits</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                one credit = one extracted page
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-baseline gap-1">
            <span className="text-4xl font-semibold tracking-tight">
              {formatINR(pricing.credit_price_inr)}
            </span>
            <span className="text-sm text-muted-foreground">
              / {pricing.credit_unit.toLocaleString("en-IN")} credits
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">
            = {formatINR(Number(creditPer1000))} per 1,000 credits
          </p>

          <ul className="mt-6 space-y-2.5">
            {["Credits never expire", "Buy in any quantity", "Works alongside any plan"].map(
              (feat) => (
                <li key={feat} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>{feat}</span>
                </li>
              ),
            )}
          </ul>
        </div>

        {/* Storage */}
        <div className="flex flex-col rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-brand-blue/30 bg-brand-blue/10">
              <HardDrive className="h-5 w-5 text-brand-blue" />
            </div>
            <div>
              <div className="text-sm font-medium">Storage</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                keep your documents and exports
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-baseline gap-1">
            <span className="text-4xl font-semibold tracking-tight">
              {formatINR(pricing.storage_price_inr)}
            </span>
            <span className="text-sm text-muted-foreground">/ {pricing.storage_unit_gb} GB</span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">
            = {formatINR(Number(storagePerGb))} per GB
          </p>

          <ul className="mt-6 space-y-2.5">
            {[
              "Add storage in MB, GB or TB",
              "Only pay for what you add",
              "Instantly available",
            ].map((feat) => (
              <li key={feat} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" />
                <span>{feat}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Any pay-as-you-go plans defined by superadmin */}
      {plans.length > 0 && (
        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-surface p-6">
              <div className="text-sm font-medium">{p.name}</div>
              {p.description && (
                <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
              )}
              <div className="mt-4 text-2xl font-semibold tracking-tight">Pay as you go</div>
              <ul className="mt-4 space-y-2.5">
                {planFeatures(p).map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-lime" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Trust row */}
      <div className="grid gap-4 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-3">
        {[
          { icon: ShieldCheck, label: "Your data is never used for training" },
          { icon: Gauge, label: "Per-page billing, no hidden fees" },
          { icon: Users, label: "Invite your whole team" },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-3">
            <Icon className="h-5 w-5 shrink-0 text-brand-lime" />
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 text-center">
        <Link
          to="/signup"
          className="group inline-flex h-12 items-center gap-2 rounded-xl bg-foreground px-6 text-sm font-medium text-background hover:opacity-90"
        >
          {freePlan.enabled
            ? `Start free — ${freePlan.credits.toLocaleString("en-IN")} credits on your first sign-up`
            : "Get started"}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
        <Link to="/contact" className="text-xs text-muted-foreground hover:text-foreground">
          Need volume pricing? Talk to sales →
        </Link>
      </div>
    </div>
  );
}
