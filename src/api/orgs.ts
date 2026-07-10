/**
 * Organization API router.
 * Mounted at /api/orgs/* in src/server.ts.
 *
 * POST /api/orgs/invitations          — send (or refresh) an email invitation
 * POST /api/orgs/invitations/accept   — accept by token (email link) or id (in-app)
 * POST /api/orgs/invitations/decline  — decline an invitation addressed to me
 * POST /api/orgs/invitations/resend   — admin: regenerate token + resend email
 *
 * Runs with the service-role client because acceptance must create membership
 * rows for users who are not members yet (RLS would block them). Every handler
 * therefore re-checks authorization explicitly before touching data.
 */

import {
  db,
  envVar,
  err,
  ok,
  randomToken,
  sendEmail,
  sha256hex,
  verifyJwt,
  type Env,
} from "./auth/_utils";
import { organizationInviteTemplate } from "./auth/email-templates";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITABLE_ROLES = ["admin", "member", "viewer"] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getUserId(req: Request, env: Env): Promise<string | null> {
  const h = req.headers.get("Authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  if (!token) return null;
  const secret = envVar(env, "SUPABASE_JWT_SECRET");
  if (!secret) return null;
  const payload = await verifyJwt(token, secret);
  return payload?.sub ?? null;
}

function appUrl(req: Request, env: Env): string {
  return envVar(env, "VITE_APP_URL") ?? new URL(req.url).origin;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

type InviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
};

function sanitizeInvite(row: Record<string, unknown>): InviteRow {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    email: row.email as string,
    role: row.role as string,
    status: row.status as string,
    expires_at: row.expires_at as string,
    created_at: row.created_at as string,
  };
}

async function callerName(env: Env, userId: string): Promise<string | null> {
  const { data } = await db(env)
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  const name = (data.full_name as string | null)?.trim();
  return name || (data.email as string);
}

/** Caller must be an active owner/admin of the org; returns their role. */
async function requireOrgAdmin(env: Env, userId: string, orgId: string): Promise<string | null> {
  const { data } = await db(env)
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const role = data?.role as string | undefined;
  return role === "owner" || role === "admin" ? role : null;
}

async function sendInviteEmail(
  req: Request,
  env: Env,
  input: { to: string; inviterName: string | null; orgName: string; role: string; token: string },
): Promise<boolean> {
  const base = appUrl(req, env);
  const template = organizationInviteTemplate({
    inviterName: input.inviterName,
    orgName: input.orgName,
    role: input.role,
    appUrl: base,
    acceptUrl: `${base}/invite?token=${encodeURIComponent(input.token)}`,
  });
  try {
    await sendEmail(env, input.to, template.subject, template.html, template.text);
    return true;
  } catch (e) {
    // The invitation row already exists and existing users can accept in-app,
    // so a broken SMTP setup should not fail the whole request.
    console.error("[orgs api] invite email failed", e);
    return false;
  }
}

