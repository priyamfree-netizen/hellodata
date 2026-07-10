/**
 * BillSOS · Webhook Dispatcher
 *
 * Sends pending webhook deliveries for completed extractions.
 * Run on a schedule (every 60 s) via pg_cron / Supabase Scheduled Tasks.
 *
 * Retry schedule (exponential backoff, max 5 attempts):
 *   attempt 1 → retry in 1 min
 *   attempt 2 → retry in 5 min
 *   attempt 3 → retry in 30 min
 *   attempt 4 → retry in 2 hours
 *   attempt 5 → permanent failure
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH_SIZE = 20;
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000]; // 1m, 5m, 30m, 2h

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-Request-ID",
};

function log(
  level: "info" | "warn" | "error",
  requestId: string,
  message: string,
  data?: Record<string, unknown>,
) {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level, fn: "webhook-dispatch", request_id: requestId, message, ...data }),
  );
}

// SSRF: block fetches targeting private / link-local networks.
const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /\.internal$/i,
  /\.local$/i,
];

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(hostname));
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("X-Request-ID") ?? crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "X-Request-ID": requestId } });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    log("warn", requestId, "Unauthorized invocation attempt");
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
    { auth: { persistSession: false } },
  );

  const now = new Date().toISOString();

  const { data: deliveries, error } = await supabase
    .from("webhook_deliveries")
    .select("*, webhook:webhooks(*)")
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .lt("attempts", MAX_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    log("error", requestId, "Failed to fetch pending deliveries", { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!deliveries || deliveries.length === 0) {
    log("info", requestId, "No pending deliveries");
    return new Response(JSON.stringify({ dispatched: 0 }), { status: 200 });
  }

  log("info", requestId, "Dispatching deliveries", { count: deliveries.length });

  const results = await Promise.allSettled(
    // deno-lint-ignore no-explicit-any
    deliveries.map((d: any) => dispatch(supabase, d, requestId)),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  log("info", requestId, "Dispatch complete", { succeeded, failed });

  return new Response(
    JSON.stringify({ dispatched: deliveries.length, succeeded, failed }),
    { status: 200, headers: { "Content-Type": "application/json", "X-Request-ID": requestId } },
  );
});

async function dispatch(
  supabase: ReturnType<typeof createClient>,
  // deno-lint-ignore no-explicit-any
  delivery: any,
  requestId: string,
) {
  const webhook = delivery.webhook;
  if (!webhook?.endpoint_url) throw new Error("No endpoint URL");

  let parsed: URL;
  try {
    parsed = new URL(webhook.endpoint_url as string);
  } catch {
    throw new Error(`Invalid endpoint URL: ${webhook.endpoint_url}`);
  }

  if (isBlockedHost(parsed.hostname)) {
    // SSRF — no point retrying, mark permanently failed
    await supabase
      .from("webhook_deliveries")
      .update({
        status: "failed",
        attempts: (delivery.attempts ?? 0) + 1,
        response_status: null,
        next_attempt_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);
    log("warn", requestId, "SSRF blocked — delivery permanently failed", {
      delivery_id: delivery.id,
      host: parsed.hostname,
    });
    throw new Error(`SSRF: blocked request to internal host '${parsed.hostname}'`);
  }

  const payload = delivery.payload ?? {};
  const signature = await hmacSha256Hex(webhook.secret_key ?? "", JSON.stringify(payload));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let responseStatus = 0;
  let responseBody = "";

  try {
    const res = await fetch(webhook.endpoint_url as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BillSOS-Signature": `sha256=${signature}`,
        "X-BillSOS-Delivery": delivery.id as string,
        "X-Request-ID": requestId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    responseStatus = res.status;
    responseBody = await res.text().catch(() => "");
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  const succeeded = responseStatus >= 200 && responseStatus < 300;
  const newAttempts = (delivery.attempts ?? 0) + 1;
  const isPermanentFail = newAttempts >= MAX_ATTEMPTS;

  const nextAttemptAt = (!succeeded && !isPermanentFail)
    ? new Date(Date.now() + RETRY_DELAYS_MS[newAttempts - 1]).toISOString()
    : new Date().toISOString();

  await supabase
    .from("webhook_deliveries")
    .update({
      status: succeeded ? "delivered" : (isPermanentFail ? "failed" : "pending"),
      response_status: responseStatus || null,
      response_body: responseBody.slice(0, 2000),
      delivered_at: succeeded ? new Date().toISOString() : null,
      attempts: newAttempts,
      next_attempt_at: nextAttemptAt,
    })
    .eq("id", delivery.id);

  log(succeeded ? "info" : "warn", requestId, `Delivery ${succeeded ? "succeeded" : (isPermanentFail ? "permanently failed" : "will retry")}`, {
    delivery_id: delivery.id,
    response_status: responseStatus,
    attempts: newAttempts,
    next_attempt_at: nextAttemptAt,
  });

  if (!succeeded) throw new Error(`Delivery ${delivery.id} failed (attempt ${newAttempts}/${MAX_ATTEMPTS})`);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
