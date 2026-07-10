import { db, envVar, verifyJwt, authClient, type Env } from "./auth/_utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getBearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

async function getUserId(req: Request, env: Env): Promise<string | null> {
  const token = getBearer(req);
  if (!token) return null;
  const secret = envVar(env, "SUPABASE_JWT_SECRET");
  if (secret) {
    const payload = await verifyJwt(token, secret);
    if (payload?.sub) return payload.sub;
  }
  const { data } = await authClient(env).auth.getUser(token);
  return data.user?.id ?? null;
}

async function requireAuth(req: Request, env: Env): Promise<{ userId: string } | Response> {
  const userId = await getUserId(req, env);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  return { userId };
}

// ── Razorpay config ───────────────────────────────────────────────────────────

type RazorpayConfig = {
  key_id: string;
  key_secret: string;
  webhook_secret: string;
  test_mode: boolean;
  currency: string;
};

async function getConfig(env: Env): Promise<RazorpayConfig | null> {
  const { data } = await db(env)
    .from("admin_settings")
    .select("value")
    .eq("key", "razorpay_config")
    .maybeSingle();
  if (!data?.value) return null;
  const cfg = data.value as RazorpayConfig;
  if (!cfg.key_id || !cfg.key_secret) return null;
  return cfg;
}

// ── Razorpay API calls ────────────────────────────────────────────────────────

async function razorpayPost<T>(
  path: string,
  config: RazorpayConfig,
  body: Record<string, unknown>,
): Promise<T> {
  const auth = btoa(`${config.key_id}:${config.key_secret}`);
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: { description?: string } };
    throw new Error(err.error?.description ?? `Razorpay API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type RzpOrder = { id: string; amount: number; currency: string; receipt: string };

async function verifySignature(
  secret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const message = `${orderId}|${paymentId}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const expected = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === signature;
}

async function verifyWebhookSignature(secret: string, body: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === signature;
}

// ── Org lookup ────────────────────────────────────────────────────────────────

