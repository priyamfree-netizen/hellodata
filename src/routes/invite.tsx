import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/context";
import { useAcceptOrgInvite } from "@/lib/queries";
import { clearPendingInvite, stashPendingInvite } from "@/lib/pending-invite";

export const Route = createFileRoute("/invite")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useSearch();
  const { status, user, refresh } = useAuth();
  const accept = useAcceptOrgInvite();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // Stash the token so it survives a signup/login detour: an unauthenticated
  // visitor who clicks "Create account" below loses this URL entirely, and
  // would otherwise be forced through onboarding's "create a workspace" form
  // before ever getting back here.
  useEffect(() => {
    if (token) stashPendingInvite(token);
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    setError(null);
    try {
      const res = await accept.mutateAsync({ token });
      clearPendingInvite();
      await refresh();
      toast.success(
        res.alreadyMember
          ? `You're already a member of ${res.organization.name}.`
          : `Welcome to ${res.organization.name}!`,
      );
      void navigate({ to: "/dashboard" });
    } catch (e) {
      clearPendingInvite();
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600/10">
          <Building2 className="h-6 w-6 text-blue-500" />
        </div>
        <h1 className="text-lg font-semibold">Workspace invitation</h1>

        {!token ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              This invite link is missing its code. Open the link from the invitation email again,
              or ask the sender for a new invite.
            </p>
            <Link
              to="/dashboard"
              className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Go to dashboard
            </Link>
          </>
        ) : status === "loading" ? (
          <div className="mt-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : status === "unauthenticated" ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              You've been invited to join a workspace on HelloData. Sign in with the email address the
              invitation was sent to — or create an account with it — then open this link again.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                to="/login"
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Create account
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              You're signed in as <span className="font-medium text-foreground">{user?.email}</span>
              . Accept the invitation to join the workspace.
            </p>
            {error && (
              <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={handleAccept}
                disabled={accept.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {accept.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Accept invitation
              </button>
              <Link
                to="/dashboard"
                onClick={() => clearPendingInvite()}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Not now
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
