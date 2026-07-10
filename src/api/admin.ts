import { authClient, db, envVar, verifyJwt, type Env } from "./auth/_utils";
import { handleAdminRazorpayConfig } from "./payment";
import { sendSmtpEmail } from "./auth/smtp";

const DEFAULT_EXDOC_BASE_URL = "https://exdocapi.cheapehai.shop";

type SupabaseAdmin = ReturnType<typeof db>;
type DbRow = Record<string, any>;

interface AdminUserRestrictionDto {
  uploadsDisabled: boolean;
  apiRestricted: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface AdminUserListRowDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  country: string | null;
  avatar: string;
  avatarUrl: string | null;
  primaryOrg: { id: string; name: string; slug: string; status: string } | null;
  plan: string;
  storageUsed: string;
  storageUsedBytes: number;
  creditsRemaining: number;
  pagesProcessed: number;
  aiTokens30d: number;
  apiCalls30d: number;
  teamSize: number;
  activeSessions: number;
  lastLogin: string | null;
  lastActivity: string | null;
  createdAt: string;
  riskScore: number;
  restrictions: AdminUserRestrictionDto;
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

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function displayName(profile: DbRow): string {
  const fromParts = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return firstString(profile.full_name) ?? firstString(fromParts) ?? firstString(profile.email) ?? "Unnamed user";
}

function initials(profile: DbRow): string {
  const existing = firstString(profile.avatar_initials);
  if (existing) return existing.slice(0, 3).toUpperCase();
  const name = displayName(profile);
  const value = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return value || "U";
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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

async function requireSuperAdminUser(
  req: Request,
  env: Env,
): Promise<{ userId: string } | Response> {
  const userId = await getUserIdFromRequest(req, env);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const { data: profile, error } = await db(env)
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile?.is_super_admin) return json({ error: "Forbidden" }, 403);
  return { userId };
}

async function requireSuperAdmin(req: Request, env: Env): Promise<Response | null> {
  const auth = await requireSuperAdminUser(req, env);
  return auth instanceof Response ? auth : null;
}

async function handleDashboardKpis(req: Request, env: Env): Promise<Response> {
  const forbidden = await requireSuperAdmin(req, env);
  if (forbidden) return forbidden;

  // dashboard_kpis() uses auth.uid() internally which is NULL when called from the
  // service-role client (no session context). Query the counts directly instead.
  const client = db(env);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [
    usersResult,
    orgsResult,
    enterprisePlanResult,
    pagesTodayResult,
    queueActiveResult,
    failedTodayResult,
    webhooksResult,
  ] = await Promise.all([
    client.from("profiles").select("id", { count: "exact", head: true }),
    client.from("organizations").select("id", { count: "exact", head: true }).neq("status", "suspended"),
    client.from("plans").select("id").eq("code", "enterprise").limit(1).maybeSingle(),
    client.from("documents").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
    client
      .from("processing_jobs")
      .select("id", { count: "exact", head: true })
      .in("stage", ["pending", "queued", "ocr", "ai_extraction", "validation", "export", "retry"]),
    client
      .from("processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("stage", "failed")
      .gte("created_at", todayIso),
    client.from("webhooks").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  // enterprise org count needs the plan id
  const enterprisePlanId = (enterprisePlanResult.data as DbRow | null)?.id ?? null;
  let enterpriseCount = 0;
  if (enterprisePlanId) {
    const { count } = await client
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .neq("status", "suspended")
      .eq("plan_id", enterprisePlanId);
    enterpriseCount = count ?? 0;
  }

  // Throw on hard errors (missing tables etc.)
  for (const result of [usersResult, orgsResult, pagesTodayResult, queueActiveResult, failedTodayResult, webhooksResult]) {
    if (result.error) throw result.error;
  }

  return json({
    users: usersResult.count ?? 0,
    orgs: orgsResult.count ?? 0,
    enterprises: enterpriseCount,
    pagesToday: pagesTodayResult.count ?? 0,
    queueActive: queueActiveResult.count ?? 0,
    failedToday: failedTodayResult.count ?? 0,
    webhooksActive: webhooksResult.count ?? 0,
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 4_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = Date.now();
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkExDoc(baseUrl: string, apiKey: string | undefined) {
  const base = baseUrl.replace(/\/$/, "");
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const candidates = [`${base}/health`, `${base}/api/health`, base];
  let best: { ok: boolean; status: number; latencyMs: number; url: string } | null = null;

  for (const url of candidates) {
    try {
      const result = await fetchWithTimeout(url, { method: "GET", headers });
      const next = { ...result, url };
      if (!best || next.ok || (!best.ok && next.status < 500)) best = next;
      if (next.ok) break;
    } catch {
      // Try the next common health URL before reporting the provider as unreachable.
    }
  }

  return best;
}

async function handleExDocHealth(req: Request, env: Env): Promise<Response> {
  const forbidden = await requireSuperAdmin(req, env);
  if (forbidden) return forbidden;

  const apiKey = envVar(env, "EXDOC_API_KEY");
  const baseUrl = envVar(env, "EXDOC_API_BASE_URL") ?? DEFAULT_EXDOC_BASE_URL;
  const probe = await checkExDoc(baseUrl, apiKey);
  const configured = !!apiKey;
  const reachable = !!probe;
  const live = configured && !!probe?.ok;
  const status = live ? "live" : configured && reachable ? "degraded" : "down";

  return json({
    provider: "ExDoc API",
    baseUrl: baseUrl.replace(/\/$/, ""),
    configured,
    reachable,
    live,
    status,
    latencyMs: probe?.latencyMs ?? null,
    httpStatus: probe?.status ?? null,
    checkedUrl: probe?.url ?? null,
    checkedAt: new Date().toISOString(),
  });
}

async function loadRowsForProfiles(
  client: SupabaseAdmin,
  profiles: DbRow[],
): Promise<AdminUserListRowDto[]> {
  if (profiles.length === 0) return [];

  const userIds = profiles.map((p) => p.id);
  const since = daysAgo(30);

  const [
    membershipsResult,
    sessionsResult,
    restrictionsResult,
  ] = await Promise.all([
    client
      .from("organization_members")
      .select("*")
      .in("user_id", userIds)
      .order("joined_at", { ascending: true }),
    client
      .from("user_sessions")
      .select("user_id")
      .in("user_id", userIds)
      .is("revoked_at", null),
    client.from("admin_user_restrictions").select("*").in("user_id", userIds),
  ]);

  if (membershipsResult.error) throw membershipsResult.error;
  if (sessionsResult.error) throw sessionsResult.error;
  if (restrictionsResult.error) throw restrictionsResult.error;

  const memberships = (membershipsResult.data ?? []) as DbRow[];
  const currentOrgIds = profiles.map((p) => p.current_org_id).filter(Boolean);
  const memberOrgIds = memberships.map((m) => m.organization_id).filter(Boolean);
  const orgIds = Array.from(new Set([...currentOrgIds, ...memberOrgIds]));

  const organizationsResult =
    orgIds.length > 0
      ? await client.from("organizations").select("*").in("id", orgIds)
      : { data: [], error: null };
  if (organizationsResult.error) throw organizationsResult.error;

  const organizations = (organizationsResult.data ?? []) as DbRow[];
  const planIds = Array.from(new Set(organizations.map((org) => org.plan_id).filter(Boolean)));

  const [plansResult, usageResult] = await Promise.all([
    planIds.length > 0
      ? client.from("plans").select("*").in("id", planIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length > 0
      ? client.from("usage_records").select("*").in("organization_id", orgIds).gte("date", since)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (plansResult.error) throw plansResult.error;
  if (usageResult.error) throw usageResult.error;

  const orgById = new Map(organizations.map((org) => [org.id, org]));
  const planById = new Map(((plansResult.data ?? []) as DbRow[]).map((plan) => [plan.id, plan]));
  const membershipsByUser = new Map<string, DbRow[]>();
  const sessionsByUser = new Map<string, number>();
  const restrictionsByUser = new Map<string, DbRow>();
  const usageByOrg = new Map<string, DbRow[]>();

  for (const membership of memberships) {
    const list = membershipsByUser.get(membership.user_id) ?? [];
    list.push(membership);
    membershipsByUser.set(membership.user_id, list);
  }

  for (const session of (sessionsResult.data ?? []) as DbRow[]) {
    sessionsByUser.set(session.user_id, (sessionsByUser.get(session.user_id) ?? 0) + 1);
  }

  for (const restriction of (restrictionsResult.data ?? []) as DbRow[]) {
    restrictionsByUser.set(restriction.user_id, restriction);
  }

  for (const usage of (usageResult.data ?? []) as DbRow[]) {
    const list = usageByOrg.get(usage.organization_id) ?? [];
    list.push(usage);
    usageByOrg.set(usage.organization_id, list);
  }

  return profiles.map((profile) => {
    const membershipsForUser = membershipsByUser.get(profile.id) ?? [];
    const firstActiveMembership =
      membershipsForUser.find((m) => m.status === "active") ?? membershipsForUser[0] ?? null;
    const primaryOrgId =
      (profile.current_org_id && orgById.has(profile.current_org_id)
        ? profile.current_org_id
        : firstActiveMembership?.organization_id) ?? null;
    const org = primaryOrgId ? orgById.get(primaryOrgId) ?? null : null;
    const usage = org ? usageByOrg.get(org.id) ?? [] : [];
    const restriction = restrictionsByUser.get(profile.id);
    const plan = org?.plan_id ? planById.get(org.plan_id) : null;
    const pages30d = usage.reduce((sum, row) => sum + numberValue(row.pages_processed), 0);
    const aiTokens30d = usage.reduce((sum, row) => sum + numberValue(row.ai_tokens_used), 0);
    const apiCalls30d = usage.reduce((sum, row) => sum + numberValue(row.api_calls), 0);
    const storageFromUsage = usage.reduce(
      (max, row) => Math.max(max, numberValue(row.storage_bytes)),
      0,
    );
    const storageUsedBytes = Math.max(numberValue(org?.storage_used_bytes), storageFromUsage);
    const teamSize =
      numberValue(org?.team_size) ||
      membershipsForUser.filter((m) => m.organization_id === primaryOrgId && m.status === "active")
        .length;

    return {
      id: profile.id,
      name: displayName(profile),
      email: String(profile.email ?? ""),
      phone: profile.phone ?? null,
      status: String(profile.status ?? "inactive"),
      country: profile.country ?? null,
      avatar: initials(profile),
      avatarUrl: profile.avatar_url ?? null,
      primaryOrg: org
        ? {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: String(org.status ?? "active"),
        }
        : null,
      plan: String(plan?.name ?? (org ? "Unassigned" : "No org")),
      storageUsed: formatBytes(storageUsedBytes),
      storageUsedBytes,
      creditsRemaining: numberValue(profile.credits_remaining),
      pagesProcessed: Math.max(numberValue(org?.pages_processed), pages30d),
      aiTokens30d,
      apiCalls30d,
      teamSize,
      activeSessions: sessionsByUser.get(profile.id) ?? 0,
      lastLogin: profile.last_login_at ?? null,
      lastActivity: profile.last_activity_at ?? org?.last_activity_at ?? null,
      createdAt: profile.created_at,
      riskScore: numberValue(profile.risk_score),
      restrictions: {
        uploadsDisabled: !!restriction?.uploads_disabled,
        apiRestricted: !!restriction?.api_restricted,
        reason: restriction?.reason ?? null,
        updatedBy: restriction?.updated_by ?? null,
        updatedAt: restriction?.updated_at ?? null,
      },
    };
  });
}

async function handleAdminUsersList(req: Request, env: Env): Promise<Response> {
  const forbidden = await requireSuperAdmin(req, env);
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 200);
  const search = (url.searchParams.get("search") ?? "").trim();
  const cursor = url.searchParams.get("cursor");

  let query = db(env)
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (search) {
    const safeSearch = search.replace(/[%_]/g, "\\$&");
    const pattern = `%${safeSearch}%`;
    query = query.or(`email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},full_name.ilike.${pattern}`);
  }
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as DbRow[]).slice(0, limit);
  const enriched = await loadRowsForProfiles(db(env), rows);
  const hasMore = (data ?? []).length > limit;

  return json({
    rows: enriched,
    nextCursor: hasMore ? rows[rows.length - 1]?.created_at ?? null : null,
  });
}

async function loadUserProfile(client: SupabaseAdmin, userId: string): Promise<DbRow | null> {
  const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as DbRow | null) ?? null;
}

async function handleAdminUserDetail(req: Request, env: Env, userId: string): Promise<Response> {
  const forbidden = await requireSuperAdmin(req, env);
  if (forbidden) return forbidden;

  const client = db(env);
  const profile = await loadUserProfile(client, userId);
  if (!profile) return json({ error: "User not found" }, 404);

  const [row] = await loadRowsForProfiles(client, [profile]);
  const primaryOrgId = row.primaryOrg?.id ?? null;
  const since = daysAgo(30);

  const [
    membershipsResult,
    usageResult,
    transactionsResult,
    apiKeysResult,
    auditLogsResult,
    securityEventsResult,
    sessionsResult,
    notesResult,
  ] = await Promise.all([
    client
      .from("organization_members")
      .select("*, organization:organizations(*)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: true }),
    primaryOrgId
      ? client
        .from("usage_records")
        .select("*")
        .eq("organization_id", primaryOrgId)
        .gte("date", since)
        .order("date", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    primaryOrgId
      ? client
        .from("transactions")
        .select("*")
        .eq("organization_id", primaryOrgId)
        .order("created_at", { ascending: false })
        .limit(20)
      : Promise.resolve({ data: [], error: null }),
    primaryOrgId
      ? client
        .from("api_keys")
        .select("*")
        .eq("organization_id", primaryOrgId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(20)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("audit_logs")
      .select("*")
      .or(`actor_id.eq.${userId},target_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(50),
    client
      .from("security_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    client
      .from("user_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(20),
    client
      .from("admin_user_notes")
      .select("*, author:profiles!admin_user_notes_author_id_fkey(id,email,full_name,avatar_initials)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  for (const result of [
    membershipsResult,
    usageResult,
    transactionsResult,
    apiKeysResult,
    auditLogsResult,
    securityEventsResult,
    sessionsResult,
    notesResult,
  ]) {
    if (result.error) throw result.error;
  }

  return json({
    ...row,
    profile,
    memberships: membershipsResult.data ?? [],
    usage30d: usageResult.data ?? [],
    transactions: transactionsResult.data ?? [],
    apiKeys: apiKeysResult.data ?? [],
    auditLogs: auditLogsResult.data ?? [],
    securityEvents: securityEventsResult.data ?? [],
    sessions: sessionsResult.data ?? [],
    notes: notesResult.data ?? [],
  });
}

async function parseJsonBody(req: Request): Promise<DbRow> {
  try {
    const value = await req.json();
    return value && typeof value === "object" ? (value as DbRow) : {};
  } catch {
    return {};
  }
}

async function createAdminNote(req: Request, env: Env, userId: string): Promise<Response> {
  const auth = await requireSuperAdminUser(req, env);
  if (auth instanceof Response) return auth;

  const client = db(env);
  const profile = await loadUserProfile(client, userId);
  if (!profile) return json({ error: "User not found" }, 404);

  const body = String((await parseJsonBody(req)).body ?? "").trim();
  if (!body) return json({ error: "Note body is required" }, 400);
  if (body.length > 4000) return json({ error: "Note body is too long" }, 400);

  const { data, error } = await client
    .from("admin_user_notes")
    .insert({ user_id: userId, author_id: auth.userId, body })
    .select("*, author:profiles!admin_user_notes_author_id_fkey(id,email,full_name,avatar_initials)")
    .single();

  if (error) throw error;
  return json({ note: data }, 201);
}

async function primaryOrgIdForUser(client: SupabaseAdmin, userId: string): Promise<string | null> {
  const profile = await loadUserProfile(client, userId);
  if (!profile) return null;
  if (profile.current_org_id) return profile.current_org_id;

  const { data, error } = await client
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DbRow | null)?.organization_id ?? null;
}

async function insertAuditLog(
  client: SupabaseAdmin,
  input: {
    actorId: string;
    userId: string;
    organizationId: string | null;
    action: string;
    details: string;
    metadata?: DbRow;
  },
) {
  const { error } = await client.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    action: input.action,
    target_type: "profile",
    target_id: input.userId,
    details: input.details,
    metadata: input.metadata ?? {},
  });
  if (error) console.warn("[admin api] audit log insert failed", error);
}

async function handleAdminUserAction(req: Request, env: Env, userId: string): Promise<Response> {
  const auth = await requireSuperAdminUser(req, env);
  if (auth instanceof Response) return auth;

  const client = db(env);
  const profile = await loadUserProfile(client, userId);
  if (!profile) return json({ error: "User not found" }, 404);

  const body = await parseJsonBody(req);
  const action = String(body.action ?? "");
  const primaryOrgId = await primaryOrgIdForUser(client, userId);

  if (action === "suspend" || action === "unsuspend") {
    const suspend = action === "suspend" || body.suspend === true;
    const { error } = await client
      .from("profiles")
      .update({ status: suspend ? "suspended" : "active" })
      .eq("id", userId);
    if (error) throw error;
    await insertAuditLog(client, {
      actorId: auth.userId,
      userId,
      organizationId: primaryOrgId,
      action: suspend ? "admin.user.suspend" : "admin.user.unsuspend",
      details: suspend ? "Superadmin suspended user" : "Superadmin unsuspended user",
    });
    return json({ ok: true });
  }

  if (action === "add_credits") {
    const credits = Math.floor(numberValue(body.credits));
    if (credits <= 0 || credits > 1_000_000) {
      return json({ error: "Credits must be between 1 and 1000000" }, 400);
    }
    if (!primaryOrgId) return json({ error: "User has no organization for credits" }, 400);

    const { error } = await client.rpc("add_org_credits", {
      p_org_id: primaryOrgId,
      p_credits: credits,
    });
    if (error) throw error;
    await insertAuditLog(client, {
      actorId: auth.userId,
      userId,
      organizationId: primaryOrgId,
      action: "admin.user.add_credits",
      details: `Superadmin added ${credits} credits`,
      metadata: { credits },
    });
    return json({ ok: true });
  }

  if (action === "toggle_uploads" || action === "toggle_api") {
    const disabled = body.disabled === true || body.restricted === true;
    const reason = firstString(body.reason) ?? null;
    const isUploads = action === "toggle_uploads";
    const patch: Record<string, unknown> = {
      user_id: userId,
      uploads_disabled: isUploads ? disabled : undefined,
      api_restricted: isUploads ? undefined : disabled,
      reason,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    };
    // Remove undefined fields so Supabase doesn't overwrite existing columns with NULL
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete patch[key];
    }

    const { error } = await client
      .from("admin_user_restrictions")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(patch as any, { onConflict: "user_id" });
    if (error) throw error;

    await insertAuditLog(client, {
      actorId: auth.userId,
      userId,
      organizationId: primaryOrgId,
      action:
        action === "toggle_uploads"
          ? "admin.user.toggle_upload_restriction"
          : "admin.user.toggle_api_restriction",
      details:
        action === "toggle_uploads"
          ? `Superadmin ${disabled ? "disabled" : "enabled"} uploads`
          : `Superadmin ${disabled ? "restricted" : "unrestricted"} API access`,
      metadata: { disabled, reason },
    });
    return json({ ok: true });
  }

  return json({ error: "Unsupported admin action" }, 400);
}

async function handleUpsertPlan(req: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdminUser(req, env);
  if (auth instanceof Response) return auth;

  const body = (await req.json()) as {
    id?: string | null;
    code?: string;
    name: string;
    price_amount_inr: number;
    is_custom_price: boolean;
    interval: string;
    ai_token_limit: number | null;
    storage_limit_bytes: number | null;
    plan_type?: "subscription" | "pay_as_you_go";
  };

  if (!body.name?.trim()) return json({ error: "name is required" }, 400);

  const code = body.code?.trim() || body.name.trim().toLowerCase().replace(/\s+/g, "_");
  const client = db(env);

  const payload = {
    code,
    name: body.name.trim(),
    price_amount_inr: Number(body.price_amount_inr ?? 0),
    is_custom_price: Boolean(body.is_custom_price),
    interval: body.interval ?? "monthly",
    ai_token_limit: body.ai_token_limit ?? null,
    storage_limit_bytes: body.storage_limit_bytes ?? null,
    plan_type: body.plan_type ?? "subscription",
    status: "active" as const,
    version: "2.0",
    page_limit: null,
    ocr_limit: null,
    api_rate_limit: null,
    webhook_limit: null,
    concurrency: null,
    team_seats: null,
    white_label: false,
    dedicated_workers: false,
    priority_queue: false,
    sla_support: false,
    audit_logs: false,
    updated_at: new Date().toISOString(),
  };

  if (body.id) {
    const { data, error } = await client
      .from("plans")
      .update(payload)
      .eq("id", body.id)
      .select()
      .single();
    if (error) return json({ error: error.message }, 400);
    return json({ plan: data });
  }

  const { data, error } = await client
    .from("plans")
    .insert({ ...payload, sort_order: 0 })
    .select()
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ plan: data });
}

async function handleSaveAdminSettings(req: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdminUser(req, env);
  if (auth instanceof Response) return auth;

  const body = (await req.json()) as { key: string; value: unknown };
  if (!body.key?.trim()) return json({ error: "key is required" }, 400);

  const client = db(env);
  const { error } = await client.from("admin_settings").upsert(
    {
      key: body.key,
      value: body.value as never,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "key" },
  );
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function handleSaveRazorpayConfig(req: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdminUser(req, env);
  if (auth instanceof Response) return auth;

  const body = (await req.json()) as {
    key_id?: string;
    key_secret?: string;
    webhook_secret?: string;
    test_mode?: boolean;
    currency?: string;
  };

  const client = db(env);
  const { data: existing } = await client
    .from("admin_settings")
    .select("value")
    .eq("key", "razorpay_config")
    .maybeSingle();

  const current = (existing?.value ?? {}) as Record<string, unknown>;
  const merged = {
    key_id: body.key_id ?? current.key_id ?? "",
    key_secret: body.key_secret || current.key_secret || "",
    webhook_secret: body.webhook_secret || current.webhook_secret || "",
    test_mode: body.test_mode ?? current.test_mode ?? true,
    currency: body.currency || current.currency || "INR",
  };

  const { error } = await client.from("admin_settings").upsert(
    { key: "razorpay_config", value: merged, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: "key" },
  );
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function handleGrantCredits(req: Request, env: Env, orgId: string): Promise<Response> {
  const auth = await requireSuperAdminUser(req, env);
  if (auth instanceof Response) return auth;

  const body = (await req.json()) as { credits: number; note?: string };
  const credits = Math.floor(Number(body.credits ?? 0));
  if (!credits || credits <= 0) return json({ error: "credits must be a positive integer" }, 400);

  const client = db(env);

  const { data: org, error: fetchErr } = await client
    .from("organizations")
    .select("granted_credits")
    .eq("id", orgId)
    .maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 400);
  if (!org) return json({ error: "Organization not found" }, 404);

  const { error: updateErr } = await client
    .from("organizations")
    .update({
      granted_credits: (Number(org.granted_credits) || 0) + credits,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);
  if (updateErr) return json({ error: updateErr.message }, 400);

  await client.from("credit_grants").insert({
    organization_id: orgId,
    granted_by: auth.userId,
    grant_type: "credits",
    credits_granted: credits,
    note: body.note ?? null,
  });

  return json({ ok: true, credits_added: credits });
}

async function handleGrantStorage(req: Request, env: Env, orgId: string): Promise<Response> {
  const auth = await requireSuperAdminUser(req, env);
  if (auth instanceof Response) return auth;

  const body = (await req.json()) as { bytes: number; note?: string };
  const bytes = Math.floor(Number(body.bytes ?? 0));
  if (!bytes || bytes <= 0) return json({ error: "bytes must be a positive integer" }, 400);

  const client = db(env);

  const { data: org, error: fetchErr } = await client
    .from("organizations")
    .select("storage_limit_bytes")
    .eq("id", orgId)
    .maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 400);
  if (!org) return json({ error: "Organization not found" }, 404);

  const { error: updateErr } = await client
    .from("organizations")
    .update({
      storage_limit_bytes: (Number(org.storage_limit_bytes) || 0) + bytes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);
  if (updateErr) return json({ error: updateErr.message }, 400);

  await client.from("credit_grants").insert({
    organization_id: orgId,
    granted_by: auth.userId,
    grant_type: "storage",
    storage_bytes_granted: bytes,
    note: body.note ?? null,
  });

  return json({ ok: true, bytes_added: bytes });
}

async function handleSendEmailNotification(req: Request, env: Env): Promise<Response> {
  const forbidden = await requireSuperAdmin(req, env);
  if (forbidden) return forbidden;

  const body = (await req.json()) as {
    userIds: "all" | string[];
    subject: string;
    html: string;
  };

  if (!body.subject?.trim()) return json({ error: "Subject is required" }, 400);
  if (!body.html?.trim()) return json({ error: "Email body is required" }, 400);

  const client = db(env);

  let emails: string[] = [];
  if (body.userIds === "all") {
    const { data, error } = await client.from("profiles").select("email").not("email", "is", null);
    if (error) throw error;
    emails = (data ?? []).map((p: DbRow) => p.email as string).filter(Boolean);
  } else if (Array.isArray(body.userIds) && body.userIds.length > 0) {
    const { data, error } = await client
      .from("profiles")
      .select("email")
      .in("id", body.userIds)
      .not("email", "is", null);
    if (error) throw error;
    emails = (data ?? []).map((p: DbRow) => p.email as string).filter(Boolean);
  }

  if (emails.length === 0) return json({ error: "No valid recipient emails found" }, 400);

  let sent = 0;
  const errors: string[] = [];
  for (const email of emails) {
    try {
      await sendSmtpEmail(env, { to: email, subject: body.subject, html: body.html });
      sent++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  await client.from("notifications").insert({
    channel: "email",
    subject: body.subject,
    body: null,
    audience: body.userIds === "all" ? "all_users" : `${emails.length} selected`,
    status: sent > 0 ? "delivered" : "failed",
    recipients: sent,
    sent_at: new Date().toISOString(),
    metadata: { errors: errors.slice(0, 10) },
  });

  return json({ ok: true, sent, failed: errors.length, errors: errors.slice(0, 5) });
}

export async function handleAdminApi(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/admin")) return null;

  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    if (req.method === "GET" && url.pathname === "/api/admin/dashboard-kpis") {
      return await handleDashboardKpis(req, env);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/exdoc-health") {
      return await handleExDocHealth(req, env);
    }

    if (url.pathname === "/api/admin/plans" && req.method === "POST") {
      return await handleUpsertPlan(req, env);
    }

    if (url.pathname === "/api/admin/settings" && req.method === "POST") {
      return await handleSaveAdminSettings(req, env);
    }

    if (url.pathname === "/api/admin/notifications/send-email" && req.method === "POST") {
      return await handleSendEmailNotification(req, env);
    }

    if (url.pathname === "/api/admin/razorpay-config") {
      const forbidden = await requireSuperAdmin(req, env);
      if (forbidden) return forbidden;
      if (req.method === "GET") return await handleAdminRazorpayConfig(req, env);
      if (req.method === "POST") return await handleSaveRazorpayConfig(req, env);
    }

    const orgGrantPath = url.pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/(grant-credits|grant-storage)$/);
    if (orgGrantPath && req.method === "POST") {
      const orgId = decodeURIComponent(orgGrantPath[1]);
      const action = orgGrantPath[2];
      if (action === "grant-credits") return await handleGrantCredits(req, env, orgId);
      if (action === "grant-storage") return await handleGrantStorage(req, env, orgId);
    }

    if (url.pathname === "/api/admin/users" && req.method === "GET") {
      return await handleAdminUsersList(req, env);
    }

    const userPath = url.pathname.match(/^\/api\/admin\/users\/([^/]+)(?:\/([^/]+))?$/);
    if (userPath) {
      const userId = decodeURIComponent(userPath[1]);
      const child = userPath[2] ? decodeURIComponent(userPath[2]) : null;

      if (!child && req.method === "GET") return await handleAdminUserDetail(req, env, userId);
      if (child === "notes" && req.method === "POST") return await createAdminNote(req, env, userId);
      if (child === "actions" && req.method === "POST") {
        return await handleAdminUserAction(req, env, userId);
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("[admin api]", error);
    return json({ error: "Could not load admin data" }, 500);
  }
}
