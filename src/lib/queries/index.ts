/**
 * HelloData data layer
 * -------------------
 * One hook per domain. Every hook is built on TanStack Query and the typed
 * Supabase client; nothing in `src/routes/**` should ever touch supabase
 * directly. This file is the only seam between the frontend and the database.
 *
 * The names mirror the mock generators they replaced in `lib/admin-data.ts`
 * so the UI can be migrated mechanically (e.g. `generateUsers()` → `useUsers()`).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { getAccessToken, getTokenPayload, silentRefresh } from "@/lib/auth/client";
import type {
  AdminSettings,
  ApiKeyRow,
  AuditLog,
  AdminUserNote,
  ContactSubmissionRow,
  ContactSubmissionStatus,
  CreditGrant,
  DocumentCategory,
  DocumentRow,
  Extraction,
  ExportRow,
  FeatureFlag,
  Integration,
  Invoice,
  Json,
  MemberRole,
  MetricSnapshot,
  MyPendingInvitation,
  Notification,
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  PaymentMethodRow,
  Plan,
  ProcessingJob,
  Profile,
  SecurityEventRow,
  Section,
  SectionLevel,
  Subscription,
  Template,
  TemplateField,
  TicketPriority,
  TicketReplyRow,
  TicketRow,
  Transaction,
  UsageRecord,
  UserSessionRow,
  Worker,
} from "@/lib/supabase/types";

// =============================================================================
// Plans
// =============================================================================
export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("status", "active")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });
}

// =============================================================================
// Organizations
// =============================================================================
export function useOrganization(orgId: string | null | undefined) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["organization", orgId],
    queryFn: async (): Promise<Organization | null> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", orgId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Organization) ?? null;
    },
  });
}

export function useOrganizations(opts?: { limit?: number }) {
  return useQuery({
    queryKey: ["organizations", "list", opts?.limit ?? 50],
    queryFn: async (): Promise<Organization[]> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(opts?.limit ?? 50);
      if (error) throw error;
      return (data ?? []) as Organization[];
    },
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Organization> }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Organization;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["organization", vars.id] });
      qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    // Uses the SECURITY DEFINER RPC that atomically creates the org, the owner
    // membership, and the profile.current_org_id pointer in a single transaction.
    // This replaces the previous 3-step client-side flow that was vulnerable to
    // CRIT-2 (any user could join any org as owner) and could leave orphaned orgs
    // if the connection dropped between the first and second INSERT.
    mutationFn: async (input: { name: string }) => {
      const slug = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);

      const { data, error } = await supabase.rpc("create_first_organization", {
        p_name: input.name.trim(),
        p_slug: slug || "org",
      });
      if (error) throw error;
      return data as Organization;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

// =============================================================================
// Members
// =============================================================================
export type MemberWithProfile = OrganizationMember & { profile: Profile | null };

export function useOrgMembers(orgId: string | null | undefined) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["org-members", orgId],
    queryFn: async (): Promise<MemberWithProfile[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("*, profile:profiles!organization_members_user_id_fkey(*)")
        .eq("organization_id", orgId!)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MemberWithProfile[];
    },
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    // RLS + the protect_org_members DB trigger enforce the role hierarchy
    // (only owners touch owner rows, admins can't modify admins, last owner
    // can never be demoted) — errors surface as their guard codes.
    mutationFn: async (input: { memberId: string; organizationId: string; role: MemberRole }) => {
      const { data, error } = await supabase
        .from("organization_members")
        .update({ role: input.role })
        .eq("id", input.memberId)
        .select()
        .single();
      if (error) throw error;
      return data as OrganizationMember;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["org-members", vars.organizationId] }),
  });
}

export function useUpdateMemberSectionAccess() {
  const qc = useQueryClient();
  return useMutation({
    // Same authorization path as useUpdateMemberRole: RLS restricts this
    // update to org admins/owners, and protect_org_members_trigger blocks
    // non-owners from touching an owner's row and admins from touching other
    // admins' rows -- both apply generically to any column on this table.
    mutationFn: async (input: {
      memberId: string;
      organizationId: string;
      section: Section;
      level: SectionLevel;
      currentAccess: Partial<Record<Section, SectionLevel>>;
    }) => {
      const nextAccess = { ...input.currentAccess, [input.section]: input.level };
      const { data, error } = await supabase
        .from("organization_members")
        .update({ section_access: nextAccess })
        .eq("id", input.memberId)
        .select()
        .single();
      if (error) throw error;
      return data as OrganizationMember;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["org-members", vars.organizationId] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; organizationId: string }) => {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("id", input.memberId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["org-members", vars.organizationId] }),
  });
}

export function useLeaveOrganization() {
  const qc = useQueryClient();
  return useMutation({
    // Self-delete is allowed by RLS; the DB trigger still blocks the last owner.
    mutationFn: async (input: { organizationId: string; userId: string }) => {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", input.organizationId)
        .eq("user_id", input.userId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["org-members", vars.organizationId] });
      qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { organizationId: string; newOwnerUserId: string }) => {
      const { error } = await supabase.rpc("transfer_org_ownership", {
        p_org: input.organizationId,
        p_new_owner_user: input.newOwnerUserId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["org-members", vars.organizationId] }),
  });
}

export function useCreateAnotherOrganization() {
  const qc = useQueryClient();
  return useMutation({
    // Unlike create_first_organization this RPC has no "already has an org"
    // guard, so existing users can open additional workspaces (capped at 20).
    mutationFn: async (input: { name: string }) => {
      const slug = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      const { data, error } = await supabase.rpc("create_organization", {
        p_name: input.name.trim(),
        p_slug: slug || "org",
      });
      if (error) throw error;
      return data as Organization;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { organizationId: string }) => {
      const { error } = await supabase.rpc("delete_organization", {
        p_org: input.organizationId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

// =============================================================================
// Organization invitations
// =============================================================================
async function fetchOrgsJson<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getAccessToken();
  if (!token) {
    await silentRefresh();
    token = getAccessToken();
  }
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "The request failed. Please try again.");
  return data;
}

export interface SendInviteResponse {
  invitation: Pick<
    OrganizationInvitation,
    "id" | "organization_id" | "email" | "role" | "status" | "expires_at" | "created_at"
  >;
  emailSent: boolean;
}

export interface AcceptInviteResponse {
  organization: { id: string; name: string; slug: string };
  alreadyMember: boolean;
}

/** Pending invitations of one org — visible to owners/admins via RLS. */
export function useOrgInvitations(orgId: string | null | undefined, enabled = true) {
  return useQuery({
    enabled: !!orgId && enabled,
    queryKey: ["org-invitations", orgId],
    queryFn: async (): Promise<OrganizationInvitation[]> => {
      const { data, error } = await supabase
        .from("organization_invitations")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OrganizationInvitation[];
    },
  });
}

