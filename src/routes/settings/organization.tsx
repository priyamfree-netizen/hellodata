import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  Crown,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAcceptOrgInvite,
  useCreateAnotherOrganization,
  useDeclineOrgInvite,
  useDeleteOrganization,
  useLeaveOrganization,
  useMyInvitations,
  useOrgInvitations,
  useOrgMembers,
  useRemoveMember,
  useResendOrgInvite,
  useRevokeOrgInvite,
  useSendOrgInvite,
  useTransferOwnership,
  useUpdateMemberSectionAccess,
  useUpdateOrganization,
  type MemberWithProfile,
} from "@/lib/queries";
import {
  ROLE_LABELS,
  SECTIONS,
  can,
  canManageMember,
  friendlyOrgError,
  resolveSectionAccess,
} from "@/lib/permissions";
import type {
  MemberRole,
  OrganizationInvitation,
  Section,
  SectionLevel,
} from "@/lib/supabase/types";

export const Route = createFileRoute("/settings/organization")({
  component: OrganizationSettings,
});

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function OrganizationSettings() {
  const { user, currentOrg, orgs, refresh } = useAuth();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Organization</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create workspaces, manage your team, and control who can do what.
        </p>
      </div>

      <MyInvitationsCard onAccepted={refresh} />
      <OrganizationsCard />

      {currentOrg ? (
        <>
          <GeneralCard key={currentOrg.id} />
          <MembersCard key={`members-${currentOrg.id}`} />
          <DangerZoneCard key={`danger-${currentOrg.id}`} />
        </>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground">
          {orgs.length === 0 && user
            ? "You don't have a workspace yet. Create one above, or accept an invitation."
            : "Select a workspace above to manage it."}
        </div>
      )}
    </div>
  );
}

