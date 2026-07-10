/**
 * Role-based permissions for organization workspaces.
 *
 * This module is the single client-side source of truth for what each member
 * role may do. It only controls what the UI shows — the database enforces the
 * same rules independently via RLS policies and the protect_org_members
 * trigger (migration 202607020003_org_management.sql), so a hand-crafted API
 * call can never do more than what is allowed here.
 *
 * Role hierarchy: owner > admin > member > viewer
 *   owner  — full control, incl. deleting the org and transferring ownership
 *   admin  — manage members/viewers and invitations, edit workspace settings
 *   member — day-to-day read/write on documents and extractions
 *   viewer — read-only access
 */

import type { MemberRole, Section, SectionLevel } from "@/lib/supabase/types";

export const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Full control: billing, danger zone, and ownership transfer.",
  admin: "Manage members, invitations, and workspace settings.",
  member: "Upload documents, run extractions, and edit content.",
  viewer: "Read-only access to documents and results.",
};

export type OrgAction =
  | "org:update" // rename / edit workspace settings
  | "org:delete" // delete the organization
  | "org:transfer" // transfer ownership
  | "members:invite" // send invitations
  | "members:manage" // change roles / remove members
  | "invites:manage" // revoke / resend pending invitations
  | "billing:manage" // plans, payment methods
  | "content:write" // upload / edit documents, run extractions
  | "content:read"; // view documents and results

const GRANTS: Record<MemberRole, ReadonlySet<OrgAction>> = {
  owner: new Set<OrgAction>([
    "org:update",
    "org:delete",
    "org:transfer",
    "members:invite",
    "members:manage",
    "invites:manage",
    "billing:manage",
    "content:write",
    "content:read",
  ]),
  admin: new Set<OrgAction>([
    "org:update",
    "members:invite",
    "members:manage",
    "invites:manage",
    "billing:manage",
    "content:write",
    "content:read",
  ]),
  member: new Set<OrgAction>(["content:write", "content:read"]),
  viewer: new Set<OrgAction>(["content:read"]),
};

/** Whether a role (null = not a member) may perform an action. */
export function can(role: MemberRole | null | undefined, action: OrgAction): boolean {
  if (!role) return false;
  return GRANTS[role].has(action);
}

/**
 * Per-section access (view/edit/none), layered on top of roles.
 *
 * A role sets the starting point (ROLE_SECTION_DEFAULTS); an owner/admin can
 * then override any single section for any non-owner member via
 * organization_members.section_access, without changing that person's role.
 * Owners always resolve to "edit" everywhere — this can't be overridden, so
 * a workspace can never lock out its own owner.
 */
export const SECTIONS: { id: Section; label: string }[] = [
  { id: "billing", label: "Billing & Plans" },
  { id: "support", label: "Support" },
  { id: "history", label: "History" },
  { id: "process", label: "Process" },
  { id: "templates", label: "Templates" },
  { id: "data_entries", label: "Data Entries" },
];

const ROLE_SECTION_DEFAULTS: Record<MemberRole, Record<Section, SectionLevel>> = {
  owner: {
    billing: "edit",
    support: "edit",
    history: "edit",
    process: "edit",
    templates: "edit",
    data_entries: "edit",
  },
  admin: {
    billing: "edit",
    support: "edit",
    history: "edit",
    process: "edit",
    templates: "edit",
    data_entries: "edit",
  },
  member: {
    billing: "none",
    support: "none",
    history: "view",
    process: "edit",
    templates: "edit",
    data_entries: "edit",
  },
  viewer: {
    billing: "none",
    support: "none",
    history: "view",
    process: "none",
    templates: "none",
    data_entries: "view",
  },
};

/** Resolve one member's effective access level for one section. */
export function resolveSectionAccess(
  role: MemberRole | null | undefined,
  overrides: Partial<Record<Section, SectionLevel>> | null | undefined,
  section: Section,
): SectionLevel {
  if (!role) return "none";
  if (role === "owner") return "edit";
  return overrides?.[section] ?? ROLE_SECTION_DEFAULTS[role][section];
}

/**
 * Whether an actor may change the role of / remove a target member.
 * Mirrors the DB trigger: owners manage everyone; admins manage only
 * members and viewers (never owners or other admins).
 */
export function canManageMember(actor: MemberRole | null | undefined, target: MemberRole): boolean {
  if (!actor) return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "viewer";
  return false;
}

/**
 * Roles an actor may assign when inviting or changing a member's role.
 * "owner" is intentionally never assignable — ownership moves only through
 * the explicit transfer-ownership flow.
 */
export function assignableRoles(actor: MemberRole | null | undefined): MemberRole[] {
  if (actor === "owner" || actor === "admin") return ["admin", "member", "viewer"];
  return [];
}

/** Translate raw DB/API guard errors into sentences a person can act on. */
export function friendlyOrgError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "");
  const table: Record<string, string> = {
    cannot_remove_last_owner:
      "This person is the only owner. Transfer ownership to someone else first.",
    only_owners_can_manage_owners: "Only the workspace owner can change owner access.",
    admins_cannot_modify_admins: "Admins can't change other admins. Ask the owner.",
    cannot_raise_own_role: "You can't give yourself a higher role.",
    not_an_active_member: "You're not an active member of this workspace.",
    only_owner_can_transfer: "Only the workspace owner can transfer ownership.",
    only_owner_can_delete: "Only the workspace owner can delete the workspace.",
    target_not_active_member: "That person must be an active member first.",
    already_owner: "You already own this workspace.",
    organization_limit_reached: "You've reached the limit of 20 workspaces.",
    name_too_short: "The workspace name must be at least 2 characters.",
    already_has_organization: "You already have a workspace.",
    not_authenticated: "Your session expired. Please sign in again.",
  };
  for (const [code, message] of Object.entries(table)) {
    if (raw.includes(code)) return message;
  }
  return raw || "Something went wrong. Please try again.";
}
