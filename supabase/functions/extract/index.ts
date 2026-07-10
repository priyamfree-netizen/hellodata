/**
 * BillSOS · Extraction Worker
 *
 * Called on a schedule to process queued jobs:
 *   1. Claim N jobs atomically via claim_processing_jobs() (SKIP LOCKED)
 *   2. Download the file from Storage
 *   3. Call the vendor extraction API
 *   4. Write extractions + extraction_fields
 *   5. Flip stage → 'completed' (or 'failed' on error)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendEmail, extractionCompleteHtml, extractionFailedHtml } from "../_shared/email.ts";

const BATCH_SIZE = 5;
const WORKER_ID = crypto.randomUUID();

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
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      fn: "extract",
      request_id: requestId,
      message,
      ...data,
    }),
  );
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("X-Request-ID") ?? crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "X-Request-ID": requestId },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    log("warn", requestId, "Unauthorized invocation attempt");
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });

  // ── Claim jobs atomically (FOR UPDATE SKIP LOCKED) ────────────────────────
  const { data: jobs, error: claimErr } = await supabase.rpc("claim_processing_jobs", {
    p_worker_id: WORKER_ID,
    p_batch: BATCH_SIZE,
  });

  if (claimErr) {
    log("error", requestId, "Job claim failed", { error: claimErr.message });
    return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    log("info", requestId, "No queued jobs");
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  log("info", requestId, "Claimed jobs", { count: jobs.length, worker_id: WORKER_ID });

  const jobIds = (jobs as { id: string }[]).map((j) => j.id);
  const { data: jobsWithDocs } = await supabase
    .from("processing_jobs")
    .select("*, document:documents(*)")
    .in("id", jobIds);

  const results = await Promise.allSettled(
    (jobsWithDocs ?? []).map((job) => processJob(supabase, job, requestId)),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  log("info", requestId, "Batch complete", { processed: jobs.length, succeeded, failed });

  return new Response(JSON.stringify({ processed: jobs.length, succeeded, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
  });
});

async function processJob(
  supabase: ReturnType<typeof createClient>,
  // deno-lint-ignore no-explicit-any
  job: any,
  requestId: string,
) {
  try {
    const document = job.document;
    if (!document) throw new Error("Document not found for job " + job.id);

    log("info", requestId, "Processing job", { job_id: job.id, document_id: document.id });

    const { data: fileData, error: dlErr } = await supabase.storage
      .from("documents")
      .download(document.storage_path);
    if (dlErr) throw dlErr;

    const extractionResult = await callVendorApi(fileData, document);

    const { data: extraction, error: exErr } = await supabase
      .from("extractions")
      .insert({
        job_id: job.id,
        document_id: document.id,
        organization_id: job.organization_id,
        status: "done",
        confidence: extractionResult.confidence,
        page_count: extractionResult.pages,
        tokens_used: extractionResult.tokens,
      })
      .select()
      .single();
    if (exErr) throw exErr;

    if (extractionResult.fields?.length) {
      const { error: fieldsErr } = await supabase.from("extraction_fields").insert(
        extractionResult.fields.map((f: { key: string; value: string; confidence: number }) => ({
          extraction_id: extraction.id,
          field_key: f.key,
          value_text: f.value,
          confidence: f.confidence > 1 ? f.confidence / 100 : f.confidence,
        })),
      );
      if (fieldsErr) {
        log("warn", requestId, "extraction_fields insert failed after result was saved", {
          job_id: job.id,
          error: fieldsErr.message,
        });
      }
    }

    await supabase
      .from("processing_jobs")
      .update({ stage: "completed", completed_at: new Date().toISOString(), completed_docs: 1 })
      .eq("id", job.id);

    await supabase.from("documents").update({ status: "extracted" }).eq("id", document.id);

    log("info", requestId, "Job completed", { job_id: job.id, extraction_id: extraction.id });

    // Fire-and-forget email — failure here must not fail the job
    notifyComplete(
      supabase,
      job.organization_id,
      document.file_name,
      extractionResult.fields.length,
    ).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", requestId, "Job failed", { job_id: job.id, error: msg });
    await supabase
      .from("processing_jobs")
      .update({ stage: "failed", error_message: msg, failed_docs: 1 })
      .eq("id", job.id);

    notifyFailed(supabase, job.organization_id, document?.file_name ?? "Unknown file", msg).catch(
      () => {},
    );
    throw err;
  }
}

async function notifyComplete(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  docName: string,
  fieldCount: number,
) {
  const email = await getOrgOwnerEmail(supabase, orgId);
  if (!email) return;
  const appUrl = Deno.env.get("APP_URL") ?? "https://app.billsos.com";
  await sendEmail({
    to: email,
    subject: `Extraction complete — ${docName}`,
    html: extractionCompleteHtml(docName, fieldCount, appUrl),
  });
}

async function notifyFailed(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  docName: string,
  reason: string,
) {
  const email = await getOrgOwnerEmail(supabase, orgId);
  if (!email) return;
  await sendEmail({
    to: email,
    subject: `Extraction failed — ${docName}`,
    html: extractionFailedHtml(docName, reason),
  });
}

async function getOrgOwnerEmail(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("organization_members")
    .select("profile:profiles(email)")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  return (data as any)?.profile?.email ?? null;
}

/**
 * Calls Mindee Invoice API v4 for structured extraction.
 * Requires MINDEE_API_KEY Supabase secret.
 * Docs: https://developers.mindee.com/docs/invoice-ocr
 */
// deno-lint-ignore no-explicit-any
async function callVendorApi(file: Blob, document: any) {
  const apiKey = Deno.env.get("MINDEE_API_KEY");
  if (!apiKey) throw new Error("MINDEE_API_KEY not configured");

  const form = new FormData();
  form.append("document", file, document.file_name ?? "document.pdf");

  const res = await fetch("https://api.mindee.net/v1/products/mindee/invoices/v4/predict", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Mindee API ${res.status}: ${txt.slice(0, 300)}`);
  }

  // deno-lint-ignore no-explicit-any
  const json: any = await res.json();
  const pred = json?.document?.inference?.prediction ?? {};
  const pages: number = json?.document?.n_pages ?? 1;

  type Field = { key: string; value: string; confidence: number };
  const fields: Field[] = [];

  // deno-lint-ignore no-explicit-any
  const push = (key: string, val: any) => {
    if (val?.value != null) {
      fields.push({ key, value: String(val.value), confidence: val.confidence ?? 0 });
    }
  };

  push("supplier_name", pred.supplier_name);
  push("invoice_number", pred.invoice_number);
  push("invoice_date", pred.invoice_date);
  push("due_date", pred.due_date);
  push("total_amount", pred.total_amount);
  push("total_tax", pred.total_tax);
  push("total_net", pred.total_net);
  push("document_type", pred.document_type);
  push(
    "currency",
    pred.locale?.currency
      ? { value: pred.locale.currency, confidence: pred.locale.confidence }
      : undefined,
  );
  push("customer_name", pred.customer_name);
  push("customer_address", pred.customer_address);
  push("supplier_address", pred.supplier_address);

  for (const item of pred.line_items ?? []) {
    if (item.description?.value) {
      fields.push({
        key: "line_item",
        value: JSON.stringify({
          description: item.description?.value,
          quantity: item.quantity?.value,
          unit_price: item.unit_price?.value,
          total: item.total_amount?.value,
        }),
        confidence: item.confidence ?? 0,
      });
    }
  }

  const avgConfidence = fields.length
    ? fields.reduce((s, f) => s + f.confidence, 0) / fields.length
    : 0;

  return { confidence: avgConfidence, pages, tokens: 0, fields };
}
