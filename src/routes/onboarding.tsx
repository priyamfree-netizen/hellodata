import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Loader2, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth-guards";
import { useAuth } from "@/lib/auth/context";
import { useCreateOrganization } from "@/lib/queries";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Set up your workspace — HelloData" }] }),
  component: Onboarding,
});

function Onboarding() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const createOrg = useCreateOrganization();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // If the user already has a workspace, they don't belong here.
  useEffect(() => {
    if (status === "ready") void navigate({ to: "/dashboard" });
  }, [status, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await createOrg.mutateAsync({ name: name.trim() });
    } catch (err) {
      // Surface the real Supabase/PostgREST error message so it's visible.
      // RLS violations come back as "new row violates row-level security policy"
      // — if that happens it means the DB migration hasn't been applied yet.
      const raw =
        err instanceof Error
          ? err.message
          : (err as { message?: string } | null)?.message;
      const msg = raw ?? "Failed to create workspace. Please try again.";
      console.error("[onboarding] createOrg failed:", err);
      setError(msg);
      return;
    }
    // refresh() updates the auth context's status to 'ready'; the effect above
    // (or RequireWorkspace once we hit /dashboard) will navigate us there.
    try { await refresh(); } catch {}
    void navigate({ to: "/dashboard" });
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "backend_error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            We couldn't check your account
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn't reach the server to see whether you already have a workspace.
            Try again in a moment.
          </p>
          <button
            onClick={() => void refresh()}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // status === 'ready' is handled by the useEffect above (redirecting away).
  // 'unauthenticated' shouldn't happen here (requireAuth guard catches it).
  // That leaves 'no_workspace' — render the form.

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Give your organization a name to get started with HelloData.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="org-name" className="block text-sm font-medium text-foreground">
              Organization name
            </label>
            <input
              id="org-name"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={createOrg.isPending || !name.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {createOrg.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create workspace
          </button>
        </form>
      </div>
    </div>
  );
}
