/**
 * Admin display adapters
 * -----------------------------------------------------------------------------
 * This module used to generate mock data. It now serves a single purpose:
 *
 *   1. Re-export the *display* TypeScript shapes that the existing admin UI
 *      already imports from "@/lib/admin-data".
 *   2. Provide adapter functions that map a database row (from `@/lib/queries`)
 *      into the legacy display shape — so the routes don't have to be rewritten
 *      from scratch.
 *
 * All `generate*()` functions that previously fabricated data are gone. If you
 * see one referenced anywhere, replace it with the matching hook from
 * `@/lib/queries`.
 */

import { formatBytes, formatRelativeTime } from "@/lib/format";
import type {
  ApiKeyRow,
  AuditLog,
  DocumentCategory as DbDocumentCategory,
  FeatureFlag as DbFeatureFlag,
  Integration as DbIntegration,
  Invoice as DbInvoice,
  Notification as DbNotification,
  Organization as DbOrganization,
  Plan as DbPlan,
  ProcessingJob as DbProcessingJob,
  Profile,
  SecurityEventRow as DbSecurityEventRow,
  Template as DbTemplate,
  TicketRow as DbTicket,
  Transaction as DbTransaction,
  Worker as DbWorker,
} from "@/lib/supabase/types";

// ── Re-exports the UI references ────────────────────────────────────────────
export type { Plan } from "@/lib/supabase/types";

// ── Legacy display shapes (what existing admin pages already render) ────────
export interface KPI {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "flat";
  sparkline: number[];
}

export interface AdminUser {
  [k: string]: unknown;
  id: string;
  name: string;
  company: string;
  workspace: string;
  email: string;
  phone: string;
  plan: string;
  status: "active" | "inactive" | "suspended" | "trial" | "churned";
  country: string;
  storageUsed: string;
  creditsRemaining: number;
  pagesProcessed: number;
  aiUsage: string;
  apiUsage: string;
  teamSize: number;
  lastLogin: string;
  lastActivity: string;
  deviceCount: number;
  createdDate: string;
  riskScore: number;
  avatar: string;
}

export interface Organization {
  id: string;
  name: string;
  plan: string;
  members: number;
  teams: number;
  status: "active" | "suspended" | "trial";
  ssoEnabled: boolean;
  storageUsed: string;
  storageLimit: string;
  pagesProcessed: number;
  country: string;
  createdDate: string;
  lastActivity: string;
  departments: string[];
}

export type QueueStage = DbProcessingJob["stage"];

export interface QueueJob {
  id: string;
  documentName: string;
  organization: string;
  stage: QueueStage;
  priority: "low" | "normal" | "high" | "critical";
  worker: string | null;
  pages: number;
  startedAt: string;
  duration: string;
  attempts: number;
  template: string;
  confidence: number;
  errorMessage?: string;
}

export interface Transaction {
  id: string;
  organization: string;
  amount: string;
  currency: string;
  status: "succeeded" | "failed" | "refunded" | "pending";
  method: "card" | "upi" | "wire" | "bank_transfer";
  plan: string;
  date: string;
  invoiceId: string;
}

export interface Template {
  id: string;
  name: string;
  category: string;
  author: string;
  status: "published" | "review" | "draft" | "rejected";
  downloads: number;
  rating: number;
  fields: number;
  version: string;
  createdDate: string;
  lastUpdated: string;
}

export interface Ticket {
  id: string;
  subject: string;
  organization: string;
  requester: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
  category: string;
  slaDeadline: string;
  createdDate: string;
  lastReply: string;
  assignee: string;
}

export interface SecurityEvent {
  id: string;
  type: "suspicious_login" | "api_abuse" | "brute_force" | "data_export" | "permission_change" | "2fa_disabled";
  severity: "low" | "medium" | "high" | "critical";
  user: string;
  ip: string;
  location: string;
  timestamp: string;
  details: string;
  resolved: boolean;
}

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  environments: { dev: boolean; staging: boolean; production: boolean };
  rolloutPercentage: number;
  createdDate: string;
  lastModified: string;
  owner: string;
  type: "release" | "experiment" | "ops" | "permission";
}

export interface Integration {
  id: string;
  name: string;
  category: string;
  status: "connected" | "disconnected" | "error" | "beta";
  lastSync: string;
  syncsToday: number;
  failedSyncs: number;
  connectedOrgs: number;
  icon: string;
}

export interface NotificationLog {
  id: string;
  channel: "email" | "sms" | "push" | "in_app";
  subject: string;
  audience: string;
  status: "delivered" | "failed" | "scheduled" | "sending";
  sentAt: string;
  recipients: number;
  openRate?: string;
  clickRate?: string;
}