async function getPrimaryOrgId(env: Env, userId: string): Promise<string | null> {
  const { data } = await db(env)
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.organization_id ?? null;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// GET /api/payment/config — public key_id only (never expose key_secret)
async function handleGetConfig(req: Request, env: Env): Promise<Response> {
  void req;
  const cfg = await getConfig(env);
  if (!cfg) return json({ key_id: "", test_mode: true, currency: "INR", configured: false });
  return json({ key_id: cfg.key_id, test_mode: cfg.test_mode, currency: cfg.currency, configured: true });
}

// POST /api/payment/create-order
async function handleCreateOrder(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  if (auth instanceof Response) return auth;

  const body = (await req.json()) as {
    type: "subscription" | "credits" | "storage";
    plan_id?: string;
    credits?: number;
    bytes?: number;
    org_id?: string;
  };

  const orgId = body.org_id ?? (await getPrimaryOrgId(env, auth.userId));
  if (!orgId) return json({ error: "No organization found" }, 400);

  const cfg = await getConfig(env);
  if (!cfg) return json({ error: "Payment gateway not configured" }, 503);

  let amountPaise = 0;
  let description = "";
  let creditsAmount: number | null = null;
  let storageBytes: number | null = null;
  let planId: string | null = null;

  if (body.type === "credits") {
    if (!body.credits || body.credits <= 0) return json({ error: "credits must be positive" }, 400);
    const { data: settings } = await db(env)
      .from("admin_settings")
      .select("value")
      .eq("key", "credit_pricing")
      .maybeSingle();
    const pricing = (settings?.value as { credit_price_inr?: number; credit_unit?: number }) ?? {};
    const pricePerUnit = Number(pricing.credit_price_inr ?? 10);
    const unit = Number(pricing.credit_unit ?? 1000);
    const priceInr = Math.ceil((body.credits / unit) * pricePerUnit);
    amountPaise = priceInr * 100;
    creditsAmount = body.credits;
    description = `${body.credits.toLocaleString("en-IN")} credits`;
  } else if (body.type === "storage") {
    if (!body.bytes || body.bytes <= 0) return json({ error: "bytes must be positive" }, 400);
    const { data: settings } = await db(env)
      .from("admin_settings")
      .select("value")
      .eq("key", "credit_pricing")
      .maybeSingle();
    const pricing = (settings?.value as { storage_price_inr?: number }) ?? {};
    const pricePerGb = Number(pricing.storage_price_inr ?? 50);
    const gb = body.bytes / (1024 * 1024 * 1024);
    const priceInr = Math.ceil(gb * pricePerGb);
    amountPaise = priceInr * 100;
    storageBytes = body.bytes;
    description = `${gb.toFixed(2)} GB storage`;
  } else if (body.type === "subscription") {
    if (!body.plan_id) return json({ error: "plan_id required for subscription" }, 400);
    const { data: plan } = await db(env)
      .from("plans")
      .select("name, price_amount_inr")
      .eq("id", body.plan_id)
      .maybeSingle();
    if (!plan) return json({ error: "Plan not found" }, 404);
    amountPaise = Math.round(Number(plan.price_amount_inr ?? 0) * 100);
    planId = body.plan_id;
    description = `${plan.name} subscription`;
  } else {
    return json({ error: "Invalid order type" }, 400);
  }

  if (amountPaise <= 0) return json({ error: "Amount must be greater than zero" }, 400);

  const receipt = `billsos_${Date.now()}`;
  let rzpOrder: RzpOrder;
  try {
    rzpOrder = await razorpayPost<RzpOrder>("/orders", cfg, {
      amount: amountPaise,
      currency: cfg.currency || "INR",
      receipt,
      notes: { org_id: orgId, type: body.type },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Order creation failed";
    return json({ error: msg }, 502);
  }

  const { data: order, error: dbErr } = await db(env)
    .from("razorpay_orders")
    .insert({
      organization_id: orgId,
      razorpay_order_id: rzpOrder.id,
      order_type: body.type,
      plan_id: planId,
      credits_amount: creditsAmount,
      storage_bytes: storageBytes,
      amount_paise: amountPaise,
      currency: cfg.currency || "INR",
      status: "created",
      applied: false,
    })
    .select("id")
    .single();

  if (dbErr) return json({ error: dbErr.message }, 500);

  return json({
    order_id: order.id,
    rzp_order_id: rzpOrder.id,
    amount: amountPaise,
    currency: cfg.currency || "INR",
    key_id: cfg.key_id,
    description,
  });
}

// POST /api/payment/verify
async function handleVerifyPayment(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  if (auth instanceof Response) return auth;

  const body = (await req.json()) as {
    order_id: string;           // our DB UUID
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  };

  const cfg = await getConfig(env);
  if (!cfg) return json({ error: "Payment gateway not configured" }, 503);

  const valid = await verifySignature(
    cfg.key_secret,
    body.razorpay_order_id,
    body.razorpay_payment_id,
    body.razorpay_signature,
  );
  if (!valid) return json({ error: "Invalid payment signature" }, 400);

  // Verify the order belongs to the authenticated user's org
  const orgId = await getPrimaryOrgId(env, auth.userId);
  if (!orgId) return json({ error: "No organization found" }, 400);

  const { data: orderRow } = await db(env)
    .from("razorpay_orders")
    .select("id, organization_id, order_type, plan_id, applied")
    .eq("id", body.order_id)
    .maybeSingle();

  if (!orderRow) return json({ error: "Order not found" }, 404);
  if (orderRow.organization_id !== orgId) return json({ error: "Forbidden" }, 403);
  if (orderRow.applied) return json({ ok: true, already_applied: true });

  // Apply via security-definer RPC (handles idempotency + credit_grants audit)
  const { error: rpcErr } = await db(env).rpc("apply_razorpay_order", {
    p_order_id: body.order_id,
    p_payment_id: body.razorpay_payment_id,
  });
  if (rpcErr) return json({ error: rpcErr.message }, 500);

  // For subscription orders, create/update subscription record
  if (orderRow.order_type === "subscription" && orderRow.plan_id) {
    const { data: existing } = await db(env)
      .from("subscriptions")
      .select("id")
      .eq("organization_id", orgId)
      .maybeSingle();

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    if (existing) {
      await db(env)
        .from("subscriptions")
        .update({
          plan_id: orderRow.plan_id,
          status: "active",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          external_ref: body.razorpay_payment_id,
          updated_at: now.toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await db(env).from("subscriptions").insert({
        organization_id: orgId,
        plan_id: orderRow.plan_id,
        status: "active",
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        external_ref: body.razorpay_payment_id,
      });
    }
  }

  return json({ ok: true });
}

// POST /api/payment/webhook — Razorpay async notification
async function handleWebhook(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("X-Razorpay-Signature") ?? "";

  const cfg = await getConfig(env);
  if (!cfg?.webhook_secret) return json({ ok: true }); // not configured, ignore

  const valid = await verifyWebhookSignature(cfg.webhook_secret, rawBody, signature);
  if (!valid) return json({ error: "Invalid webhook signature" }, 400);

  let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (event.event === "payment.captured") {
    const paymentId = event.payload?.payment?.entity?.id;
    const rzpOrderId = event.payload?.payment?.entity?.order_id;
    if (paymentId && rzpOrderId) {
      const { data: order } = await db(env)
        .from("razorpay_orders")
        .select("id, applied")
        .eq("razorpay_order_id", rzpOrderId)
        .maybeSingle();

      if (order && !order.applied) {
        await db(env).rpc("apply_razorpay_order", {
          p_order_id: order.id,
          p_payment_id: paymentId,
        });
      }
    }
  }

  return json({ ok: true });
}

// ── GET /api/admin/razorpay-config — superadmin full config read ─────────────
// Exposed via admin.ts router (imported there). Kept here for co-location.
export async function handleAdminRazorpayConfig(req: Request, env: Env): Promise<Response> {
  void req;
  const { data } = await db(env)
    .from("admin_settings")
    .select("value")
    .eq("key", "razorpay_config")
    .maybeSingle();

  const cfg = (data?.value ?? {}) as Partial<RazorpayConfig>;

  // Mask secrets — show only first 4 + last 4 chars
  function mask(s: string | undefined): string {
    if (!s || s.length < 8) return s ? "****" : "";
    return `${s.slice(0, 4)}${"*".repeat(Math.max(0, s.length - 8))}${s.slice(-4)}`;
  }

  return json({
    key_id: cfg.key_id ?? "",
    key_secret_masked: mask(cfg.key_secret),
    webhook_secret_masked: mask(cfg.webhook_secret),
    test_mode: cfg.test_mode ?? true,
    currency: cfg.currency ?? "INR",
    configured: Boolean(cfg.key_id && cfg.key_secret),
  });
}

// ── Main router ───────────────────────────────────────────────────────────────

export async function handlePaymentApi(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/payment")) return null;

  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    if (req.method === "GET" && url.pathname === "/api/payment/config") {
      return await handleGetConfig(req, env);
    }
    if (req.method === "POST" && url.pathname === "/api/payment/create-order") {
      return await handleCreateOrder(req, env);
    }
    if (req.method === "POST" && url.pathname === "/api/payment/verify") {
      return await handleVerifyPayment(req, env);
    }
    if (req.method === "POST" && url.pathname === "/api/payment/webhook") {
      return await handleWebhook(req, env);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("[payment api]", err);
    return json({ error: "Payment service error" }, 500);
  }
}
