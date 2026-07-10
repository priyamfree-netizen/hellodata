// ============================================================================
// HelloData — Supabase TypeScript types
// Hand-maintained to match the DB schema (self-hosted — no CLI sync available).
// Update this file manually whenever a migration changes table shapes or RPCs.
// ============================================================================

// ── Primitive helpers ────────────────────────────────────────────────────────

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// ── Enum aliases (mirror the PostgreSQL enum types) ──────────────────────────

export type PlanInterval = "monthly" | "yearly";
export type PlanStatus = "active" | "archived" | "draft";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused"
  | "expired";
export type TransactionStatus = "succeeded" | "failed" | "refunded" | "pending";
export type PaymentMethodType = "card" | "upi" | "wire" | "bank_transfer";
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";
export type UserStatus = "active" | "inactive" | "suspended" | "trial" | "churned";
export type OrgStatus = "active" | "suspended" | "trial";
export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type MemberStatus = "active" | "pending" | "inactive";
export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";
export type JobPriority = "low" | "normal" | "high" | "critical";
export type JobStage =
  | "pending"
  | "queued"
  | "ocr"
  | "ai_extraction"
  | "validation"
  | "export"
  | "completed"
  | "failed"
  | "retry"
  | "dead_letter";
export type ExtractionStatus = "queued" | "processing" | "done" | "failed" | "cancelled";
export type DocumentStatus = "uploaded" | "queued" | "processing" | "extracted" | "failed";
export type ExportFormat = "json" | "excel" | "csv" | "webhook";
export type TemplateStatus = "draft" | "review" | "published" | "rejected" | "archived";
export type TemplateScope = "org" | "team" | "public" | "draft" | "user";
export type CategoryTag = "core" | "tax" | "soon";
export type ApiKeyScope = "read_only" | "write" | "full_access";
export type VendorApiStatus = "healthy" | "degraded" | "down";
export type VendorApiType = "scraping" | "extraction" | "validation";
export type IntegrationStatus = "connected" | "disconnected" | "error" | "beta";
export type NotificationChannel = "email" | "sms" | "push" | "in_app";
export type NotificationStatus = "delivered" | "failed" | "scheduled" | "sending";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";
export type ContactSubmissionStatus = "new" | "contacted" | "archived";
export type FeatureFlagType = "release" | "experiment" | "ops" | "permission";
export type SecurityEventType =
  | "suspicious_login"
  | "api_abuse"
  | "brute_force"
  | "data_export"
  | "permission_change"
  | "2fa_disabled";
export type SecuritySeverity = "low" | "medium" | "high" | "critical";
export type WorkerStatus = "healthy" | "degraded" | "offline";
export type WorkerType = "shared" | "dedicated";

// ── Row interfaces ────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  avatar_initials: string | null;
  country: string | null;
  current_org_id: string | null;
  status: UserStatus;
  is_super_admin: boolean;
  risk_score: number;
  two_factor_enabled: boolean;
  two_factor_method: "totp" | "email" | null;
  credits_remaining: number;
  metadata: Json;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_activity_at: string | null;
  password_changed_at: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  status: OrgStatus;
  plan_id: string | null;
  sso_enabled: boolean;
  storage_limit_bytes: number;
  storage_used_bytes: number;
  pages_processed: number;
  team_size: number;
  departments: string[];
  metadata: Json;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  // Added by migration 202606290001_credit_storage_system
  purchased_credits: number;
  granted_credits: number;
  credits_used: number;
}

// Added by migration 202607020005_section_permissions
export type Section = "billing" | "support" | "history" | "process" | "templates" | "data_entries";
export type SectionLevel = "none" | "view" | "edit";

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  team: string | null;
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
  // Added by migration 202607020005_section_permissions
  section_access: Partial<Record<Section, SectionLevel>>;
}

// Added by migration 202607020003_org_management
export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  token_hash: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