export interface Worker {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "offline";
  cpu: number;
  memory: number;
  jobsProcessed: number;
  currentJob: string | null;
  uptime: string;
  region: string;
  type: "shared" | "dedicated";
}

export interface AuditLogShape {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  ip: string;
  details: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Adapters: DB row → legacy display shape
// ────────────────────────────────────────────────────────────────────────────

export function adaptUser(
  p: Profile,
  ctx: { org?: DbOrganization | null; plan?: DbPlan | null; lastActivity?: string | null; deviceCount?: number; pagesProcessed?: number },
): AdminUser {
  return {
    id: p.id,
    name: p.full_name ?? p.email,
    company: ctx.org?.name ?? "—",
    workspace: ctx.org?.slug ?? "",
    email: p.email,
    phone: p.phone ?? "",
    plan: ctx.plan?.name ?? "Free",
    status: p.status,
    country: p.country ?? "—",
    storageUsed: formatBytes(ctx.org?.storage_used_bytes ?? 0),
    creditsRemaining: p.credits_remaining,
    pagesProcessed: ctx.pagesProcessed ?? 0,
    aiUsage: "—",
    apiUsage: "—",
    teamSize: ctx.org?.team_size ?? 1,
    lastLogin: p.last_login_at ?? p.created_at,
    lastActivity: p.last_activity_at ?? p.updated_at,
    deviceCount: ctx.deviceCount ?? 0,
    createdDate: p.created_at,
    riskScore: p.risk_score,
    avatar: (p.avatar_initials ?? (p.email[0]?.toUpperCase() ?? "?")).slice(0, 2),
  };
}

export function adaptOrganization(o: DbOrganization, ctx: { plan?: DbPlan | null; members?: number }): Organization {
  return {
    id: o.id,
    name: o.name,
    plan: ctx.plan?.name ?? "Free",
    members: ctx.members ?? o.team_size ?? 0,
    teams: o.departments.length,
    status: o.status,
    ssoEnabled: o.sso_enabled,
    storageUsed: formatBytes(o.storage_used_bytes),
    storageLimit: formatBytes(o.storage_limit_bytes),
    pagesProcessed: o.pages_processed,
    country: o.country ?? "—",
    createdDate: o.created_at,
    lastActivity: o.last_activity_at ?? o.updated_at,
    departments: o.departments,
  };
}

export function adaptQueueJob(j: DbProcessingJob, ctx: { docName?: string; orgName?: string; templateName?: string; workerName?: string | null }): QueueJob {
  return {
    id: `JOB-${j.job_number.toString().padStart(5, "0")}`,
    documentName: ctx.docName ?? j.name,
    organization: ctx.orgName ?? "—",
    stage: j.stage,
    priority: j.priority,
    worker: ctx.workerName ?? null,
    pages: j.total_pages,
    startedAt: j.started_at ?? j.created_at,
    duration: j.duration_ms ? `${(j.duration_ms / 1000).toFixed(1)}s` : j.stage === "pending" ? "—" : "—",
    attempts: j.attempts,
    template: ctx.templateName ?? "—",
    confidence: Number(j.confidence ?? 0),
    errorMessage: j.error_message ?? undefined,
  };
}

export function adaptTransaction(
  t: DbTransaction,
  ctx: { orgName?: string; planName?: string; invoiceNumber?: string },
): Transaction {
  return {
    id: t.id,
    organization: ctx.orgName ?? "—",
    amount: `₹${Number(t.amount_inr).toLocaleString("en-IN")}`,
    currency: t.currency,
    status: t.status,
    method: t.method ?? "card",
    plan: ctx.planName ?? "—",
    date: t.created_at,
    invoiceId: ctx.invoiceNumber ?? "",
  };
}

export function adaptTemplate(t: DbTemplate, ctx: { categoryName?: string; authorName?: string }): Template {
  return {
    id: t.id,
    name: t.name,
    category: ctx.categoryName ?? "—",
    author: ctx.authorName ?? "HelloData",
    status: t.status === "archived" ? "draft" : t.status,
    downloads: t.downloads,
    rating: Number(t.rating),
    fields: t.field_count,
    version: t.version,
    createdDate: t.created_at,
    lastUpdated: t.updated_at,
  };
}

export function adaptTicket(t: DbTicket, ctx: { orgName?: string; requesterName?: string; assigneeName?: string }): Ticket {
  return {
    id: `TKT-${t.number.toString().padStart(5, "0")}`,
    subject: t.subject,
    organization: ctx.orgName ?? "—",
    requester: ctx.requesterName ?? "—",
    priority: t.priority,
    status: t.status,
    category: t.category ?? "Technical",
    slaDeadline: t.sla_deadline ?? "",
    createdDate: t.created_at,
    lastReply: t.last_reply_at ?? t.updated_at,
    assignee: ctx.assigneeName ?? "Unassigned",
  };
}

export function adaptSecurityEvent(e: DbSecurityEventRow, ctx: { userName?: string }): SecurityEvent {
  return {
    id: e.id,
    type: e.type,
    severity: e.severity,
    user: ctx.userName ?? "—",
    ip: e.ip_address ?? "",
    location: e.location ?? "—",
    timestamp: e.created_at,
    details: e.details ?? "",
    resolved: e.is_resolved,
  };
}

export function adaptFeatureFlag(f: DbFeatureFlag, ctx: { ownerName?: string }): FeatureFlag {
  return {
    id: f.id,
    name: f.name,
    description: f.description ?? "",
    enabled: f.is_enabled,
    environments: {
      dev: f.enabled_dev,
      staging: f.enabled_staging,
      production: f.enabled_production,
    },
    rolloutPercentage: f.rollout_pct,
    createdDate: f.created_at,
    lastModified: f.updated_at,
    owner: ctx.ownerName ?? "—",
    type: f.type,
  };
}

export function adaptIntegration(i: DbIntegration): Integration {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    status: i.status,
    lastSync: i.last_sync_at ?? "—",
    syncsToday: i.syncs_today,
    failedSyncs: i.failed_syncs,
    connectedOrgs: i.connected_orgs,
    icon: i.icon ?? i.name.slice(0, 2).toUpperCase(),
  };
}

