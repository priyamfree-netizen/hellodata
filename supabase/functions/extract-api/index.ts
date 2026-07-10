/**
 * BillSOS · Public Extract API  —  POST /v1/extract
 *
 * Validates a Bearer API key, enforces rate limits and storage quota,
 * accepts multipart/form-data, creates a document + processing_job, and
 * returns the job ID.
 *
 * Idempotency: pass an `Idempotency-Key: <uuid>` header.  Duplicate requests
 * within 24 hours return the cached response instead of creating another doc.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  "image/webp",
  "image/gif",
]);
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Request-ID",
};

// ── Structured logger ─────────────────────────────────────────────────────
function log(
  level: "info" | "warn" | "error",
  requestId: string,
  message: string,
  data?: Record<string, unknown>,
) {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level, fn: "extract-api", request_id: requestId, message, ...data }),
  );
}

function json(body: unknown, status = 200, requestId = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId, ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("X-Request-ID") ?? crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "X-Request-ID": requestId } });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, requestId);
  }

  // ── 1. Authenticate via Bearer API key ────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!rawKey) {
    return json({ error: "Missing Authorization header" }, 401, requestId);
  }

  const keyHash = await sha256Hex(rawKey);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: apiKey, error: keyErr } = await supabase
    .from("api_keys")
    .select("id, organization_id, scope, expires_at")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (keyErr || !apiKey) {
    log("warn", requestId, "Invalid API key attempt");
    return json({ error: "Invalid API key" }, 401, requestId);
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date()) {
    log("warn", requestId, "Expired API key attempt", { org_id: apiKey.organization_id });
    return json({ error: "API key has expired" }, 401, requestId);
  }

  if (apiKey.scope === "read_only") {
    log("warn", requestId, "Read-only key used for write operation", { org_id: apiKey.organization_id });
    return json({ error: "This API key does not have write access" }, 403, requestId);
  }

  log("info", requestId, "API key authenticated", { org_id: apiKey.organization_id });

  // ── 2. Idempotency check ──────────────────────────────────────────────────
  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (idempotencyKey) {
    const idemHash = await sha256Hex(idempotencyKey + apiKey.id);
    const { data: cached } = await supabase
      .from("api_idempotency_keys")
      .select("response_status, response_body")
      .eq("key_hash", idemHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      log("info", requestId, "Returning cached idempotent response", { idem_hash: idemHash });
      return json(cached.response_body, cached.response_status, requestId);
    }
  }

  // ── 3. Rate limiting ──────────────────────────────────────────────────────
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("storage_limit_bytes, storage_used_bytes, subscriptions(plans(api_rate_limit))")
    .eq("id", apiKey.organization_id)
    .single();

  // deno-lint-ignore no-explicit-any
  const rateLimit = (orgRow as any)?.subscriptions?.[0]?.plans?.api_rate_limit ?? 60;

  const { data: allowed } = await supabase.rpc("check_api_rate_limit", {
    p_key_id: apiKey.id,
    p_limit: rateLimit,
  });

  if (!allowed) {
    log("warn", requestId, "Rate limit exceeded", { org_id: apiKey.organization_id });
    return json({ error: "Rate limit exceeded. Try again in a minute." }, 429, requestId);
  }

  // Update last_used_at (fire-and-forget)
  supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);

  // ── 4. Parse multipart body ───────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data body" }, 400, requestId);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json({ error: "Missing 'file' field" }, 400, requestId);
  }

  // ── 5. File validation ────────────────────────────────────────────────────
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return json(
      { error: `Unsupported file type '${file.type}'. Allowed: PDF, JPEG, PNG, TIFF, WEBP.` },
      415,
      requestId,
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return json({ error: "File too large. Maximum size is 50 MB." }, 413, requestId);
  }

  const categoryId = formData.get("category_id")?.toString() ?? null;
  const templateId = formData.get("template_id")?.toString() ?? null;

  // ── 6. Storage quota check ────────────────────────────────────────────────
  if (
    orgRow &&
    (orgRow as { storage_limit_bytes: number; storage_used_bytes: number }).storage_used_bytes +
      file.size >
      (orgRow as { storage_limit_bytes: number }).storage_limit_bytes
  ) {
    log("warn", requestId, "Storage quota exceeded", { org_id: apiKey.organization_id });
    return json(
      {
        error: "Storage quota exceeded.",
        quota_bytes: (orgRow as { storage_limit_bytes: number }).storage_limit_bytes,
        used_bytes: (orgRow as { storage_used_bytes: number }).storage_used_bytes,
      },
      413,
      requestId,
    );
  }

  // ── 7. Upload to Storage ──────────────────────────────────────────────────
  const safeName = file.name
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, 200);

  const path = `${apiKey.organization_id}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
  if (upErr) {
    log("error", requestId, "Storage upload failed", { error: upErr.message });
    return json({ error: "Storage upload failed: " + upErr.message }, 500, requestId);
  }

  // ── 8. Insert document row ────────────────────────────────────────────────
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      organization_id: apiKey.organization_id,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type,
      file_size_bytes: file.size,
      category_id: categoryId,
      template_id: templateId,
      status: "uploaded",
      source: "api",
    })
    .select()
    .single();

  if (docErr) {
    log("error", requestId, "Document insert failed", { error: docErr.message });
    await supabase.storage.from("documents").remove([path]);
    return json({ error: "Document insert failed: " + docErr.message }, 500, requestId);
  }

  // ── 9. Create processing job ──────────────────────────────────────────────
  const { data: job, error: jobErr } = await supabase
    .from("processing_jobs")
    .insert({
      organization_id: apiKey.organization_id,
      document_id: doc.id,
      name: file.name,
      stage: "queued",
      total_docs: 1,
      source: "api",
    })
    .select()
    .single();

  if (jobErr) {
    log("error", requestId, "Job creation failed", { error: jobErr.message });
    await Promise.allSettled([
      supabase.storage.from("documents").remove([path]),
      supabase.from("documents").delete().eq("id", doc.id),
    ]);
    return json({ error: "Job creation failed: " + jobErr.message }, 500, requestId);
  }

  const responseBody = { job_id: job.id, document_id: doc.id, status: "queued" };

  // ── 10. Store idempotency result ──────────────────────────────────────────
  if (idempotencyKey) {
    const idemHash = await sha256Hex(idempotencyKey + apiKey.id);
    await supabase.from("api_idempotency_keys").upsert({
      key_hash: idemHash,
      api_key_id: apiKey.id,
      response_status: 202,
      response_body: responseBody,
    }, { onConflict: "key_hash", ignoreDuplicates: true });
  }

  log("info", requestId, "Job created", { job_id: job.id, document_id: doc.id, org_id: apiKey.organization_id });
  return json(responseBody, 202, requestId);
});

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
