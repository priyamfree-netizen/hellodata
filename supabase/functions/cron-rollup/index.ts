/**
 * BillSOS · Daily Rollup Cron
 *
 * Writes yesterday's usage_records and metric_snapshots rows.
 * Schedule: daily at 00:05 UTC via Supabase Scheduled Tasks or pg_cron.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

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
    JSON.stringify({ ts: new Date().toISOString(), level, fn: "cron-rollup", request_id: requestId, message, ...data }),
  );
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

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];
  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd   = `${dateStr}T23:59:59.999Z`;

  log("info", requestId, "Starting rollup", { date: dateStr });

  // ── 1. usage_records per org ───────────────────────────────────────────────
  const { data: orgs } = await supabase.from("organizations").select("id");
  const usageRows = [];

  for (const org of orgs ?? []) {
    const [{ count: docs }, { data: pagesData }] = await Promise.all([
      supabase
        .from("documents")
        .select("id", { head: true, count: "exact" })
        .eq("organization_id", org.id)
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd),
      supabase
        .from("processing_jobs")
        .select("total_pages")
        .eq("organization_id", org.id)
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd),
    ]);
    const pages = pagesData?.reduce((sum, r) => sum + (r.total_pages ?? 0), 0) ?? 0;

    if ((docs ?? 0) > 0) {
      usageRows.push({
        organization_id: org.id,
        date: dateStr,
        documents_uploaded: docs ?? 0,
        pages_processed: pages,
      });
    }
  }

  if (usageRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("usage_records")
      .upsert(usageRows, { onConflict: "organization_id,date" });
    if (upsertErr) {
      log("error", requestId, "usage_records upsert failed", { error: upsertErr.message });
    }
  }

  // ── 2. metric_snapshots (system-wide, idempotent) ──────────────────────────
  const { count: totalJobs } = await supabase
    .from("processing_jobs")
    .select("id", { head: true, count: "exact" })
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd);

  const { count: failedJobs } = await supabase
    .from("processing_jobs")
    .select("id", { head: true, count: "exact" })
    .eq("stage", "failed")
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd);

  const metrics = [
    { metric: "jobs_total",  value: totalJobs  ?? 0, taken_at: dayEnd },
    { metric: "jobs_failed", value: failedJobs ?? 0, taken_at: dayEnd },
    { metric: "orgs_active", value: orgs?.length ?? 0, taken_at: dayEnd },
  ];

  // Delete + re-insert to stay idempotent across multiple runs for the same day.
  // The unique index metric_snapshots_metric_day_uniq enforces one row per metric per day.
  for (const row of metrics) {
    await supabase
      .from("metric_snapshots")
      .delete()
      .eq("metric", row.metric)
      .gte("taken_at", dayStart)
      .lte("taken_at", dayEnd);
  }

  const { error: snapErr } = await supabase.from("metric_snapshots").insert(metrics);
  if (snapErr) {
    log("error", requestId, "metric_snapshots insert failed", { error: snapErr.message });
  }

  // ── 3. Cleanup: expired idempotency keys ──────────────────────────────────
  const { error: idemErr } = await supabase
    .from("api_idempotency_keys")
    .delete()
    .lt("expires_at", new Date().toISOString());
  if (idemErr) {
    log("warn", requestId, "api_idempotency_keys cleanup failed", { error: idemErr.message });
  }

  // ── 4. Cleanup: stale rate limit counter windows ──────────────────────────
  const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { error: rateErr } = await supabase
    .from("api_rate_counters")
    .delete()
    .lt("window_start", twoMinsAgo);
  if (rateErr) {
    log("warn", requestId, "api_rate_counters cleanup failed", { error: rateErr.message });
  }

  log("info", requestId, "Rollup complete", { date: dateStr, usage_rows: usageRows.length });

  return new Response(
    JSON.stringify({ date: dateStr, usage_rows: usageRows.length }),
    { status: 200, headers: { "Content-Type": "application/json", "X-Request-ID": requestId } },
  );
});
