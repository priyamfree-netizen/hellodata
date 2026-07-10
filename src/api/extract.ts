import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server";
import type { Env } from "./auth/_utils";

type JsonObject = Record<string, unknown>;

type ExtractRequest = {
  document_id?: string;
  template_id?: string; // explicit override — takes priority over document.template_id
  fields?: Record<string, string>;
  document_type?: string;
  options?: Record<string, boolean>;
};

const DEFAULT_EXDOC_BASE_URL = "https://exdocapi.cheapehai.shop";

const DEFAULT_FIELDS: Record<string, string> = {
  invoice_number: "invoice or bill reference number",
  vendor_name: "name of the seller, supplier, vendor, hospital, bank, or issuing party",
  client_name: "name of the buyer, customer, patient, account holder, or receiving party",
  date: "primary document date or issue date",
  due_date: "payment due date or deadline if present",
  subtotal: "amount before tax or charges",
  tax: "tax amount such as GST, VAT, or sales tax",
  total: "final total amount due or payable",
  currency: "currency code or currency symbol",
  gstin: "GSTIN, VAT, tax ID, or registration number",
  po_number: "purchase order number or order reference",
  account_number: "bank account number if present",
  statement_period: "period covered by the statement or report",
  closing_balance: "closing balance or final balance",
};

function runtimeEnv(): Record<string, unknown> {
  const cfEnv = (globalThis as { __cf_env__?: Record<string, unknown> }).__cf_env__;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return { ...(viteEnv ?? {}), ...(processEnv ?? {}), ...(cfEnv ?? {}) };
}

function envVar(env: Env, key: string): string | undefined {
  const direct = (env as Record<string, unknown>)?.[key];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const fallback = runtimeEnv()[key];
  return typeof fallback === "string" && fallback.length > 0 ? fallback : undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getBearer(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

async function getUserIdFromToken(req: Request, env: Env): Promise<string | null> {
  const token = getBearer(req);
  if (!token) return null;

  const supabase = createClient(
    envVar(env, "VITE_SUPABASE_URL") ?? "",
    envVar(env, "VITE_SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data.user?.id ?? null;
}

async function assertDocumentAccess(supabase: SupabaseClient, documentId: string, userId: string) {
  const { data: document, error: docErr } = await supabase
    .from("documents")
    .select("*, category:document_categories(code, name), template:templates(id, name)")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr) throw docErr;
  if (!document)
    throw new Response(JSON.stringify({ error: "Document not found" }), { status: 404 });

  const { data: membership, error: memberErr } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", document.organization_id)
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!membership)
    throw new Response(JSON.stringify({ error: "You do not have access to this document" }), {
      status: 403,
    });

  return document as JsonObject;
}

async function loadTemplateFields(
  supabase: SupabaseClient,
  templateId: string | null | undefined,
): Promise<{ fields: Record<string, string>; hasTemplate: boolean }> {
  if (!templateId) return { fields: {}, hasTemplate: false };

  const { data, error } = await supabase
    .from("template_fields")
    .select("key, label, data_type, config, is_enabled")
    .eq("template_id", templateId)
    .eq("is_enabled", true) // ← ONLY enabled fields
    .order("sort_order");
  if (error) throw error;

  const fields: Record<string, string> = {};
  for (const row of data ?? []) {
    if (!row.key) continue;
    const config =
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : {};

    // Build an AI-readable description. Priority: explicit description > label + data_type hint
    let description =
      typeof config.description === "string" && config.description.trim()
        ? config.description.trim()
        : (row.label ?? row.key);

    // Append a type hint so the AI knows what format to return
    if (row.data_type === "number" || row.data_type === "currency") {
      description += " (numeric value only)";
    } else if (row.data_type === "date") {
      description += " (date in ISO format)";
    }

    fields[row.key] = description;
  }

  return { fields, hasTemplate: Object.keys(fields).length > 0 };
}

function normalizeFields(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key, value]) => key.trim() && value.trim())
      .slice(0, 50),
  );
}

function inferDocumentType(document: JsonObject, requested?: string): string | undefined {
  if (requested?.trim()) return requested.trim();
  const category = document.category as { code?: string; name?: string } | null | undefined;
  if (category?.code) return category.code;
  if (category?.name) return category.name;
  return "invoice";
}