// ── Invitations addressed to me ───────────────────────────────────────────────
function MyInvitationsCard({ onAccepted }: { onAccepted: () => Promise<void> }) {
  const { data: invites = [] } = useMyInvitations();
  const accept = useAcceptOrgInvite();
  const decline = useDeclineOrgInvite();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (invites.length === 0) return null;

  async function handleAccept(id: string, orgName: string) {
    setBusyId(id);
    try {
      await accept.mutateAsync({ invitationId: id });
      await onAccepted();
      toast.success(`You joined ${orgName}.`);
    } catch (e) {
      toast.error(friendlyOrgError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(id: string) {
    setBusyId(id);
    try {
      await decline.mutateAsync({ invitationId: id });
      toast.success("Invitation declined.");
    } catch (e) {
      toast.error(friendlyOrgError(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 overflow-hidden">
      <div className="border-b border-blue-500/20 p-6">
        <h3 className="flex items-center gap-2 font-medium">
          <Mail className="h-4 w-4 text-blue-400" /> Invitations for you
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Teams that invited you to join their workspace.
        </p>
      </div>
      <div className="divide-y divide-border/50">
        {invites.map((inv) => (
          <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 p-4 px-6">
            <div>
              <div className="text-sm font-medium">{inv.organization_name}</div>
              <div className="text-xs text-muted-foreground">
                Invited by {inv.invited_by_name ?? "a teammate"} as {ROLE_LABELS[inv.role]} ·
                expires {formatDate(inv.expires_at)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAccept(inv.id, inv.organization_name)}
                disabled={busyId === inv.id}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
              >
                {busyId === inv.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Accept
              </button>
              <button
                onClick={() => handleDecline(inv.id)}
                disabled={busyId === inv.id}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Workspace list + create ───────────────────────────────────────────────────
function OrganizationsCard() {
  const { currentOrg, orgs, refresh, setCurrentOrg } = useAuth();
  const createOrg = useCreateAnotherOrganization();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  async function handleCreate() {
    try {
      const org = await createOrg.mutateAsync({ name });
      // The RPC already set profiles.current_org_id; refresh picks it up.
      await refresh();
      setShowCreate(false);
      setName("");
      toast.success(`Workspace "${org.name}" created.`);
    } catch (e) {
      toast.error(friendlyOrgError(e));
    }
  }

  async function handleSwitch(orgId: string) {
    setSwitchingId(orgId);
    try {
      await setCurrentOrg(orgId);
    } catch (e) {
      toast.error(friendlyOrgError(e));
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="border-b border-border p-6 flex items-center justify-between">
        <div>
          <h3 className="font-medium">Your Workspaces</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            All workspaces you belong to. The selected one is what the rest of the app shows.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Workspace
        </button>
      </div>

      {orgs.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted-foreground">
          No workspaces yet — create your first one.
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {orgs.map((org) => {
            const isCurrent = org.id === currentOrg?.id;
            return (
              <div key={org.id} className="flex items-center justify-between p-4 px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {org.name}
                      {isCurrent && (
                        <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[9px] font-medium text-blue-400 uppercase tracking-wider">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{org.slug}</div>
                  </div>
                </div>
                {!isCurrent && (
                  <button
                    onClick={() => handleSwitch(org.id)}
                    disabled={switchingId === org.id}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    {switchingId === org.id ? "Switching…" : "Switch"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new workspace</DialogTitle>
            <DialogDescription>
              You'll be the owner. You can invite your team afterwards.
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            autoFocus
            placeholder="Company or team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim().length >= 2) void handleCreate();
            }}
            className={`w-full ${inputClass}`}
          />
          <DialogFooter>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={name.trim().length < 2 || createOrg.isPending}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            >
              {createOrg.isPending ? "Creating…" : "Create workspace"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The signed-in user's role in the current org, derived from the member list. */
function useMyRole(): { myRole: MemberRole | null; membersLoading: boolean } {
  const { user, currentOrg } = useAuth();
  const { data: members = [], isLoading } = useOrgMembers(currentOrg?.id);
  const myRole = useMemo(
    () => members.find((m) => m.user_id === user?.id && m.status === "active")?.role ?? null,
    [members, user?.id],
  );
  return { myRole, membersLoading: isLoading };
}

// ── General settings ──────────────────────────────────────────────────────────
function GeneralCard() {
  const { currentOrg, refresh } = useAuth();
  const { myRole } = useMyRole();
  const updateOrg = useUpdateOrganization();
  const [name, setName] = useState(currentOrg?.name ?? "");

  useEffect(() => {
    if (currentOrg) setName(currentOrg.name);
  }, [currentOrg]);

  const canEdit = can(myRole, "org:update");

  async function saveName() {
    if (!currentOrg || name.trim().length < 2) return;
    try {
      await updateOrg.mutateAsync({ id: currentOrg.id, patch: { name: name.trim() } });
      await refresh();
      toast.success("Workspace name updated.");
    } catch (e) {
      toast.error(friendlyOrgError(e));
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="border-b border-border p-6">
        <h3 className="font-medium">General</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {canEdit
            ? "Your workspace's visible name."
            : "Only owners and admins can change these settings."}
        </p>
      </div>
      <div className="p-6 space-y-4">
        <div className="flex max-w-md gap-3">
          <input
            type="text"
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
            className={`flex-1 ${inputClass} disabled:opacity-60`}
          />
          {canEdit && (
            <button
              onClick={saveName}
              disabled={updateOrg.isPending || name.trim().length < 2}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            >
              {updateOrg.isPending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Workspace URL slug: <span className="font-mono text-foreground">{currentOrg?.slug}</span>
        </div>
      </div>
    </div>
  );
}

// ── Members + invitations ─────────────────────────────────────────────────────
function MembersCard() {
  const { user, currentOrg } = useAuth();
  const orgId = currentOrg?.id;
  const { data: members = [], isLoading } = useOrgMembers(orgId);
  const { myRole, membersLoading } = useMyRole();

  const canInvite = can(myRole, "members:invite");
  const { data: invites = [] } = useOrgInvitations(orgId, canInvite);

  const sendInvite = useSendOrgInvite();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  async function handleInvite() {
    if (!orgId) return;
    try {
      const res = await sendInvite.mutateAsync({
        organizationId: orgId,
        email: inviteEmail.trim(),
        role: "member",
      });
      setInviteEmail("");
      setShowInvite(false);
      toast.success(
        res.emailSent
          ? `Invitation emailed to ${res.invitation.email}.`
          : `Invitation created. Email could not be sent — if they already have an account, they'll see it here after signing in.`,
      );
    } catch (e) {
      toast.error(friendlyOrgError(e));
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="border-b border-border p-6 flex items-center justify-between">
        <div>
          <h3 className="font-medium">Team Members</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {canInvite
              ? "Manage who has access to your workspace and what they can do."
              : "People with access to this workspace."}
          </p>
        </div>
        {canInvite && (
          <button
            onClick={() => setShowInvite((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Team Member
          </button>
        )}
      </div>

      {showInvite && canInvite && (
        <div className="border-b border-border bg-surface-2 p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              placeholder="email@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className={`flex-1 min-w-[200px] ${inputClass}`}
            />
            <button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || sendInvite.isPending}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            >
              {sendInvite.isPending ? "Sending…" : "Send invite"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            They'll join as a team member. You can fine-tune what they can access from their row
            after they accept.
          </p>
        </div>
      )}

      {isLoading || membersLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : members.length === 0 && invites.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">No members yet.</div>
      ) : (
        <div className="divide-y divide-border/50">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              myRole={myRole}
              isSelf={m.user_id === user?.id}
              orgId={orgId!}
            />
          ))}
          {canInvite &&
            orgId &&
            invites.map((inv) => <PendingInviteRow key={inv.id} invite={inv} orgId={orgId} />)}
        </div>
      )}
    </div>
  );
}

function MemberRow({
  member: m,
  myRole,
  isSelf,
  orgId,
}: {
  member: MemberWithProfile;
  myRole: MemberRole | null;
  isSelf: boolean;
  orgId: string;
}) {
  const removeMember = useRemoveMember();
  const transfer = useTransferOwnership();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [showAccess, setShowAccess] = useState(false);

  const displayName = m.profile?.full_name ?? m.profile?.email ?? "Unknown";
  const canRemove = !isSelf && m.role !== "owner" && canManageMember(myRole, m.role);
  const canMakeOwner = myRole === "owner" && !isSelf && m.status === "active";
  // A workspace owner can never be restricted, so there's nothing to configure
  // on their row.
  const canEditAccess = m.role !== "owner" && canManageMember(myRole, m.role);

  async function handleRemove() {
    try {
      await removeMember.mutateAsync({ memberId: m.id, organizationId: orgId });
      setConfirmRemove(false);
      toast.success(`${displayName} was removed from the workspace.`);
    } catch (e) {
      toast.error(friendlyOrgError(e));
    }
  }

  async function handleTransfer() {
    try {
      await transfer.mutateAsync({ organizationId: orgId, newOwnerUserId: m.user_id });
      setConfirmTransfer(false);
      toast.success(`${displayName} is now the workspace owner.`);
    } catch (e) {
      toast.error(friendlyOrgError(e));
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 px-6 hover:bg-surface-2 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
          {m.profile?.avatar_initials ?? m.profile?.email?.slice(0, 2).toUpperCase() ?? "??"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{displayName}</span>
            {isSelf && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                You
              </span>
            )}
            {m.status === "pending" && (
              <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-medium text-amber-500 uppercase tracking-wider">
                Pending
              </span>
            )}
            {m.status === "inactive" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                Inactive
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{m.profile?.email}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {m.role === "owner" ? (
            <Crown className="h-3 w-3 text-amber-500" />
          ) : m.role === "admin" ? (
            <Shield className="h-3 w-3" />
          ) : (
            <Users className="h-3 w-3" />
          )}
          {ROLE_LABELS[m.role]}
        </div>

        {canMakeOwner && (
          <button
            onClick={() => setConfirmTransfer(true)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
            title="Transfer ownership to this member"
          >
            Make owner
          </button>
        )}

        {canEditAccess && (
          <button
            onClick={() => setShowAccess((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            title="Manage per-section access"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Access
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showAccess ? "rotate-180" : ""}`}
            />
          </button>
        )}

        {canRemove && (
          <button
            onClick={() => setConfirmRemove(true)}
            className="text-muted-foreground hover:text-red-500 transition-colors"
            title="Remove from workspace"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {showAccess && canEditAccess && <SectionAccessEditor member={m} orgId={orgId} />}

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {displayName}?</DialogTitle>
            <DialogDescription>
              They will immediately lose access to this workspace. You can invite them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmRemove(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleRemove}
              disabled={removeMember.isPending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {removeMember.isPending ? "Removing…" : "Remove member"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmTransfer} onOpenChange={setConfirmTransfer}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer ownership to {displayName}?</DialogTitle>
            <DialogDescription>
              They become the workspace owner and you become an admin. Only they will be able to
              delete the workspace or transfer ownership back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmTransfer(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleTransfer}
              disabled={transfer.isPending}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            >
              {transfer.isPending ? "Transferring…" : "Transfer ownership"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const SECTION_LEVEL_LABELS: Record<SectionLevel, string> = {
  none: "None",
  view: "View",
  edit: "Edit",
};

function SectionAccessEditor({ member: m, orgId }: { member: MemberWithProfile; orgId: string }) {
  const updateAccess = useUpdateMemberSectionAccess();
  const [busySection, setBusySection] = useState<Section | null>(null);

  async function setLevel(section: Section, level: SectionLevel) {
    if (resolveSectionAccess(m.role, m.section_access, section) === level) return;
    setBusySection(section);
    try {
      await updateAccess.mutateAsync({
        memberId: m.id,
        organizationId: orgId,
        section,
        level,
        currentAccess: m.section_access,
      });
    } catch (e) {
      toast.error(friendlyOrgError(e));
    } finally {
      setBusySection(null);
    }
  }

  return (
    <div className="w-full rounded-lg border border-border bg-surface-2 p-3">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Overrides {ROLE_LABELS[m.role]}'s default access for{" "}
        {m.profile?.full_name ?? m.profile?.email}, section by section.
      </p>
      <div className="space-y-1.5">
        {SECTIONS.map((section) => {
          const level = resolveSectionAccess(m.role, m.section_access, section.id);
          return (
            <div key={section.id} className="flex items-center justify-between gap-3">
              <span className="text-xs text-foreground">{section.label}</span>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {(["none", "view", "edit"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => void setLevel(section.id, option)}
                    disabled={busySection === section.id}
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      level === option
                        ? option === "edit"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : option === "view"
                            ? "bg-amber-500/15 text-amber-500"
                            : "bg-muted text-muted-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {SECTION_LEVEL_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PendingInviteRow({
  invite: inv,
  orgId,
}: {
  invite: OrganizationInvitation;
  orgId: string;
}) {
  const resend = useResendOrgInvite();
  const revoke = useRevokeOrgInvite();
  const [busy, setBusy] = useState(false);

  async function handleResend() {
    setBusy(true);
    try {
      const res = await resend.mutateAsync({ invitationId: inv.id, organizationId: orgId });
      toast.success(
        res.emailSent
          ? `Invitation re-sent to ${inv.email}.`
          : "Invitation refreshed, but the email could not be sent.",
      );
    } catch (e) {
      toast.error(friendlyOrgError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    try {
      await revoke.mutateAsync({ invitationId: inv.id, organizationId: orgId });
      toast.success("Invitation revoked.");
    } catch (e) {
      toast.error(friendlyOrgError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 px-6 hover:bg-surface-2 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{inv.email}</span>
            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-medium text-amber-500 uppercase tracking-wider">
              Pending
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {ROLE_LABELS[inv.role]} · invited {formatDate(inv.created_at)} · expires{" "}
            {formatDate(inv.expires_at)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleResend}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className="h-3 w-3" /> Resend
        </button>
        <button
          onClick={handleRevoke}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-60"
        >
          <X className="h-3 w-3" /> Revoke
        </button>
      </div>
    </div>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────────
function DangerZoneCard() {
  const { user, currentOrg, refresh } = useAuth();
  const { myRole } = useMyRole();
  const { data: members = [] } = useOrgMembers(currentOrg?.id);
  const leave = useLeaveOrganization();
  const deleteOrg = useDeleteOrganization();

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const activeOwners = members.filter((m) => m.role === "owner" && m.status === "active").length;
  const isLastOwner = myRole === "owner" && activeOwners <= 1;
  const canDelete = can(myRole, "org:delete");

  async function handleLeave() {
    if (!currentOrg || !user) return;
    try {
      await leave.mutateAsync({ organizationId: currentOrg.id, userId: user.id });
      setConfirmLeave(false);
      toast.success(`You left ${currentOrg.name}.`);
      await refresh();
    } catch (e) {
      toast.error(friendlyOrgError(e));
    }
  }

  async function handleDelete() {
    if (!currentOrg) return;
    try {
      await deleteOrg.mutateAsync({ organizationId: currentOrg.id });
      setConfirmDelete(false);
      toast.success(`Workspace "${currentOrg.name}" was deleted.`);
      await refresh();
    } catch (e) {
      toast.error(friendlyOrgError(e));
    }
  }

  return (
    <div className="rounded-xl border border-red-500/30 bg-surface overflow-hidden">
      <div className="border-b border-red-500/20 p-6">
        <h3 className="font-medium text-red-500">Danger Zone</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          These actions can't be undone. Be careful.
        </p>
      </div>
      <div className="divide-y divide-border/50">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 px-6">
          <div>
            <div className="text-sm font-medium">Leave this workspace</div>
            <div className="text-xs text-muted-foreground">
              {isLastOwner
                ? "You're the only owner — transfer ownership to someone first."
                : "You'll lose access until someone invites you back."}
            </div>
          </div>
          <button
            onClick={() => setConfirmLeave(true)}
            disabled={isLastOwner}
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Leave workspace
          </button>
        </div>

        {canDelete && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 px-6">
            <div>
              <div className="text-sm font-medium">Delete this workspace</div>
              <div className="text-xs text-muted-foreground">
                Permanently deletes {currentOrg?.name}, its members, documents, and results.
              </div>
            </div>
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Delete workspace
            </button>
          </div>
        )}
      </div>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {currentOrg?.name}?</DialogTitle>
            <DialogDescription>
              You'll immediately lose access to this workspace and everything in it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmLeave(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleLeave}
              disabled={leave.isPending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {leave.isPending ? "Leaving…" : "Leave workspace"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (!open) setDeleteText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {currentOrg?.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the workspace, all members, documents, extractions, and
              billing history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Type <span className="font-mono font-medium text-foreground">{currentOrg?.name}</span>{" "}
              to confirm.
            </p>
            <input
              type="text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              className={`w-full ${inputClass}`}
              placeholder={currentOrg?.name}
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteText !== currentOrg?.name || deleteOrg.isPending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleteOrg.isPending ? "Deleting…" : "Delete permanently"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
