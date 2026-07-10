import { authClient, db, envVar, verifyJwt, type Env } from "./auth/_utils";

type JsonObject = Record<string, unknown>;

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

async function getUserIdFromRequest(req: Request, env: Env): Promise<string | null> {
  const token = getBearer(req);
  if (!token) return null;

  const jwtSecret = envVar(env, "SUPABASE_JWT_SECRET");
  if (jwtSecret) {
    const payload = await verifyJwt(token, jwtSecret);
    if (payload?.sub) return payload.sub;
  }

  const { data, error } = await authClient(env).auth.getUser(token);
  if (error) return null;
  return data.user?.id ?? null;
}

async function loadAccessibleDocument(
  req: Request,
  env: Env,
  documentId: string,
): Promise<JsonObject | Response> {
  const userId = await getUserIdFromRequest(req, env);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const client = db(env);
  const { data: document, error: docErr } = await client
    .from("documents")
    .select("id, organization_id, storage_path, file_name, mime_type")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr) throw docErr;
  if (!document) return json({ error: "Document not found" }, 404);

  const doc = document as JsonObject;
  const { data: profile, error: profileErr } = await client
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) throw profileErr;

  const isSuperAdmin = !!(profile as { is_super_admin?: boolean } | null)?.is_super_admin;
  if (!isSuperAdmin) {
    const { data: membership, error: memberErr } = await client
      .from("organization_members")
      .select("id")
      .eq("organization_id", doc.organization_id as string)
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (memberErr) throw memberErr;
    if (!membership) return json({ error: "You do not have access to this document" }, 403);
  }

  return doc;
}

export async function handleDocumentsApi(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/documents")) return null;

  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const signedUrlMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/signed-url$/);
  const previewMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/preview$/);
  const match = signedUrlMatch ?? previewMatch;
  if (req.method !== "GET" || !match) return json({ error: "Not found" }, 404);

  try {
    const client = db(env);
    const documentId = decodeURIComponent(match[1]);
    const document = await loadAccessibleDocument(req, env, documentId);
    if (document instanceof Response) return document;
    const doc = document;

    const storagePath = typeof doc.storage_path === "string" ? doc.storage_path : null;
    if (!storagePath) return json({ error: "Document has no storage path" }, 400);

    if (previewMatch) {
      const { data: file, error } = await client.storage.from("documents").download(storagePath);
      if (error) throw error;

      const contentType =
        typeof doc.mime_type === "string" && doc.mime_type
          ? doc.mime_type
          : file.type || "application/octet-stream";
      const fileName =
        typeof doc.file_name === "string" && doc.file_name ? doc.file_name : "document";

      return new Response(file, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const { data, error } = await client.storage
      .from("documents")
      .createSignedUrl(storagePath, 3600);
    if (error) throw error;

    return json({ signedUrl: data?.signedUrl ?? null });
  } catch (error) {
    console.error("[documents api]", error);
    return json({ error: "Could not create document preview URL" }, 500);
  }
}