// ── POST /api/orgs/invitations ───────────────────────────────────────────────
async function handleSendInvite(req: Request, env: Env): Promise<Response> {
  const userId = await getUserId(req, env);
  if (!userId) return err("Unauthorized", 401);

  const body = (await req.json().catch(() => ({}))) as {
    organizationId?: string;
    email?: string;
    role?: string;
  };
  const orgId = body.organizationId;
  const email = body.email?.trim().toLowerCase();
  const role = body.role as InvitableRole | undefined;

  if (!orgId || !email || !role) return err("organizationId, email and role are required", 400);
  if (!isValidEmail(email)) return err("Enter a valid email address", 400);
  if (!INVITABLE_ROLES.includes(role)) return err("Role must be admin, member, or viewer", 400);

  if (!(await requireOrgAdmin(env, userId, orgId)))
    return err("Only workspace owners and admins can invite members", 403);

  const client = db(env);
  const { data: org } = await client
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return err("Workspace not found", 404);

  // Reject if that email already belongs to an active member.
  const { data: targetProfile } = await client
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();
  if (targetProfile) {
    const { data: membership } = await client
      .from("organization_members")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("user_id", targetProfile.id as string)
      .maybeSingle();
    if (membership?.status === "active")
      return err("That person is already a member of this workspace", 409);
  }

  const token = randomToken();
  const tokenHash = await sha256hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  // One pending invite per (org, email): refresh it instead of duplicating.
  const { data: existing } = await client
    .from("organization_invitations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  let invite: Record<string, unknown> | null = null;
  if (existing) {
    const { data, error } = await client
      .from("organization_invitations")
      .update({ role, token_hash: tokenHash, expires_at: expiresAt, invited_by: userId })
      .eq("id", existing.id as string)
      .select()
      .single();
    if (error) return err("Could not update the invitation", 500);
    invite = data;
  } else {
    const { data, error } = await client
      .from("organization_invitations")
      .insert({
        organization_id: orgId,
        email,
        role,
        token_hash: tokenHash,
        invited_by: userId,
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (error) {
      console.error("[orgs api] invite insert failed", error);
      return err("Could not create the invitation", 500);
    }
    invite = data;
  }

  const emailSent = await sendInviteEmail(req, env, {
    to: email,
    inviterName: await callerName(env, userId),
    orgName: org.name as string,
    role,
    token,
  });

  return ok({ invitation: sanitizeInvite(invite!), emailSent });
}

// ── POST /api/orgs/invitations/accept ────────────────────────────────────────
async function handleAcceptInvite(req: Request, env: Env): Promise<Response> {
  const userId = await getUserId(req, env);
  if (!userId) return err("Unauthorized", 401);

  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    invitationId?: string;
  };
  if (!body.token && !body.invitationId) return err("token or invitationId is required", 400);

  const client = db(env);
  let query = client.from("organization_invitations").select("*");
  if (body.token) {
    query = query.eq("token_hash", await sha256hex(body.token.trim()));
  } else {
    query = query.eq("id", body.invitationId!);
  }
  const { data: invite } = await query.maybeSingle();
  if (!invite) return err("This invitation doesn't exist or was already used", 404);
  if (invite.status !== "pending") return err(`This invitation was already ${invite.status}`, 410);

  const { data: profile } = await client
    .from("profiles")
    .select("id, email, current_org_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return err("Profile not found", 404);
  if ((profile.email as string).toLowerCase() !== (invite.email as string).toLowerCase())
    return err(
      `This invitation was sent to ${invite.email}. You are signed in as ${profile.email}.`,
      403,
    );

  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    await client
      .from("organization_invitations")
      .update({ status: "expired" })
      .eq("id", invite.id as string);
    return err("This invitation has expired. Ask for a new one.", 410);
  }

  const orgId = invite.organization_id as string;
  const { data: org } = await client
    .from("organizations")
    .select("id, name, slug")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return err("This workspace no longer exists", 410);

  const { data: membership } = await client
    .from("organization_members")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  let alreadyMember = false;
  if (membership?.status === "active") {
    alreadyMember = true;
  } else if (membership) {
    // Legacy pending/inactive row from the old invite flow — activate it.
    const { error } = await client
      .from("organization_members")
      .update({ role: invite.role, status: "active", joined_at: new Date().toISOString() })
      .eq("id", membership.id as string);
    if (error) return err("Could not activate your membership", 500);
  } else {
    const { error } = await client.from("organization_members").insert({
      organization_id: orgId,
      user_id: userId,
      role: invite.role,
      status: "active",
      invited_by: invite.invited_by,
      invited_at: invite.created_at,
      joined_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[orgs api] membership insert failed", error);
      return err("Could not add you to the workspace", 500);
    }
  }

  await client
    .from("organization_invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id as string);

  if (!profile.current_org_id) {
    await client.from("profiles").update({ current_org_id: orgId }).eq("id", userId);
  }

  return ok({ organization: org, alreadyMember });
}

// ── POST /api/orgs/invitations/decline ───────────────────────────────────────
async function handleDeclineInvite(req: Request, env: Env): Promise<Response> {
  const userId = await getUserId(req, env);
  if (!userId) return err("Unauthorized", 401);

  const body = (await req.json().catch(() => ({}))) as { invitationId?: string };
  if (!body.invitationId) return err("invitationId is required", 400);

  const client = db(env);
  const [{ data: invite }, { data: profile }] = await Promise.all([
    client.from("organization_invitations").select("*").eq("id", body.invitationId).maybeSingle(),
    client.from("profiles").select("email").eq("id", userId).maybeSingle(),
  ]);
  if (!invite || invite.status !== "pending")
    return err("This invitation doesn't exist or was already handled", 404);
  if (
    !profile ||
    (profile.email as string).toLowerCase() !== (invite.email as string).toLowerCase()
  )
    return err("This invitation was not sent to your email address", 403);

  await client
    .from("organization_invitations")
    .update({ status: "declined" })
    .eq("id", invite.id as string);
  return ok({ declined: true });
}

// ── POST /api/orgs/invitations/resend ────────────────────────────────────────
async function handleResendInvite(req: Request, env: Env): Promise<Response> {
  const userId = await getUserId(req, env);
  if (!userId) return err("Unauthorized", 401);

  const body = (await req.json().catch(() => ({}))) as { invitationId?: string };
  if (!body.invitationId) return err("invitationId is required", 400);

  const client = db(env);
  const { data: invite } = await client
    .from("organization_invitations")
    .select("*")
    .eq("id", body.invitationId)
    .maybeSingle();
  if (!invite || invite.status !== "pending")
    return err("This invitation doesn't exist or was already handled", 404);

  const orgId = invite.organization_id as string;
  if (!(await requireOrgAdmin(env, userId, orgId)))
    return err("Only workspace owners and admins can resend invitations", 403);

  const { data: org } = await client
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return err("Workspace not found", 404);

  const token = randomToken();
  const { data: updated, error } = await client
    .from("organization_invitations")
    .update({
      token_hash: await sha256hex(token),
      expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      invited_by: userId,
    })
    .eq("id", invite.id as string)
    .select()
    .single();
  if (error) return err("Could not refresh the invitation", 500);

  const emailSent = await sendInviteEmail(req, env, {
    to: invite.email as string,
    inviterName: await callerName(env, userId),
    orgName: org.name as string,
    role: invite.role as string,
    token,
  });

  return ok({ invitation: sanitizeInvite(updated), emailSent });
}

// ── Router ────────────────────────────────────────────────────────────────────
export async function handleOrgsApi(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (!path.startsWith("/api/orgs")) return null;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  try {
    if (method === "POST" && path === "/api/orgs/invitations")
      return await handleSendInvite(req, env);
    if (method === "POST" && path === "/api/orgs/invitations/accept")
      return await handleAcceptInvite(req, env);
    if (method === "POST" && path === "/api/orgs/invitations/decline")
      return await handleDeclineInvite(req, env);
    if (method === "POST" && path === "/api/orgs/invitations/resend")
      return await handleResendInvite(req, env);
    return err("Not found", 404);
  } catch (e) {
    console.error("[orgs api]", e);
    return err("Internal server error", 500);
  }
}
