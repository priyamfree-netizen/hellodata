import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getPendingInvite } from "@/lib/pending-invite";

/**
 * Gates protected content based on AuthProvider's status. This is the single
 * place that decides "can the user see this page?" — guards no longer make
 * network calls, so there's nothing left to race.
 */
export function RequireWorkspace({ children }: { children: React.ReactNode }) {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "unauthenticated") {
      void navigate({ to: "/login" });
    } else if (status === "no_workspace") {
      const pendingToken = getPendingInvite();
      if (pendingToken) void navigate({ to: "/invite", search: { token: pendingToken } });
      else void navigate({ to: "/onboarding" });
    }
  }, [status, navigate]);

  if (status === "loading") return <FullPageSpinner label="Loading your workspace…" onRetry={refresh} />;
  if (status === "unauthenticated") return <FullPageSpinner label="Redirecting to sign in…" />;
  if (status === "no_workspace") return <FullPageSpinner label="Setting up your workspace…" />;
  if (status === "backend_error") return <BackendErrorScreen onRetry={refresh} />;
  return <>{children}</>;
}

/**
 * Spinner that escalates to a retry button after 6 seconds. Users always have
 * something to do other than wait — particularly important when the backend
 * is slow or intermittent.
 */
function FullPageSpinner({
  label,
  onRetry,
}: {
  label: string;
  onRetry?: () => Promise<void>;
}) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStale(true), 6_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-foreground" />
        <p className="text-sm">{label}</p>
        {stale && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground/70">
              This is taking longer than usual.
            </p>
            {onRetry && (
              <button
                onClick={() => void onRetry()}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BackendErrorScreen({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          We couldn't reach the server
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is fine — we just couldn't load your workspace right now.
          Check your connection and try again.
        </p>
        <div className="mt-6">
          <button
            onClick={() => void onRetry()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