/** Invitations addressed to the signed-in user's email (any org). */
export function useMyInvitations(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["my-invitations"],
    queryFn: async (): Promise<MyPendingInvitation[]> => {
      const { data, error } = await supabase.rpc("my_pending_invitations");
      if (error) throw error;
      return (data ?? []) as MyPendingInvitation[];
    },
  });
}

export function useSendOrgInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      email: string;
      role: Exclude<MemberRole, "owner">;
    }): Promise<SendInviteResponse> =>
      fetchOrgsJson("/api/orgs/invitations", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["org-invitations", vars.organizationId] }),
  });
}

export function useResendOrgInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      invitationId: string;
      organizationId: string;
    }): Promise<SendInviteResponse> =>
      fetchOrgsJson("/api/orgs/invitations/resend", {
        method: "POST",
        body: JSON.stringify({ invitationId: input.invitationId }),
      }),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["org-invitations", vars.organizationId] }),
  });
}

export function useRevokeOrgInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invitationId: string; organizationId: string }) => {
      const { error } = await supabase
        .from("organization_invitations")
        .update({ status: "revoked" })
        .eq("id", input.invitationId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["org-invitations", vars.organizationId] }),
  });
}

export function useAcceptOrgInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      invitationId?: string;
      token?: string;
    }): Promise<AcceptInviteResponse> =>
      fetchOrgsJson("/api/orgs/invitations/accept", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
      qc.invalidateQueries({ queryKey: ["organizations"] });
      qc.invalidateQueries({ queryKey: ["org-members", data.organization.id] });
    },
  });
}

export function useDeclineOrgInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invitationId: string }) =>
      fetchOrgsJson<{ declined: boolean }>("/api/orgs/invitations/decline", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-invitations"] }),
  });
}

// =============================================================================
// Users (super admin view)
// =============================================================================
export function useUsers(opts?: { limit?: number; search?: string; cursor?: string }) {
  return useQuery({
    queryKey: ["users", opts?.limit ?? 50, opts?.search ?? "", opts?.cursor ?? ""],
    queryFn: async (): Promise<{ rows: Profile[]; nextCursor: string | null }> => {
      let q = supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (opts?.search) {
        const s = `%${opts.search}%`;
        q = q.or(`email.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`);
      }
      if (opts?.cursor) q = q.lt("created_at", opts.cursor);
      const limit = opts?.limit ?? 50;
      const { data, error } = await q.limit(limit + 1);
      if (error) throw error;
      const rows = (data ?? []) as Profile[];
      const hasMore = rows.length > limit;
      return {
        rows: hasMore ? rows.slice(0, limit) : rows,
        nextCursor: hasMore ? rows[limit - 1].created_at : null,
      };
    },
  });
}

export interface AdminUserRestrictionDto {
  uploadsDisabled: boolean;
  apiRestricted: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface AdminUserPrimaryOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface AdminUserListRow {
  [key: string]: unknown;
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  country: string | null;
  avatar: string;
  avatarUrl: string | null;
  primaryOrg: AdminUserPrimaryOrg | null;
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

export type AdminUserNoteWithAuthor = AdminUserNote & {
  author?: {
    id: string;
    email: string | null;
    full_name: string | null;
    avatar_initials: string | null;
  } | null;
};

export interface AdminUserDetail extends AdminUserListRow {
  profile: Profile;
  memberships: (OrganizationMember & { organization?: Organization | null })[];
  usage30d: UsageRecord[];
  transactions: Transaction[];
  apiKeys: ApiKeyRow[];
  auditLogs: AuditLog[];
  securityEvents: SecurityEventRow[];
  sessions: UserSessionRow[];
  notes: AdminUserNoteWithAuthor[];
}

async function fetchAdminJson<T>(path: string, init?: RequestInit): Promise<T> {
  // If there is no in-memory token (e.g. after a page reload), try a silent
  // refresh via the HttpOnly cookie before making the request.
  // silentRefresh is deduplicated, so concurrent calls (AuthProvider bootstrap
  // + TanStack Query) share the same in-flight promise and won't race on the
  // one-time-use refresh cookie.
  let token = getAccessToken();
  if (!token) {
    await silentRefresh();
    token = getAccessToken();
  }

  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not load admin data");
  return data;
}

export function useAdminUsers(opts?: { limit?: number; search?: string; cursor?: string }) {
  return useQuery({
    queryKey: ["admin-users", opts?.limit ?? 100, opts?.search ?? "", opts?.cursor ?? ""],
    queryFn: async (): Promise<{ rows: AdminUserListRow[]; nextCursor: string | null }> => {
      const params = new URLSearchParams();
      params.set("limit", String(opts?.limit ?? 100));
      if (opts?.search) params.set("search", opts.search);
      if (opts?.cursor) params.set("cursor", opts.cursor);
      return fetchAdminJson(`/api/admin/users?${params.toString()}`);
    },
  });
}

export function useAdminUserDetail(userId: string | null | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["admin-user-detail", userId],
    queryFn: async (): Promise<AdminUserDetail> =>
      fetchAdminJson(`/api/admin/users/${encodeURIComponent(userId!)}`),
  });
}

export function useCreateAdminUserNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, body }: { userId: string; body: string }) => {
      const data = await fetchAdminJson<{ note: AdminUserNoteWithAuthor }>(
        `/api/admin/users/${encodeURIComponent(userId)}/notes`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      return data.note;
    },
    onSuccess: (_note, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-user-detail", vars.userId] });
    },
  });
}

export type AdminUserActionInput =
  | { userId: string; action: "suspend" | "unsuspend" }
  | { userId: string; action: "add_credits"; credits: number }
  | { userId: string; action: "toggle_uploads"; disabled: boolean; reason?: string }
  | { userId: string; action: "toggle_api"; restricted: boolean; reason?: string };

export function useAdminUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdminUserActionInput) => {
      const { userId, ...body } = input;
      return fetchAdminJson<{ ok: boolean }>(
        `/api/admin/users/${encodeURIComponent(userId)}/actions`,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-user-detail", vars.userId] });
    },
  });
}

