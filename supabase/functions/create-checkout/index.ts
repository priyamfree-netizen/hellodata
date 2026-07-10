/**
 * BillSOS · Stripe Checkout / Customer Portal
 *
 * POST body:
 *   { action: "checkout", plan_id: "<uuid>", return_url: "https://..." }
 *   { action: "portal",   return_url: "https://..." }
 *
 * action=checkout  → creates a Stripe Checkout Session for a new subscription
 * action=portal    → creates a Stripe Customer Portal Session to manage billing
 *
 * Secrets required:
 *   STRIPE_SECRET_KEY   – sk_live_… or sk_test_…
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, fn: "create-checkout", message: msg, ...data }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "Stripe not configured" }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify JWT and get user
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Invalid session" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Get user's current org via profile
  const { data: profile } = await admin
    .from("profiles")
    .select("current_org_id")
    .eq("id", user.id)
    .single();
  const orgId = profile?.current_org_id;
  if (!orgId) return json({ error: "No active organization" }, 400);

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, stripe_customer_id")
    .eq("id", orgId)
    .single();
  if (!org) return json({ error: "Organization not found" }, 404);

  let body: { action: string; plan_id?: string; return_url?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const returnUrl = body.return_url ?? `${Deno.env.get("APP_URL") ?? "https://app.billsos.com"}/settings/billing`;

  // ── Ensure Stripe customer exists ─────────────────────────────────────────
  let customerId: string = org.stripe_customer_id ?? "";

  if (!customerId) {
    const createRes = await stripePost(stripeKey, "/v1/customers", {
      name: org.name,
      metadata: { organization_id: orgId },
    });
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      log("error", "Failed to create Stripe customer", { error: (err as { error?: { message?: string } }).error?.message });
      return json({ error: "Failed to create billing account" }, 500);
    }
    const customer = await createRes.json();
    customerId = customer.id;
    await admin.from("organizations").update({ stripe_customer_id: customerId }).eq("id", orgId);
  }

  // ── action: portal ─────────────────────────────────────────────────────────
  if (body.action === "portal") {
    const portalRes = await stripePost(stripeKey, "/v1/billing_portal/sessions", {
      customer: customerId,
      return_url: returnUrl,
    });
    if (!portalRes.ok) {
      const err = await portalRes.json().catch(() => ({}));
      log("error", "Failed to create portal session", { error: (err as { error?: { message?: string } }).error?.message });
      return json({ error: "Failed to open billing portal" }, 500);
    }
    const portal = await portalRes.json();
    log("info", "Portal session created", { org_id: orgId });
    return json({ url: portal.url });
  }

  // ── action: checkout ───────────────────────────────────────────────────────
  if (body.action === "checkout") {
    if (!body.plan_id) return json({ error: "plan_id required" }, 400);

    const { data: plan } = await admin
      .from("plans")
      .select("id, name, stripe_price_id")
      .eq("id", body.plan_id)
      .single();

    if (!plan?.stripe_price_id) {
      return json({ error: "Plan has no Stripe price configured — contact support." }, 400);
    }

    const checkoutRes = await stripePost(stripeKey, "/v1/checkout/sessions", {
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: returnUrl + "?checkout=success",
      cancel_url: returnUrl + "?checkout=cancelled",
      metadata: { organization_id: orgId },
    });

    if (!checkoutRes.ok) {
      const err = await checkoutRes.json().catch(() => ({}));
      log("error", "Failed to create checkout session", { error: (err as { error?: { message?: string } }).error?.message });
      return json({ error: "Failed to create checkout session" }, 500);
    }
    const checkout = await checkoutRes.json();
    log("info", "Checkout session created", { org_id: orgId, plan_id: body.plan_id });
    return json({ url: checkout.url });
  }

  return json({ error: `Unknown action '${body.action}'` }, 400);
});

async function stripePost(key: string, path: string, params: Record<string, unknown>) {
  const body = new URLSearchParams();
  flattenForStripe(params, "", body);
  return fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
}

function flattenForStripe(obj: Record<string, unknown>, prefix: string, params: URLSearchParams) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      flattenForStripe(v as Record<string, unknown>, key, params);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          flattenForStripe(item as Record<string, unknown>, `${key}[${i}]`, params);
        } else {
          params.append(`${key}[${i}]`, String(item));
        }
      });
    } else {
      params.append(key, String(v));
    }
  }
}
