// =============================================================================
// Free Plan — single source of truth
// -----------------------------------------------------------------------------
// The free allotment every user receives on their first sign-up. Managed by
// superadmin from Admin → Plans → "Free Plan Limits" and persisted in
// admin_settings.free_plan. Read on the marketing pricing page, the in-app
// Billing & Plans page, and the admin editor.
//
// Keep this shape in sync with the `free_plan` JSON written by the
// 202607030003_free_plan_signup_grant.sql migration / apply_free_plan_grant().
// =============================================================================

export const FREE_PLAN_KEY = "free_plan";

export interface FreePlanConfig {
  enabled: boolean;
  name: string;
  description: string;
  /** Credits granted once, at first-org creation. */
  credits: number;
  /** Storage limit in bytes the org is provisioned with. */
  storage_bytes: number;
}

export const FREE_PLAN_DEFAULTS: FreePlanConfig = {
  enabled: true,
  name: "Free",
  description: "Everything you need to get started — no card required.",
  credits: 50,
  storage_bytes: 104_857_600, // 100 MB
};

/**
 * Coerce the raw admin_settings.free_plan JSON (which may be null, partial, or
 * carry unexpected types) into a fully-populated, safe config object.
 */
export function normalizeFreePlan(raw: unknown): FreePlanConfig {
  const v = (raw ?? {}) as Partial<Record<keyof FreePlanConfig, unknown>>;
  const num = (x: unknown, fallback: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const str = (x: unknown, fallback: string) => (typeof x === "string" && x.trim() ? x : fallback);

  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : FREE_PLAN_DEFAULTS.enabled,
    name: str(v.name, FREE_PLAN_DEFAULTS.name),
    description: str(v.description, FREE_PLAN_DEFAULTS.description),
    credits: Math.floor(num(v.credits, FREE_PLAN_DEFAULTS.credits)),
    storage_bytes: Math.floor(num(v.storage_bytes, FREE_PLAN_DEFAULTS.storage_bytes)),
  };
}

/**
 * Is this plans-table row the legacy/seed "free" plan? Used to exclude it from
 * the *paid* subscription lists so the free tier is only ever shown via the
 * config-driven card (a single source of truth, no duplicate free cards).
 */
export function isFreePlanRow(p: {
  code?: string | null;
  price_amount_inr?: number | string | null;
  is_custom_price?: boolean | null;
  plan_type?: string | null;
}): boolean {
  if (p.code === "free") return true;
  const price = Number(p.price_amount_inr ?? 0);
  return !p.is_custom_price && p.plan_type !== "pay_as_you_go" && price === 0;
}