export function useProfile(userId: string | null | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["profile", userId],
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Profile) ?? null;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Profile> }) => {
      const { data, error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Profile;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["profile", v.id] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

// =============================================================================
// Categories & Templates
// =============================================================================
export function useDocumentCategories() {
  return useQuery({
    queryKey: ["document-categories"],
    queryFn: async (): Promise<DocumentCategory[]> => {
      const { data, error } = await supabase
        .from("document_categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DocumentCategory[];
    },
  });
}

export function useTemplatesByCategory(categoryId: string | null | undefined) {
  return useQuery({
    enabled: !!categoryId,
    queryKey: ["templates-by-category", categoryId],
    queryFn: async (): Promise<(Template & { fields: TemplateField[] })[]> => {
      const { data: templates, error: tErr } = await supabase
        .from("templates")
        .select("*")
        .eq("category_id", categoryId!)
        .order("downloads", { ascending: false });
      if (tErr) throw tErr;
      if (!templates?.length) return [];

      const ids = templates.map((t) => t.id);
      const { data: fields, error: fErr } = await supabase
        .from("template_fields")
        .select("*")
        .in("template_id", ids)
        .order("sort_order");
      if (fErr) throw fErr;

      const fieldsByTemplate: Record<string, TemplateField[]> = {};
      for (const f of fields ?? []) {
        if (!fieldsByTemplate[f.template_id]) fieldsByTemplate[f.template_id] = [];
        fieldsByTemplate[f.template_id].push(f as TemplateField);
      }

      return (templates as Template[]).map((t) => ({
        ...t,
        fields: fieldsByTemplate[t.id] ?? [],
      }));
    },
  });
}

export function useTemplates(opts?: {
  orgId?: string | null;
  authorId?: string | null;
  scope?: Template["scope"];
}) {
  return useQuery({
    queryKey: ["templates", opts?.orgId ?? "all", opts?.authorId ?? "all", opts?.scope ?? "all"],
    queryFn: async (): Promise<Template[]> => {
      let q = supabase.from("templates").select("*").order("downloads", { ascending: false });
      if (opts?.scope) {
        q = q.eq("scope", opts.scope);
      } else if (opts?.orgId || opts?.authorId) {
        const filters = ["scope.eq.public"];
        if (opts.orgId) filters.push(`organization_id.eq.${opts.orgId}`);
        if (opts.authorId) filters.push(`author_id.eq.${opts.authorId}`);
        q = q.or(filters.join(","));
      } else {
        // No org context — show only public templates
        q = q.eq("scope", "public");
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });
}

export function useCloneTemplateForUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { templateId: string; authorId: string }) => {
      const { data: existing, error: existingErr } = await supabase
        .from("templates")
        .select("*")
        .eq("source_template_id", input.templateId)
        .eq("author_id", input.authorId)
        .eq("scope", "user")
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (existing) return existing as Template;

      const [{ data: source, error: sourceErr }, { data: fields, error: fieldsErr }] =
        await Promise.all([
          supabase.from("templates").select("*").eq("id", input.templateId).maybeSingle(),
          supabase
            .from("template_fields")
            .select("*")
            .eq("template_id", input.templateId)
            .order("sort_order"),
        ]);
      if (sourceErr) throw sourceErr;
      if (fieldsErr) throw fieldsErr;
      if (!source) throw new Error("Template not found");

      const sourceTemplate = source as Template;
      if (sourceTemplate.scope !== "public" || sourceTemplate.organization_id !== null) {
        return sourceTemplate;
      }

      const { data: cloned, error: cloneErr } = await supabase
        .from("templates")
        .insert({
          name: `${sourceTemplate.name} Copy`,
          description: sourceTemplate.description,
          category_id: sourceTemplate.category_id,
          organization_id: null,
          author_id: input.authorId,
          source_template_id: sourceTemplate.id,
          status: "draft",
          scope: "user",
          version: sourceTemplate.version,
          is_featured: false,
          rating: 0,
          downloads: 0,
          field_count: fields?.length ?? 0,
          config: sourceTemplate.config ?? {},
        })
        .select()
        .single();

      if (cloneErr) {
        if (cloneErr.code === "23505") {
          const { data: raced, error: racedErr } = await supabase
            .from("templates")
            .select("*")
            .eq("source_template_id", input.templateId)
            .eq("author_id", input.authorId)
            .eq("scope", "user")
            .single();
          if (racedErr) throw racedErr;
          return raced as Template;
        }
        throw cloneErr;
      }

      const newTemplate = cloned as Template;
      const copiedFields = (fields ?? []).map((field) => {
        const f = field as TemplateField;
        return {
          template_id: newTemplate.id,
          key: f.key,
          label: f.label,
          field_group: f.field_group,
          data_type: f.data_type,
          is_required: f.is_required,
          is_enabled: f.is_enabled,
          default_confidence: f.default_confidence,
          sort_order: f.sort_order,
          config: f.config ?? {},
        };
      });

      if (copiedFields.length > 0) {
        const { error: copyErr } = await supabase.from("template_fields").insert(copiedFields);
        if (copyErr) throw copyErr;
      }

      return newTemplate;
    },
    onSuccess: (template) => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["template", template.id] });
    },
  });
}

export function useTemplate(templateId: string | null | undefined) {
  return useQuery({
    enabled: !!templateId,
    queryKey: ["template", templateId],
    queryFn: async (): Promise<{ template: Template | null; fields: TemplateField[] }> => {
      const [{ data: template, error: tErr }, { data: fields, error: fErr }] = await Promise.all([
        supabase.from("templates").select("*").eq("id", templateId!).maybeSingle(),
        supabase
          .from("template_fields")
          .select("*")
          .eq("template_id", templateId!)
          .order("sort_order"),
      ]);
      if (tErr) throw tErr;
      if (fErr) throw fErr;
      return {
        template: (template as Template) ?? null,
        fields: (fields ?? []) as TemplateField[],
      };
    },
  });
}

export async function getTemplateFieldByKey(
  templateId: string,
  key: string,
): Promise<TemplateField | null> {
  const { data, error } = await supabase
    .from("template_fields")
    .select("*")
    .eq("template_id", templateId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return (data as TemplateField) ?? null;
}

export function useUpsertTemplateField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TemplateField> & { template_id: string; id?: string }) => {
      if (patch.id) {
        // Existing field — use UPDATE so only the changed columns are written
        const { id, template_id, ...rest } = patch;
        const { data, error } = await supabase
          .from("template_fields")
          .update(rest)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return data as TemplateField;
      }
      // New field — INSERT
      const { data, error } = await supabase
        .from("template_fields")
        .insert(patch)
        .select()
        .single();
      if (error) throw error;
      return data as TemplateField;
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ["template", d.template_id] }),
  });
}

export function useDeleteTemplateField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (field: { id: string; template_id: string }) => {
      const { error } = await supabase.from("template_fields").delete().eq("id", field.id);
      if (error) throw error;
      return field;
    },
    onSuccess: (field) => {
      qc.invalidateQueries({ queryKey: ["template", field.template_id] });
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}