async function submitExDocJob(input: {
  apiKey: string;
  baseUrl: string;
  file: Blob;
  filename: string;
  extract: JsonObject;
}) {
  const form = new FormData();
  form.append("file", input.file, input.filename);
  form.append("extract", JSON.stringify(input.extract));

  const res = await fetch(`${input.baseUrl.replace(/\/$/, "")}/api/v1/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: form,
  });

  const body = await readJsonOrText(res);
  if (!res.ok) {
    throw new Error(`ExDocApi ${res.status}: ${extractErrorMessage(body)}`);
  }
  return body;
}

async function pollExDocJob(input: {
  apiKey: string;
  baseUrl: string;
  jobId: string;
  timeoutMs?: number;
}) {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 90_000;
  const baseUrl = input.baseUrl.replace(/\/$/, "");

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(input.jobId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
    });
    const body = await readJsonOrText(res);
    if (!res.ok) {
      throw new Error(`ExDocApi job ${res.status}: ${extractErrorMessage(body)}`);
    }

    const status =
      typeof body === "object" && body ? String((body as JsonObject).status ?? "") : "";
    if (status === "done") return body;
    if (status === "failed") throw new Error(extractErrorMessage(body));

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("ExDocApi job timed out while waiting for filtered data");
}

async function fetchExDocResult(input: { apiKey: string; baseUrl: string; jobId: string }) {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(input.jobId)}/result`, {
    headers: { Authorization: `Bearer ${input.apiKey}` },
  });
  const body = await readJsonOrText(res);
  if (!res.ok) {
    throw new Error(`ExDocApi result ${res.status}: ${extractErrorMessage(body)}`);
  }
  return body;
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function extractErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as JsonObject;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return String(body);
}

function getJobId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as JsonObject;
  const id = record.job_id ?? record.id;
  return typeof id === "string" ? id : null;
}

function getFilteredData(body: unknown, fieldKeys: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const record = body as JsonObject;
  const candidates = [
    record.result,
    record.data,
    record.extracted_data,
    record.fields,
    record.output,
    record,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const value = candidate as JsonObject;
    if (fieldKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
      return Object.fromEntries(fieldKeys.map((key) => [key, value[key] ?? null]));
    }
  }

  return {};
}

function confidenceFromData(data: Record<string, unknown>): number {
  const total = Object.keys(data).length;
  if (!total) return 0;
  const filled = Object.values(data).filter((value) => value != null && value !== "").length;
  return Math.round((filled / total) * 100);
}

