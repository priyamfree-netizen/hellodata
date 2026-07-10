import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  Monitor,
  Smartphone,
  Globe,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { TwoFactorCard } from "@/components/two-factor-card";
import {
  useUpdateProfile,
  useChangePassword,
  useDeleteAccount,
  useMyActiveSessions,
  useRevokeSession,
} from "@/lib/queries";

export const Route = createFileRoute("/settings/")({
  component: ProfileSettings,
});

function ProfileSettings() {
  const { profile, refresh } = useAuth();
  const navigate = useNavigate();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const deleteAccount = useDeleteAccount();
  const { data: sessions = [] } = useMyActiveSessions();
  const revokeSession = useRevokeSession();

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [saved, setSaved] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [pwdSaved, setPwdSaved] = useState(false);
  const [pwdError, setPwdError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    if (profile) {
      setFirst(profile.first_name ?? "");
      setLast(profile.last_name ?? "");
    }
  }, [profile]);

  async function handleSave() {
    if (!profile) return;
    await updateProfile.mutateAsync({
      id: profile.id,
      patch: { first_name: first, last_name: last },
    });
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleChangePassword() {
    setPwdError("");
    if (!oldPassword) {
      setPwdError("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setPwdError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError("Passwords do not match.");
      return;
    }
    await changePassword.mutateAsync({ old_password: oldPassword, new_password: newPassword });
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPwdSaved(true);
    setTimeout(() => setPwdSaved(false), 2500);
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    await deleteAccount.mutateAsync();
    navigate({ to: "/login" });
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal information and preferences.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="border-b border-border p-6">
          <h3 className="font-medium">Personal Information</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            This info will be displayed on your profile.
          </p>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/90">
                First Name
              </label>
              <input
                type="text"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/90">
                Last Name
              </label>
              <input
                type="text"
                value={last}
                onChange={(e) => setLast(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/90">
              Email Address
            </label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              To change your email address, contact support.
            </p>
          </div>
        </div>
        <div className="border-t border-border bg-surface-2 px-6 py-4 flex items-center justify-end gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={updateProfile.isPending}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {updateProfile.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="border-b border-border p-6">
          <h3 className="font-medium">Change Password</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a strong password for your account.
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/90">
              Current Password
            </label>
            <input
              type={showPwd ? "text" : "password"}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="Your current password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/90">
              New Password
            </label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/90">
              Confirm Password
            </label>
            <input
              type={showPwd ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          {pwdError && <p className="text-xs text-red-500">{pwdError}</p>}
        </div>
        <div className="border-t border-border bg-surface-2 px-6 py-4 flex items-center justify-end gap-3">
          {pwdSaved && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> Password updated
            </span>
          )}
          <button
            onClick={handleChangePassword}
            disabled={changePassword.isPending || !newPassword}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {changePassword.isPending ? "Updating…" : "Update Password"}
          </button>
        </div>
      </div>

      {/* 2FA */}
      <TwoFactorCard />

      {/* Active Sessions */}
      {sessions.length > 0 && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="border-b border-border p-6">
            <h3 className="font-medium">Active Sessions</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Devices currently signed in to your account. Revoke any you don't recognise.
            </p>
          </div>
          <div className="divide-y divide-border">
            {sessions.map((s) => {
              const sess = s as {
                id: string;
                device?: string;
                ip_address?: string;
                location?: string;
                last_seen_at?: string;
              };
              const DevIcon = sess.device?.toLowerCase().includes("mobile") ? Smartphone : Monitor;
              return (
                <div key={sess.id} className="flex items-center gap-3 px-6 py-4">
                  <DevIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {sess.device ?? "Unknown device"}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      {sess.ip_address && <span className="font-mono">{sess.ip_address}</span>}
                      {sess.location && (
                        <>
                          <Globe className="h-3 w-3" />
                          <span>{sess.location}</span>
                        </>
                      )}
                      {sess.last_seen_at && (
                        <span>
                          ·{" "}
                          {new Date(sess.last_seen_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => revokeSession.mutate(sess.id)}
                    disabled={revokeSession.isPending}
                    className="flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-xs text-red-500 hover:bg-red-500/15 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" /> Revoke
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-red-500/20 bg-surface overflow-hidden">
        <div className="border-b border-red-500/20 p-6">
          <h3 className="font-medium text-red-500">Danger Zone</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Irreversible actions for your account.
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-sm font-medium">Delete Account</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Permanently delete your account and all data. Type{" "}
                <span className="font-mono font-semibold">DELETE</span> to confirm.
              </p>
            </div>
          </div>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            className="w-full rounded-lg border border-red-500/20 bg-background px-3 py-2 text-sm outline-none focus:border-red-500"
          />
          <button
            onClick={handleDeleteAccount}
            disabled={deleteConfirm !== "DELETE" || deleteAccount.isPending}
            className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleteAccount.isPending ? "Deleting…" : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