// =============================================================================
// Create Template
// =============================================================================
export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      organization_id: string;
      author_id: string;
      description?: string | null;
      category_id?: string | null;
    }) => {
      // 1. Insert the template
      const { data: template, error: tErr } = await supabase
        .from("templates")
        .insert({
          name: input.name,
          description: input.description ?? null,
          organization_id: input.organization_id,
          author_id: input.author_id,
          category_id: input.category_id ?? null,
          scope: "org",
          status: "draft",
          version: "1.0",
          is_featured: false,
          rating: 0,
          downloads: 0,
          field_count: 0,
          config: {},
        })
        .select()
        .single();
      if (tErr) throw tErr;
      const t = template as Template;

      // 2. Seed with default fields so it's immediately usable
      const defaultFields: Partial<TemplateField>[] = [
        {
          key: "invoice_number",
          label: "Invoice Number",
          field_group: "Header",
          data_type: "string",
          sort_order: 1,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.9,
          config: {},
        },
        {
          key: "vendor_name",
          label: "Vendor Name",
          field_group: "Header",
          data_type: "string",
          sort_order: 2,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.92,
          config: {},
        },
        {
          key: "client_name",
          label: "Client Name",
          field_group: "Header",
          data_type: "string",
          sort_order: 3,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.88,
          config: {},
        },
        {
          key: "date",
          label: "Date",
          field_group: "Header",
          data_type: "date",
          sort_order: 4,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.91,
          config: {},
        },
        {
          key: "due_date",
          label: "Due Date",
          field_group: "Header",
          data_type: "date",
          sort_order: 5,
          is_enabled: false,
          is_required: false,
          default_confidence: 0.8,
          config: {},
        },
        {
          key: "subtotal",
          label: "Subtotal",
          field_group: "Amounts",
          data_type: "number",
          sort_order: 6,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.89,
          config: {},
        },
        {
          key: "tax",
          label: "Tax",
          field_group: "Amounts",
          data_type: "number",
          sort_order: 7,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.87,
          config: {},
        },
        {
          key: "total",
          label: "Total",
          field_group: "Amounts",
          data_type: "number",
          sort_order: 8,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.93,
          config: {},
        },
        {
          key: "currency",
          label: "Currency",
          field_group: "Amounts",
          data_type: "string",
          sort_order: 9,
          is_enabled: true,
          is_required: false,
          default_confidence: 0.9,
          config: {},
        },
        {
          key: "gstin",
          label: "GSTIN / Tax ID",
          field_group: "Tax",
          data_type: "string",
          sort_order: 10,
          is_enabled: false,
          is_required: false,
          default_confidence: 0.85,
          config: {},
        },
        {
          key: "po_number",
          label: "PO Number",
          field_group: "Header",
          data_type: "string",
          sort_order: 11,
          is_enabled: false,
          is_required: false,
          default_confidence: 0.82,
          config: {},
        },
      ].map((f) => ({ ...f, template_id: t.id }));

      const { error: fErr } = await supabase.from("template_fields").insert(defaultFields);
      if (fErr) throw fErr;

      // 3. Update field_count
      await supabase.from("templates").update({ field_count: defaultFields.length }).eq("id", t.id);

      return t;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["templates", vars.organization_id] });
    },
  });
}

// =============================================================================
// Update Template
// =============================================================================
export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Template> & { id: string }) => {
      const { id, ...rest } = patch;
      const { data, error } = await supabase
        .from("templates")
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Template;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["template", d.id] });
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}