export async function handleExtractApi(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/extract")) return null;

  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" || url.pathname !== "/api/extract/document") {
    return json({ error: "Not found" }, 404);
  }

  try {
    const apiKey = envVar(env, "EXDOC_API_KEY");
    if (!apiKey) return json({ error: "EXDOC_API_KEY is not configured" }, 500);

    const userId = await getUserIdFromToken(req, env);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json()) as ExtractRequest;
    if (!body.document_id) return json({ error: "document_id is required" }, 400);

    const supabase = getServiceRoleClient();
    const document = await assertDocumentAccess(supabase, body.document_id, userId);
    const storagePath = typeof document.storage_path === "string" ? document.storage_path : null;
    if (!storagePath) return json({ error: "Document has no storage path" }, 400);

    // Resolve which template to use:
    // 1. Explicit template_id in request body  (highest priority — user picked it on upload page)
    // 2. template_id saved on the document itself  (set at upload time)
    // 3. No template → fall back to DEFAULT_FIELDS
    const resolvedTemplateId = (body.template_id ?? document.template_id ?? null) as string | null;

    const { fields: templateFields, hasTemplate } = await loadTemplateFields(
      supabase,
      resolvedTemplateId,
    );

    // If a template is selected, use ONLY its enabled fields (+ any extra fields caller passed).
    // If no template, fall back to the hardcoded DEFAULT_FIELDS so at least something is extracted.
    const baseFields: Record<string, string> = hasTemplate ? templateFields : DEFAULT_FIELDS;
    const fields = normalizeFields({ ...baseFields, ...(body.fields ?? {}) });

    if (Object.keys(fields).length === 0)
      return json({ error: "At least one field is required" }, 400);

    // Use the resolved template id for job / extraction records
    const effectiveTemplateId =
      resolvedTemplateId ?? (document.template_id as string | null) ?? null;

    const { data: job, error: jobErr } = await supabase
      .from("processing_jobs")
      .insert({
        organization_id: document.organization_id,
        document_id: document.id,
        template_id: effectiveTemplateId,
        name: document.file_name,
        stage: "queued",
        total_docs: 1,
        total_pages: document.page_count ?? 1,
        metadata: {
          provider: "exdocapi",
          options: body.options ?? {},
          document_type: inferDocumentType(document, body.document_type),
          fields,
        },
      })
      .select()
      .single();
    if (jobErr) throw jobErr;

    const started = Date.now();
    try {
      await supabase
        .from("processing_jobs")
        .update({ stage: "ocr", started_at: new Date().toISOString() })
        .eq("id", job.id);
      // Sync template_id onto the document if it was supplied via request body
      await supabase
        .from("documents")
        .update({
          status: "processing",
          ...(effectiveTemplateId && !document.template_id
            ? { template_id: effectiveTemplateId }
            : {}),
        })
        .eq("id", document.id);

      const { data: file, error: downloadErr } = await supabase.storage
        .from("documents")
        .download(storagePath);
      if (downloadErr) throw downloadErr;

      await supabase.from("processing_jobs").update({ stage: "ai_extraction" }).eq("id", job.id);
      const extract = {
        document_type: inferDocumentType(document, body.document_type),
        fields,
      };
      const submit = await submitExDocJob({
        apiKey,
        baseUrl: envVar(env, "EXDOC_API_BASE_URL") ?? DEFAULT_EXDOC_BASE_URL,
        file,
        filename: String(document.file_name ?? "document.pdf"),
        extract,
      });

      const exdocJobId = getJobId(submit);
      const baseUrl = envVar(env, "EXDOC_API_BASE_URL") ?? DEFAULT_EXDOC_BASE_URL;
      const finalBody = exdocJobId
        ? await pollExDocJob({ apiKey, baseUrl, jobId: exdocJobId }).then(() =>
            fetchExDocResult({ apiKey, baseUrl, jobId: exdocJobId }),
          )
        : submit;

      await supabase.from("processing_jobs").update({ stage: "validation" }).eq("id", job.id);

      const data = getFilteredData(finalBody, Object.keys(fields));
      const confidence = confidenceFromData(data);
      const durationMs = Date.now() - started;

      const { data: extraction, error: extractionErr } = await supabase
        .from("extractions")
        .insert({
          organization_id: document.organization_id,
          document_id: document.id,
          job_id: job.id,
          template_id: effectiveTemplateId,
          status: "done",
          confidence,
          field_count: Object.keys(data).length,
          data,
          duration_ms: durationMs,
        })
        .select()
        .single();
      if (extractionErr) throw extractionErr;

      const rows = Object.entries(data).map(([key, value]) => ({
        extraction_id: extraction.id,
        field_key: key,
        value_text:
          value == null ? null : typeof value === "string" ? value : JSON.stringify(value),
        confidence: value == null || value === "" ? 0 : confidence / 100,
      }));
      if (rows.length) {
        const { error: fieldErr } = await supabase.from("extraction_fields").insert(rows);
        if (fieldErr) {
          console.warn(
            "[extract api] extraction_fields insert failed after result was saved",
            fieldErr,
          );
        }
      }

      await Promise.all([
        supabase
          .from("processing_jobs")
          .update({
            stage: "completed",
            completed_docs: 1,
            confidence,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            metadata: {
              provider: "exdocapi",
              exdoc_job_id: exdocJobId,
              template_id: effectiveTemplateId,
              options: body.options ?? {},
              document_type: inferDocumentType(document, body.document_type),
              fields,
            },
          })
          .eq("id", job.id),
        supabase
          .from("documents")
          .update({ status: "extracted", page_count: document.page_count ?? 1 })
          .eq("id", document.id),
        // Bump the template's download counter so it shows usage
        ...(effectiveTemplateId
          ? [
              supabase
                .rpc("increment_template_downloads", { template_id_arg: effectiveTemplateId })
                .maybeSingle(),
            ]
          : []),
      ]);

      return json({
        job_id: job.id,
        document_id: document.id,
        extraction_id: extraction.id,
        status: "done",
        data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await Promise.allSettled([
        supabase
          .from("processing_jobs")
          .update({
            stage: "failed",
            failed_docs: 1,
            error_message: message,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - started,
          })
          .eq("id", job.id),
        supabase.from("documents").update({ status: "failed" }).eq("id", document.id),
        supabase.from("extractions").insert({
          organization_id: document.organization_id,
          document_id: document.id,
          job_id: job.id,
          template_id: effectiveTemplateId,
          status: "failed",
          error_message: message,
          duration_ms: Date.now() - started,
          data: {},
        }),
      ]);
      return json({ error: message, job_id: job.id, document_id: document.id }, 502);
    }
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[extract api]", error);
    return json({ error: error instanceof Error ? error.message : "Extraction failed" }, 500);
  }
}
