import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, KeyRound, Mail } from "lucide-react";
import { TwoFactorCard } from "@/components/two-factor-card";

export const Route = createFileRoute("/admin/admin-tools")({
  component: AdminTools,
});

function AdminTools() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin Tools</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground/80">
          Security controls for your super-admin account
        </p>
      </div>

      {/* Account security */}
      <div className="max-w-2xl space-y-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Account security
        </div>

        <TwoFactorCard />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
            <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Authenticator app (TOTP)</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Time-based codes from Google Authenticator, 1Password, Authy, etc.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
            <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Email one-time codes</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A 6-digit code is emailed each time you sign in.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