// =============================================================================
// Documents & Processing
// =============================================================================
export function useDocuments(orgId: string | null | undefined, limit = 50) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["documents", orgId, limit],
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organization_id: string;
      file: File;
      category_id?: string | null;
      template_id?: string | null;
    }) => {
      const path = `${input.organization_id}/${crypto.randomUUID()}-${input.file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, input.file);
      if (upErr && upErr.message !== "The resource already exists") throw upErr;

      const { data, error } = await supabase
        .from("documents")
        .insert({
          organization_id: input.organization_id,
          file_name: input.file.name,
          storage_path: path,
          mime_type: input.file.type,
          file_size_bytes: input.file.size,
          category_id: input.category_id ?? null,
          template_id: input.template_id ?? null,
          status: "uploaded",
          source: "upload",
        })
        .select()
        .single();
      if (error) {
        await supabase.storage.from("documents").remove([path]);
        throw error;
      }
      return data as DocumentRow;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["documents", v.organization_id] }),
  });
}

export function useProcessingJobs(orgId: string | null | undefined, limit = 50) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["processing-jobs", orgId, limit],
    refetchInterval: 5_000,
    queryFn: async (): Promise<ProcessingJob[]> => {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ProcessingJob[];
    },
  });
}

export function useAllProcessingJobs(opts?: { limit?: number; stage?: ProcessingJob["stage"] }) {
  return useQuery({
    queryKey: ["processing-jobs-all", opts?.limit ?? 80, opts?.stage ?? "all"],
    queryFn: async (): Promise<ProcessingJob[]> => {
      let q = supabase
        .from("processing_jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (opts?.stage) q = q.eq("stage", opts.stage);
      const { data, error } = await q.limit(opts?.limit ?? 80);
      if (error) throw error;
      return (data ?? []) as ProcessingJob[];
    },
  });
}

export function useQueueStageCounts() {
  return useQuery({
    queryKey: ["queue-stage-counts"],
    queryFn: async () => {
      const stages = [
        "pending",
        "queued",
        "ocr",
        "ai_extraction",
        "validation",
        "export",
        "completed",
        "failed",
        "retry",
        "dead_letter",
      ] as const;
      const out: Record<string, number> = {};
      await Promise.all(
        stages.map(async (s) => {
          const { count } = await supabase
            .from("processing_jobs")
            .select("id", { head: true, count: "exact" })
            .eq("stage", s);
          out[s] = count ?? 0;
        }),
      );
      return out;
    },
    refetchInterval: 30_000,
  });
}

export function useExtractions(orgId: string | null | undefined, limit = 50) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["extractions", orgId, limit],
    queryFn: async (): Promise<
      (Extraction & { document?: DocumentRow | null; category?: DocumentCategory | null })[]
    > => {
      const { data, error } = await supabase
        .from("extractions")
        .select("*, document:documents(*, category:document_categories(*))")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as never;
    },
  });
}

export function useDeleteExtractions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orgId: string; ids: string[] }) => {
      const ids = Array.from(new Set(input.ids)).filter(Boolean);
      if (ids.length === 0) return ids;

      const { error } = await supabase
        .from("extractions")
        .delete()
        .eq("organization_id", input.orgId)
        .in("id", ids);
      if (error) throw error;
      return ids;
    },
    onSuccess: (_ids, input) => {
      qc.invalidateQueries({ queryKey: ["extractions", input.orgId] });
    },
  });
}

export function useUpdateExtractionData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      orgId: string;
      extractionId: string;
      data: Record<string, Json>;
    }) => {
      const { data, error } = await supabase
        .from("extractions")
        .update({ data: input.data })
        .eq("organization_id", input.orgId)
        .eq("id", input.extractionId)
        .select()
        .single();
      if (error) throw error;
      return data as Extraction;
    },
    onSuccess: (_row, input) => {
      qc.invalidateQueries({ queryKey: ["extractions", input.orgId] });
    },
  });
}

export function useExports(orgId: string | null | undefined, limit = 20) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["exports", orgId, limit],
    queryFn: async (): Promise<ExportRow[]> => {
      const { data, error } = await supabase
        .from("exports")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ExportRow[];
    },
  });
}

export function useWorkers() {
  return useQuery({
    queryKey: ["workers"],
    queryFn: async (): Promise<Worker[]> => {
      const { data, error } = await supabase.from("workers").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Worker[];
    },
    refetchInterval: 30_000,
  });
}

// =============================================================================
// Billing
// =============================================================================
export function useSubscription(orgId: string | null | undefined) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["subscription", orgId],
    queryFn: async (): Promise<(Subscription & { plan: Plan | null }) | null> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, plan:plans(*)")
        .eq("organization_id", orgId!)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as never) ?? null;
    },
  });
}

export function useInvoices(orgId: string | null | undefined, limit = 12) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["invoices", orgId, limit],
    queryFn: async (): Promise<Invoice[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("organization_id", orgId!)
        .order("issue_date", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });
}

export function useTransactions(opts?: { orgId?: string | null; limit?: number }) {
  return useQuery({
    queryKey: ["transactions", opts?.orgId ?? "all", opts?.limit ?? 40],
    queryFn: async (): Promise<
      (Transaction & { organization?: Organization | null; plan?: Plan | null })[]
    > => {
      let q = supabase
        .from("transactions")
        .select("*, organization:organizations(*), plan:plans(*)")
        .order("created_at", { ascending: false });
      if (opts?.orgId) q = q.eq("organization_id", opts.orgId);
      const { data, error } = await q.limit(opts?.limit ?? 40);
      if (error) throw error;
      return (data ?? []) as never;
    },
  });
}

export function usePaymentMethods(orgId: string | null | undefined) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["payment-methods", orgId],
    queryFn: async (): Promise<PaymentMethodRow[]> => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("organization_id", orgId!)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PaymentMethodRow[];
    },
  });
}

export function useRevenueMetrics() {
  return useQuery({
    queryKey: ["revenue-metrics"],
    queryFn: async () => {
      // last 30 days succeeded txns → MRR proxy
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: recent } = await supabase
        .from("transactions")
        .select("amount_inr, status")
        .gte("created_at", since);

      const succeeded = (recent ?? []).filter((t) => t.status === "succeeded");
      const failed = (recent ?? []).filter((t) => t.status === "failed").length;
      const refunds = (recent ?? []).filter((t) => t.status === "refunded").length;
      const mrr = succeeded.reduce((s, t) => s + Number(t.amount_inr ?? 0), 0);
      return {
        mrr,
        arr: mrr * 12,
        failedPayments: failed,
        refundsThisMonth: refunds,
        netRevenue: mrr - refunds,
      };
    },
  });
}

// =============================================================================
// API Keys
// =============================================================================
export function useApiKeys(orgId: string | null | undefined) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["api-keys", orgId],
    queryFn: async (): Promise<ApiKeyRow[]> => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .eq("organization_id", orgId!)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ApiKeyRow[];
    },
  });
}

function generateApiKey(): { prefix: string; raw: string } {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 24);
  const raw = `lgy_live_${random}`;
  return { prefix: raw.slice(0, 12), raw };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organization_id: string;
      name: string;
      scope: ApiKeyRow["scope"];
    }) => {
      const { prefix, raw } = generateApiKey();
      const key_hash = await sha256Hex(raw);
      const { data, error } = await supabase
        .from("api_keys")
        .insert({
          organization_id: input.organization_id,
          name: input.name,
          prefix,
          key_hash,
          scope: input.scope,
        })
        .select()
        .single();
      if (error) throw error;
      return { row: data as ApiKeyRow, raw };
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["api-keys", v.organization_id] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

// =============================================================================
// Vendor APIs, Integrations
// =============================================================================
export function useIntegrations() {
  return useQuery({
    queryKey: ["integrations"],
    queryFn: async (): Promise<Integration[]> => {
      const { data, error } = await supabase.from("integrations").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Integration[];
    },
  });
}

// =============================================================================
// Notifications, Audit, Security, Tickets, Flags
// =============================================================================
export function useNotifications(limit = 20) {
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
}

export function useAuditLogs(opts?: { orgId?: string | null; limit?: number }) {
  return useQuery({
    queryKey: ["audit-logs", opts?.orgId ?? "all", opts?.limit ?? 30],
    queryFn: async (): Promise<AuditLog[]> => {
      let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false });
      if (opts?.orgId) q = q.eq("organization_id", opts.orgId);
      const { data, error } = await q.limit(opts?.limit ?? 30);
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });
}

export function useSecurityEvents(limit = 25) {
  return useQuery({
    queryKey: ["security-events", limit],
    queryFn: async (): Promise<SecurityEventRow[]> => {
      const { data, error } = await supabase
        .from("security_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as SecurityEventRow[];
    },
  });
}

function formatPersonName(p?: {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  if (!p) return "—";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || p.email || "—";
}

const TICKET_SLA_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high: 8,
  normal: 24,
  low: 72,
};

export type AdminTicketRow = TicketRow & {
  orgName: string;
  requesterName: string;
  assigneeName: string;
};

export function useAdminTickets(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 60;
  return useQuery({
    queryKey: ["tickets", "admin", limit],
    queryFn: async (): Promise<AdminTicketRow[]> => {
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const tickets = (data ?? []) as TicketRow[];

      const orgIds = [
        ...new Set(tickets.map((t) => t.organization_id).filter((v): v is string => !!v)),
      ];
      const peopleIds = [
        ...new Set(
          [...tickets.map((t) => t.requester_id), ...tickets.map((t) => t.assignee_id)].filter(
            (v): v is string => !!v,
          ),
        ),
      ];

      const [orgsRes, peopleRes] = await Promise.all([
        orgIds.length
          ? supabase.from("organizations").select("id,name").in("id", orgIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
        peopleIds.length
          ? supabase.from("profiles").select("id,email,first_name,last_name").in("id", peopleIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                email: string | null;
                first_name: string | null;
                last_name: string | null;
              }[],
              error: null,
            }),
      ]);
      if (orgsRes.error) throw orgsRes.error;
      if (peopleRes.error) throw peopleRes.error;

      const orgById = new Map((orgsRes.data ?? []).map((o) => [o.id, o.name]));
      const personById = new Map((peopleRes.data ?? []).map((p) => [p.id, formatPersonName(p)]));

      return tickets.map((t) => ({
        ...t,
        orgName: (t.organization_id && orgById.get(t.organization_id)) || "—",
        requesterName: (t.requester_id && personById.get(t.requester_id)) || "—",
        assigneeName: (t.assignee_id && personById.get(t.assignee_id)) || "Unassigned",
      }));
    },
  });
}

export function useMyTickets(profileId: string | null | undefined, limit = 50) {
  return useQuery({
    queryKey: ["tickets", "mine", profileId, limit],
    enabled: !!profileId,
    queryFn: async (): Promise<TicketRow[]> => {
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("requester_id", profileId as string)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },
  });
}

export function useTicket(ticketId: string | null | undefined) {
  return useQuery({
    queryKey: ["tickets", "detail", ticketId],
    enabled: !!ticketId,
    queryFn: async (): Promise<TicketRow> => {
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", ticketId as string)
        .single();
      if (error) throw error;
      return data as TicketRow;
    },
  });
}

export function useTicketReplies(ticketId: string | null | undefined, includeInternal: boolean) {
  return useQuery({
    queryKey: ["tickets", "replies", ticketId, includeInternal],
    enabled: !!ticketId,
    queryFn: async (): Promise<TicketReplyRow[]> => {
      let q = supabase
        .from("ticket_replies")
        .select("*")
        .eq("ticket_id", ticketId as string);
      if (!includeInternal) q = q.eq("is_internal", false);
      const { data, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TicketReplyRow[];
    },
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      requesterId: string;
      subject: string;
      body: string;
      category: string;
      priority: TicketPriority;
    }) => {
      const slaDeadline = new Date(
        Date.now() + TICKET_SLA_HOURS[input.priority] * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await supabase
        .from("tickets")
        .insert({
          organization_id: input.organizationId,
          requester_id: input.requesterId,
          subject: input.subject,
          body: input.body,
          category: input.category,
          priority: input.priority,
          status: "open",
          sla_deadline: slaDeadline,
        })
        .select()
        .single();
      if (error) throw error;
      return data as TicketRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useAddTicketReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ticketId: string;
      authorId: string;
      body: string;
      isInternal?: boolean;
    }) => {
      const { error } = await supabase.from("ticket_replies").insert({
        ticket_id: input.ticketId,
        author_id: input.authorId,
        body: input.body,
        is_internal: input.isInternal ?? false,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<TicketRow, "status" | "priority" | "assignee_id" | "resolved_at">>;
    }) => {
      const { error } = await supabase.from("tickets").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useProfilesByIds(ids: string[]) {
  const key = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["profiles-by-ids", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,first_name,last_name")
        .in("id", key);
      if (error) throw error;
      const rows = (data ?? []) as {
        id: string;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      }[];
      return new Map(rows.map((p) => [p.id, formatPersonName(p)]));
    },
  });
}

export function useSuperAdminProfiles() {
  return useQuery({
    queryKey: ["profiles-super-admins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,first_name,last_name")
        .eq("is_super_admin", true)
        .order("email");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      }[];
    },
  });
}

export function useOpenTicketCount() {
  return useQuery({
    queryKey: ["tickets", "open-count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("tickets")
        .select("*", { count: "exact", head: true })
        .in("status", ["open", "in_progress", "waiting"]);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

// =============================================================================
// Contact Submissions
// =============================================================================
export function useCreateContactSubmission() {
  return useMutation({
    mutationFn: async (input: {
      name: string;
      phone: string;
      company: string | null;
      email: string;
      message: string;
    }) => {
      const { error } = await supabase.from("contact_submissions").insert(input);
      if (error) throw error;
    },
  });
}

export function useContactSubmissions(limit = 100) {
  return useQuery({
    queryKey: ["contact-submissions", limit],
    queryFn: async (): Promise<ContactSubmissionRow[]> => {
      const { data, error } = await supabase
        .from("contact_submissions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ContactSubmissionRow[];
    },
  });
}

export function useUpdateContactSubmissionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: ContactSubmissionStatus }) => {
      const { data, error } = await supabase
        .from("contact_submissions")
        .update({ status: input.status, updated_at: new Date().toISOString() })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as ContactSubmissionRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-submissions"] }),
  });
}

export function useFeatureFlags() {
  return useQuery({
    queryKey: ["feature-flags"],
    queryFn: async (): Promise<FeatureFlag[]> => {
      const { data, error } = await supabase.from("feature_flags").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as FeatureFlag[];
    },
  });
}

export function useToggleFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<FeatureFlag> }) => {
      const { data, error } = await supabase
        .from("feature_flags")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as FeatureFlag;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feature-flags"] }),
  });
}

// =============================================================================
// Usage / Metrics
// =============================================================================
export function useUsageRecords(orgId: string | null | undefined, days = 30) {
  return useQuery({
    enabled: !!orgId,
    queryKey: ["usage-records", orgId, days],
    queryFn: async (): Promise<UsageRecord[]> => {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("usage_records")
        .select("*")
        .eq("organization_id", orgId!)
        .gte("date", since)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UsageRecord[];
    },
  });
}

export function useMetricSnapshots(metric: string, points = 30) {
  return useQuery({
    queryKey: ["metric-snapshots", metric, points],
    queryFn: async (): Promise<MetricSnapshot[]> => {
      const { data, error } = await supabase
        .from("metric_snapshots")
        .select("*")
        .eq("metric", metric)
        .order("taken_at", { ascending: false })
        .limit(points);
      if (error) throw error;
      return ((data ?? []) as MetricSnapshot[]).reverse();
    },
  });
}

export function useDashboardKpis() {
  return useQuery({
    queryKey: ["dashboard-kpis"],
    queryFn: async () => {
      const token = getAccessToken();
      const res = await fetch("/api/admin/dashboard-kpis", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await res.json()) as {
        users?: number;
        orgs?: number;
        enterprises?: number;
        pagesToday?: number;
        queueActive?: number;
        failedToday?: number;
        webhooksActive?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load dashboard KPIs");
      return {
        users: data.users ?? 0,
        orgs: data.orgs ?? 0,
        enterprises: data.enterprises ?? 0,
        pagesToday: data.pagesToday ?? 0,
        queueActive: data.queueActive ?? 0,
        failedToday: data.failedToday ?? 0,
        webhooksActive: data.webhooksActive ?? 0,
      };
    },
    refetchInterval: 60_000,
  });
}

export function useExDocHealth() {
  return useQuery({
    queryKey: ["admin", "exdoc-health"],
    queryFn: async (): Promise<{
      provider: string;
      baseUrl: string;
      configured: boolean;
      reachable: boolean;
      live: boolean;
      status: "live" | "degraded" | "down";
      latencyMs: number | null;
      httpStatus: number | null;
      checkedUrl: string | null;
      checkedAt: string;
      error?: string;
    }> => {
      const token = getAccessToken();
      const res = await fetch("/api/admin/exdoc-health", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await res.json()) as {
        provider?: string;
        baseUrl?: string;
        configured?: boolean;
        reachable?: boolean;
        live?: boolean;
        status?: "live" | "degraded" | "down";
        latencyMs?: number | null;
        httpStatus?: number | null;
        checkedUrl?: string | null;
        checkedAt?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load ExDoc health");
      return {
        provider: data.provider ?? "ExDoc API",
        baseUrl: data.baseUrl ?? "",
        configured: !!data.configured,
        reachable: !!data.reachable,
        live: !!data.live,
        status: data.status ?? "down",
        latencyMs: data.latencyMs ?? null,
        httpStatus: data.httpStatus ?? null,
        checkedUrl: data.checkedUrl ?? null,
        checkedAt: data.checkedAt ?? new Date().toISOString(),
      };
    },
    refetchInterval: 30_000,
  });
}

export function useUserAuditLogsAdmin(userId: string | null | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["user-audit-logs-admin", userId],
    queryFn: async (): Promise<AuditLog[]> => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("actor_id", userId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });
}

export function useUserSessionsAdmin(userId: string | null | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["user-sessions-admin", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_sessions")
        .select("*")
        .eq("user_id", userId!)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
}

async function getUserPrimaryOrgId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { organization_id: string } | null)?.organization_id ?? null;
}

export function useUserTransactionsAdmin(userId: string | null | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["user-transactions-admin", userId],
    queryFn: async (): Promise<Transaction[]> => {
      const orgId = await getUserPrimaryOrgId(userId!);
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
  });
}

export function useUserApiKeysAdmin(userId: string | null | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["user-api-keys-admin", userId],
    queryFn: async (): Promise<ApiKeyRow[]> => {
      const orgId = await getUserPrimaryOrgId(userId!);
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .eq("organization_id", orgId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as ApiKeyRow[];
    },
  });
}

// =============================================================================
// Template moderation (admin)
// =============================================================================
export function useApproveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from("templates")
        .update({ status: "active" })
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}

export function useRejectTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, reason }: { templateId: string; reason?: string }) => {
      const { error } = await supabase
        .from("templates")
        .update({ status: "rejected", rejection_reason: reason ?? null })
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}

// =============================================================================
// Admin user actions
// =============================================================================
export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, suspend }: { userId: string; suspend: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ status: suspend ? "suspended" : "active" })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useAddCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, credits }: { userId: string; credits: number }) => {
      const orgId = await getUserPrimaryOrgId(userId);
      if (!orgId) throw new Error("User has no organization");
      const { error } = await supabase.rpc("add_org_credits", {
        p_org_id: orgId,
        p_credits: credits,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

// =============================================================================
// Account management (settings)
// =============================================================================
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      const payload = getTokenPayload();
      if (!payload) throw new Error("Not authenticated");
      const { error } = await supabase.functions.invoke("delete-account", {
        body: { user_id: payload.sub },
      });
      if (error) throw error;
      // Sign out via our own API (clears HttpOnly refresh cookie)
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async ({
      old_password,
      new_password,
    }: {
      old_password: string;
      new_password: string;
    }) => {
      const token = getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ old_password, new_password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to change password");
    },
  });
}

// =============================================================================
// User notifications (bell inbox)
// =============================================================================
export function useUserNotifications() {
  return useQuery({
    queryKey: ["user-notifications"],
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("channel", "in_app")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_notificationId: string | "all") => {
      // Read state is tracked client-side via localStorage (no read_at column on this table)
      const key = "billsos_read_notifs";
      if (_notificationId === "all") {
        const { data } = await supabase
          .from("notifications")
          .select("id")
          .eq("channel", "in_app")
          .limit(20);
        const ids = (data ?? []).map((n: { id: string }) => n.id);
        localStorage.setItem(key, JSON.stringify(ids));
      } else {
        const existing: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
        if (!existing.includes(_notificationId)) {
          localStorage.setItem(key, JSON.stringify([...existing, _notificationId]));
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });
}

// =============================================================================
// Notification channel stats (admin)
// =============================================================================
export function useNotificationChannelStats() {
  return useQuery({
    queryKey: ["notification-channel-stats"],
    queryFn: async () => {
      const [{ count: emailCount }, { count: inAppCount }] = await Promise.all([
        supabase
          .from("notifications")
          .select("id", { head: true, count: "exact" })
          .eq("channel", "email"),
        supabase
          .from("notifications")
          .select("id", { head: true, count: "exact" })
          .eq("channel", "in_app"),
      ]);
      return { email: emailCount ?? 0, in_app: inAppCount ?? 0 };
    },
  });
}

export function useProfilesBasic(opts?: { search?: string; limit?: number }) {
  return useQuery({
    queryKey: ["profiles-basic", opts?.search ?? "", opts?.limit ?? 100],
    queryFn: async () => {
      let q = supabase.from("profiles").select("id,email,first_name,last_name").order("email");
      if (opts?.search) {
        const s = `%${opts.search}%`;
        q = q.or(`email.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`);
      }
      const { data, error } = await q.limit(opts?.limit ?? 100);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      }[];
    },
  });
}

export function useSendEmailNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userIds: "all" | string[]; subject: string; html: string }) =>
      fetchAdminJson<{ ok: boolean; sent: number; failed: number; errors?: string[] }>(
        "/api/admin/notifications/send-email",
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-channel-stats"] });
    },
  });
}

export function useSendInAppNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { subject: string; body: string }) => {
      const { data, error } = await supabase
        .from("notifications")
        .insert({
          channel: "in_app",
          subject: input.subject,
          body: input.body,
          audience: "all_users",
          status: "delivered",
          recipients: 0,
          sent_at: new Date().toISOString(),
          metadata: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as Notification;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-channel-stats"] });
      qc.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });
}

// =============================================================================
// Plan subscriber counts (admin)
// =============================================================================
export function usePlanSubscriberCounts() {
  return useQuery({
    queryKey: ["plan-subscriber-counts"],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("plan_id")
        .eq("status", "active");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const r = row as { plan_id: string };
        counts[r.plan_id] = (counts[r.plan_id] ?? 0) + 1;
      }
      return counts;
    },
  });
}

// =============================================================================
// Document signed URL (for preview)
// =============================================================================
export function useDocumentSignedUrl(
  storagePath: string | null | undefined,
  documentId?: string | null,
) {
  return useQuery({
    enabled: !!storagePath || !!documentId,
    queryKey: ["doc-signed-url", documentId ?? storagePath],
    staleTime: 50 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      if (documentId) {
        const token = getAccessToken();
        const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/signed-url`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = (await res.json()) as { signedUrl?: string | null; error?: string };
        if (!res.ok) throw new Error(payload.error ?? "Could not load document preview");
        return payload.signedUrl ?? null;
      }

      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(storagePath!, 3600);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

