/**
 * BillSOS · Delete Account
 *
 * Permanently deletes the calling user's account and cleans up their data:
 *   1. Verifies the JWT matches the user_id in the request body.
 *   2. Deletes organizations where this user is the only active owner
 *      (cascade removes all of that org's documents, jobs, API keys, etc.).
 *   3. Calls auth.admin.deleteUser() which cascades to profiles and
 *      organization_members via ON DELETE CASCADE foreign keys.
 *
 * Called by: useDeleteAccount() in src/lib/queries/index.ts
 * Auth:      supabase.functions.invoke() auto-adds the caller's JWT as
 *            Authorization: Bearer <jwt>.  We verify it here.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function log(
  level: "info" | "warn" | "error",
  requestId: string,
  message: string,
  data?: Record<string, unknown>,
) {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level, fn: "delete-account", request_id: requestId, message, ...data }),
  );
}

function json(body: unknown, status = 200, requestId = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
      ...CORS_HEADERS,
    },
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

  // ── 1. Verify caller's JWT ────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization header" }, 401, requestId);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  // User-context client — verifies the JWT and enforces RLS for safety.
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    log("warn", requestId, "Invalid JWT on delete-account");
    return json({ error: "Invalid or expired session" }, 401, requestId);
  }

  // ── 2. Verify body user_id matches JWT ────────────────────────────────────
  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, requestId);
  }

  if (body.user_id !== user.id) {
    log("warn", requestId, "user_id mismatch on delete-account", {
      jwt_uid: user.id,
      body_uid: body.user_id,
    });
    return json({ error: "user_id does not match authenticated user" }, 403, requestId);
  }

  log("info", requestId, "Starting account deletion", { user_id: user.id });

  // ── 3. Admin client for privileged operations ─────────────────────────────
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── 4. Delete orgs where this user is the sole active owner ───────────────
  // If we skip this step, those orgs become permanently orphaned (no owner,
  // no members) with their data inaccessible but still consuming storage.
  const { data: soleOwnedOrgs, error: orgQueryErr } = await adminClient
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .eq("status", "active");

  if (orgQueryErr) {
    log("error", requestId, "Failed to query org memberships", { error: orgQueryErr.message });
    return json({ error: "Failed to query memberships" }, 500, requestId);
  }

  for (const { organization_id } of soleOwnedOrgs ?? []) {
    // Count all active members of this org.  If this user is the only one,
    // delete the org entirely; otherwise leave it (other members remain).
    const { count } = await adminClient
      .from("organization_members")
      .select("id", { head: true, count: "exact" })
      .eq("organization_id", organization_id)
      .eq("status", "active");

    if ((count ?? 0) <= 1) {
      log("info", requestId, "Deleting sole-owner org", { organization_id });
      const { error: delOrgErr } = await adminClient
        .from("organizations")
        .delete()
        .eq("id", organization_id);
      if (delOrgErr) {
        log("error", requestId, "Failed to delete org", { organization_id, error: delOrgErr.message });
      }
    }
  }

  // ── 5. Delete the user from auth.users ────────────────────────────────────
  // Cascades via FK ON DELETE CASCADE:
  //   auth.users → profiles → organization_members, user_sessions, etc.
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user.id);

  if (deleteErr) {
    log("error", requestId, "auth.admin.deleteUser failed", { error: deleteErr.message });
    return json({ error: "Account deletion failed: " + deleteErr.message }, 500, requestId);
  }

  log("info", requestId, "Account deleted successfully", { user_id: user.id });
  return json({ success: true }, 200, requestId);
});