export function adaptNotification(n: DbNotification): NotificationLog {
  return {
    id: n.id,
    channel: n.channel,
    subject: n.subject,
    audience: n.audience,
    status: n.status,
    sentAt: n.sent_at ?? n.created_at,
    recipients: n.recipients,
    openRate: n.open_rate_pct != null ? `${Number(n.open_rate_pct).toFixed(0)}%` : undefined,
    clickRate: n.click_rate_pct != null ? `${Number(n.click_rate_pct).toFixed(0)}%` : undefined,
  };
}

export function adaptWorker(w: DbWorker, ctx?: { currentJobName?: string | null }): Worker {
  return {
    id: w.id,
    name: w.name,
    status: w.status,
    cpu: w.cpu_pct,
    memory: w.memory_pct,
    jobsProcessed: w.jobs_processed,
    currentJob: ctx?.currentJobName ?? null,
    uptime: w.uptime_seconds
      ? `${Math.floor(w.uptime_seconds / 86400)}d ${Math.floor((w.uptime_seconds % 86400) / 3600)}h`
      : "—",
    region: w.region,
    type: w.type,
  };
}

export function adaptAuditLog(a: AuditLog): AuditLogShape {
  return {
    id: a.id,
    action: a.action,
    actor: a.actor_label ?? "—",
    target: a.target_label ?? a.target_type ?? "—",
    timestamp: a.created_at,
    ip: a.ip_address ?? "—",
    details: a.details ?? "",
  };
}

export function adaptInvoice(inv: DbInvoice): { id: string; date: string; amount: string; status: string } {
  return {
    id: inv.number,
    date: new Date(inv.issue_date).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }),
    amount: `₹${Number(inv.amount_inr).toLocaleString("en-IN")}`,
    status: inv.status === "paid" ? "Paid" : inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
  };
}

export function adaptApiKey(k: ApiKeyRow): { id: string; name: string; key: string; created: string; lastUsed: string; scope: string } {
  return {
    id: k.id,
    name: k.name,
    key: `${k.prefix}•••••••••••`,
    created: new Date(k.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    lastUsed: k.last_used_at ? formatRelativeTime(k.last_used_at) : "Never",
    scope:
      k.scope === "full_access" ? "Full access" :
      k.scope === "write" ? "Write" : "Read only",
  };
}

export function adaptCategory(c: DbDocumentCategory): { code: string; name: string; desc: string; tag: "Core" | "Tax" | "Soon"; fields: number; icon: string } {
  return {
    code: c.code,
    name: c.name,
    desc: c.description ?? "",
    tag: c.tag === "core" ? "Core" : c.tag === "tax" ? "Tax" : "Soon",
    fields: c.default_fields,
    icon: c.icon ?? "FileText",
  };
}

// ── Empty-state helpers so visualization components that still call these
//    don't crash. They no longer fabricate data; they just produce a zero-line
//    until you backfill `metric_snapshots`. Accept the legacy 3-arg signature
//    for source compatibility, but ignore the min/max bounds. ──────────────
export function generateSparkline(points = 20, _min?: number, _max?: number): number[] {
  void _min; void _max;
  return Array.from({ length: points }, () => 0);
}

/** Maps a `metric_snapshots` rowset into a plain number[] for the spark chart. */
export function snapshotsToSparkline(snapshots: { value: number }[]): number[] {
  return snapshots.map((s) => Number(s.value));
}