export function useDocumentPreviewBlob(documentId: string | null | undefined) {
  return useQuery({
    enabled: !!documentId,
    queryKey: ["doc-preview", documentId],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Blob> => {
      const token = getAccessToken();
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId!)}/preview`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let message = "Could not load document preview";
        try {
          const payload = (await res.json()) as { error?: string };
          message = payload.error ?? message;
        } catch {
          // Non-JSON errors still surface with the generic preview message.
        }
        throw new Error(message);
      }
      return res.blob();
    },
  });
}

// =============================================================================
// User session management (settings)
// =============================================================================
export function useMyActiveSessions() {
  return useQuery({
    queryKey: ["my-sessions"],
    queryFn: async () => {
      const payload = getTokenPayload();
      if (!payload) return [];
      const { data, error } = await supabase
        .from("user_sessions")
        .select("*")
        .eq("user_id", payload.sub)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from("user_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-sessions"] });
    },
  });
}

// =============================================================================
// Feature-flag per-org overrides
// =============================================================================
export function useFeatureFlagOverrides(flagId: string | null | undefined) {
  return useQuery({
    enabled: !!flagId,
    queryKey: ["ff-overrides", flagId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feature_flag_overrides")
        .select("*, organization:organizations(name)")
        .eq("flag_id", flagId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertFeatureFlagOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      flagId,
      orgId,
      enabled,
    }: {
      flagId: string;
      orgId: string;
      enabled: boolean;
    }) => {
      const { error } = await supabase
        .from("feature_flag_overrides")
        .upsert(
          { flag_id: flagId, organization_id: orgId, is_enabled: enabled },
          { onConflict: "flag_id,organization_id" },
        );
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ff-overrides", v.flagId] });
    },
  });
}

export function useDeleteFeatureFlagOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ flagId, orgId }: { flagId: string; orgId: string }) => {
      const { error } = await supabase
        .from("feature_flag_overrides")
        .delete()
        .eq("flag_id", flagId)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ff-overrides", v.flagId] });
    },
  });
}

// =============================================================================
// Stripe billing — checkout session + customer portal
// =============================================================================

/**
 * Creates a Stripe Checkout Session for a new subscription.
 * Returns a URL to redirect the user to.
 */
export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async ({
      planId,
      returnUrl,
    }: {
      planId: string;
      returnUrl: string;
    }): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { action: "checkout", plan_id: planId, return_url: returnUrl },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("No checkout URL returned");
      return data.url as string;
    },
  });
}

/**
 * Opens the Stripe Customer Portal for managing subscription, payment methods,
 * plan upgrades/downgrades, and cancellation.
 * Returns a URL to redirect the user to.
 */
export function useBillingPortal() {
  return useMutation({
    mutationFn: async (returnUrl: string): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { action: "portal", return_url: returnUrl },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("No portal URL returned");
      return data.url as string;
    },
  });
}

// =============================================================================
// Admin Settings
// =============================================================================

export function useAdminSettings(key: string) {
  return useQuery({
    queryKey: ["admin-settings", key],
    queryFn: async (): Promise<Json | null> => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return (data as Pick<AdminSettings, "value"> | null)?.value ?? null;
    },
  });
}

export function useSaveAdminSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Json }) => {
      await fetchAdminJson("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ key, value }),
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-settings", vars.key] });
    },
  });
}

// =============================================================================
// Credit Grants (audit log)
// =============================================================================

export function useCreditGrants(orgId?: string | null) {
  return useQuery({
    queryKey: ["credit-grants", orgId ?? "all"],
    queryFn: async (): Promise<CreditGrant[]> => {
      let q = supabase
        .from("credit_grants")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CreditGrant[];
    },
  });
}

// =============================================================================
// Report runs + templates (admin)
// =============================================================================

export interface ReportRun {
  id: string;
  report_key: string;
  report_name: string;
  generated_by: string | null;
  date_from: string;
  date_to: string;
  row_count: number;
  file_name: string | null;
  file_size_bytes: number;
  status: "completed" | "failed";
  error_message: string | null;
  created_at: string;
}

export interface ReportTemplate {
  id: string;
  key: string;
  name: string;
  category: string;
  schedule: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function useReportTemplates() {
  return useQuery({
    queryKey: ["report-templates"],
    queryFn: async (): Promise<ReportTemplate[]> => {
      const { data, error } = await supabase
        .from("report_templates")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReportTemplate[];
    },
  });
}

export function useReportRuns(limit = 30) {
  return useQuery({
    queryKey: ["report-runs", limit],
    queryFn: async (): Promise<ReportRun[]> => {
      const { data, error } = await supabase
        .from("report_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ReportRun[];
    },
  });
}

export function useInsertReportRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (run: Omit<ReportRun, "id" | "created_at">): Promise<ReportRun> => {
      const { data, error } = await supabase.from("report_runs").insert(run).select().single();
      if (error) throw error;
      return data as ReportRun;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-runs"] });
      qc.invalidateQueries({ queryKey: ["report-stats"] });
    },
  });
}

export function useReportStats() {
  return useQuery({
    queryKey: ["report-stats"],
    queryFn: async () => {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const startIso = start.toISOString();

      const [{ count }, { data: sizeRows }] = await Promise.all([
        supabase
          .from("report_runs")
          .select("id", { head: true, count: "exact" })
          .gte("created_at", startIso)
          .eq("status", "completed"),
        supabase
          .from("report_runs")
          .select("file_size_bytes")
          .gte("created_at", startIso)
          .eq("status", "completed"),
      ]);

      const totalBytes = (sizeRows ?? []).reduce(
        (s, r) => s + Number((r as { file_size_bytes?: number }).file_size_bytes ?? 0),
        0,
      );
      return { generatedThisMonth: count ?? 0, storageBytes: totalBytes };
    },
  });
}