// Shape returned by the my_pending_invitations() RPC
export interface MyPendingInvitation {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  email: string;
  role: MemberRole;
  invited_by_name: string | null;
  expires_at: string;
  created_at: string;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_amount_inr: number | null;
  is_custom_price: boolean;
  interval: PlanInterval;
  plan_type: "subscription" | "pay_as_you_go";
  status: PlanStatus;
  version: string;
  sort_order: number;
  page_limit: number | null;
  ai_token_limit: number | null;
  ocr_limit: number | null;
  storage_limit_bytes: number | null;
  api_rate_limit: number | null;
  webhook_limit: number | null;
  concurrency: number | null;
  team_seats: number | null;
  white_label: boolean;
  dedicated_workers: boolean;
  priority_queue: boolean;
  sla_support: boolean;
  audit_logs: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface RazorpayOrder {
  id: string;
  organization_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  order_type: "subscription" | "credits" | "storage";
  plan_id: string | null;
  credits_amount: number | null;
  storage_bytes: number | null;
  amount_paise: number;
  currency: string;
  status: "created" | "paid" | "failed";
  applied: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  external_ref: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface PaymentMethodRow {
  id: string;
  organization_id: string;
  type: PaymentMethodType;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  external_ref: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  plan_id: string | null;
  amount_inr: number;
  currency: string;
  status: TransactionStatus;
  method: PaymentMethodType | null;
  external_ref: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  number: string;
  organization_id: string;
  transaction_id: string | null;
  subscription_id: string | null;
  amount_inr: number;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  paid_at: string | null;
  pdf_url: string | null;
  line_items: Json;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface DocumentCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tag: CategoryTag;
  icon: string | null;
  default_fields: number;
  industry: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  organization_id: string | null;
  author_id: string | null;
  status: TemplateStatus;
  scope: TemplateScope;
  version: string;
  is_featured: boolean;
  rating: number;
  downloads: number;
  field_count: number;
  config: Json;
  created_at: string;
  updated_at: string;
}

export interface TemplateField {
  id: string;
  template_id: string;
  key: string;
  label: string;
  field_group: string;
  data_type: string;
  is_required: boolean;
  is_enabled: boolean;
  default_confidence: number;
  sort_order: number;
  config: Json;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  name: string;
  type: WorkerType;
  status: WorkerStatus;
  region: string;
  cpu_pct: number;
  memory_pct: number;
  jobs_processed: number;
  current_job_id: string | null;
  uptime_seconds: number;
  started_at: string | null;
  last_heartbeat: string;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  organization_id: string;
  uploaded_by: string | null;
  category_id: string | null;
  template_id: string | null;
  file_name: string;
  storage_path: string | null;
  mime_type: string | null;
  file_size_bytes: number;
  page_count: number;
  status: DocumentStatus;
  sha256: string | null;
  source: string;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface ProcessingJob {
  id: string;
  job_number: number;
  organization_id: string;
  document_id: string | null;
  template_id: string | null;
  created_by: string | null;
  name: string;
  stage: JobStage;
  priority: JobPriority;
  worker_id: string | null;
  total_pages: number;
  total_docs: number;
  completed_docs: number;
  failed_docs: number;
  attempts: number;
  confidence: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface Extraction {
  id: string;
  organization_id: string;
  document_id: string;
  job_id: string | null;
  template_id: string | null;
  status: ExtractionStatus;
  confidence: number | null;
  field_count: number;
  page_count: number;
  tokens_used: number;
  data: Json;
  raw_text: string | null;
  error_message: string | null;
  duration_ms: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  job_id: string | null;
  file_name: string;
  storage_path: string | null;
  format: ExportFormat;
  size_bytes: number;
  row_count: number;
  download_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  prefix: string;
  key_hash: string;
  scope: ApiKeyScope;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Integration {
  id: string;
  name: string;
  category: string;
  status: IntegrationStatus;
  icon: string | null;
  description: string | null;
  syncs_today: number;
  failed_syncs: number;
  connected_orgs: number;
  last_sync_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface FeatureFlag {
  id: string;
  name: string;
  description: string | null;
  type: FeatureFlagType;
  is_enabled: boolean;
  enabled_dev: boolean;
  enabled_staging: boolean;
  enabled_production: boolean;
  rollout_pct: number;
  owner_id: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  channel: NotificationChannel;
  subject: string;
  body: string | null;
  audience: string;
  status: NotificationStatus;
  recipients: number;
  open_rate_pct: number | null;
  click_rate_pct: number | null;
  sent_at: string | null;
  scheduled_for: string | null;
  created_by: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface SecurityEventRow {
  id: string;
  type: SecurityEventType;
  severity: SecuritySeverity;
  user_id: string | null;
  organization_id: string | null;
  ip_address: string | null;
  location: string | null;
  user_agent: string | null;
  details: string | null;
  is_resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  metadata: Json;
  created_at: string;
}

export interface TicketRow {
  id: string;
  number: number;
  organization_id: string | null;
  requester_id: string | null;
  assignee_id: string | null;
  subject: string;
  body: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  category: string | null;
  sla_deadline: string | null;
  last_reply_at: string | null;
  resolved_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface TicketReplyRow {
  id: string;
  ticket_id: string;
  author_id: string | null;
  is_internal: boolean;
  body: string;
  created_at: string;
}

export interface ContactSubmissionRow {
  id: string;
  name: string;
  phone: string;
  company: string | null;
  email: string;
  message: string;
  status: ContactSubmissionStatus;
  created_at: string;
  updated_at: string;
}

export interface UsageRecord {
  id: string;
  organization_id: string;
  date: string;
  pages_processed: number;
  ai_tokens_used: number;
  ocr_pages: number;
  api_calls: number;
  storage_bytes: number;
  documents_uploaded: number;
}

export interface MetricSnapshot {
  id: string;
  metric: string;
  value: number;
  taken_at: string;
  dims: Json;
}

export interface UserSessionRow {
  id: string;
  user_id: string;
  device: string | null;
  ip_address: string | null;
  location: string | null;
  user_agent: string | null;
  started_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface AuditLog {
  id: string;
  organization_id: string | null;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  ip_address: string | null;
  details: string | null;
  metadata: Json;
  created_at: string;
}

export interface AdminUserNote {
  id: string;
  user_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

// ── New tables (migration 202606290001_credit_storage_system) ─────────────────

export interface AdminSettings {
  key: string;
  value: Json;
  updated_at: string;
  updated_by: string | null;
}

export interface CreditGrant {
  id: string;
  organization_id: string;
  granted_by: string | null;
  grant_type: "credits" | "storage";
  credits_granted: number | null;
  storage_bytes_granted: number | null;
  note: string | null;
  created_at: string;
}

export interface OrgCreditSummary {
  organization_id: string;
  organization_name: string;
  plan_credits: number;
  purchased_credits: number;
  granted_credits: number;
  credits_used: number;
  credits_available: number;
  storage_limit_bytes: number;
  storage_used_bytes: number;
  storage_available_bytes: number;
}

// ── Function return types ─────────────────────────────────────────────────────

export interface DashboardKpis {
  users: number;
  orgs: number;
  enterprises: number;
  pages_today: number;
  queue_active: number;
  failed_today: number;
  webhooks_active: number;
}

// ── Database type (used to type the supabase-js client for RPC calls) ─────────

export interface Database {
  public: {
    Tables: {
      metric_snapshots: {
        Row: MetricSnapshot;
        Insert: Partial<MetricSnapshot>;
        Update: Partial<MetricSnapshot>;
      };
      admin_settings: {
        Row: AdminSettings;
        Insert: Partial<AdminSettings>;
        Update: Partial<AdminSettings>;
      };
      credit_grants: {
        Row: CreditGrant;
        Insert: Partial<CreditGrant>;
        Update: Partial<CreditGrant>;
      };
      organization_invitations: {
        Row: OrganizationInvitation;
        Insert: Partial<OrganizationInvitation>;
        Update: Partial<OrganizationInvitation>;
      };
    };
    Functions: {
      create_first_organization: {
        Args: { p_name: string; p_slug: string };
        Returns: Organization;
      };
      create_organization: {
        Args: { p_name: string; p_slug: string };
        Returns: Organization;
      };
      transfer_org_ownership: {
        Args: { p_org: string; p_new_owner_user: string };
        Returns: void;
      };
      delete_organization: {
        Args: { p_org: string };
        Returns: void;
      };
      my_pending_invitations: {
        Args: Record<PropertyKey, never>;
        Returns: MyPendingInvitation[];
      };
      dashboard_kpis: {
        Args: Record<PropertyKey, never>;
        Returns: DashboardKpis;
      };
      add_org_credits: {
        Args: { p_org_id: string; p_credits: number };
        Returns: void;
      };
      add_org_storage: {
        Args: { p_org_id: string; p_bytes: number };
        Returns: void;
      };
      admin_upsert_plan: {
        Args: {
          p_id: string | null;
          p_code: string;
          p_name: string;
          p_price_amount_inr: number;
          p_is_custom_price: boolean;
          p_interval: string;
          p_ai_token_limit: number | null;
          p_storage_limit_bytes: number | null;
        };
        Returns: Plan;
      };
      deduct_org_credits: {
        Args: { p_org_id: string; p_credits: number };
        Returns: boolean;
      };
      save_admin_settings: {
        Args: { p_key: string; p_value: Json };
        Returns: void;
      };
      reset_org_credits_used: {
        Args: { p_org_id: string };
        Returns: void;
      };
    };
  };
}
