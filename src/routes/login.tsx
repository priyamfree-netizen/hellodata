import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Mail, Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getTokenPayload, type MfaMethod } from "@/lib/auth/client";
import { getPendingInvite } from "@/lib/pending-invite";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const { status, login, completeMfa, resendMfaCode } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // MFA challenge state (set when the server asks for a second factor)
  const [mfa, setMfa] = useState<{ token: string; method: MfaMethod } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  useEffect(() => {
    if (status === "ready") {
      const payload = getTokenPayload();
      if (payload?.is_super_admin) void navigate({ to: "/admin" });
      else void navigate({ to: "/dashboard" });
    } else if (status === "no_workspace") {
      const pendingToken = getPendingInvite();
      if (pendingToken) void navigate({ to: "/invite", search: { token: pendingToken } });
      else void navigate({ to: "/onboarding" });
    } else if (status === "backend_error") setSubmitting(false);
  }, [status, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.status === "mfa") {
        setMfa({ token: result.challengeToken, method: result.method });
        setMfaCode("");
        setMfaError(null);
        setResendNote(result.method === "email" ? "We emailed you a 6-digit code." : null);
        setSubmitting(false);
        return;
      }
      // status === "ok": navigation handled by the status useEffect above
    } catch (e: unknown) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : "Login failed");
    }
  }

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfa || mfaCode.length !== 6) return;
    setMfaError(null);
    setMfaSubmitting(true);
    try {
      await completeMfa(mfa.token, mfaCode);
      // Navigation handled by the status useEffect above
    } catch (e: unknown) {
      setMfaSubmitting(false);
      setMfaError(e instanceof Error ? e.message : "Verification failed");
    }
  }

  async function handleResend() {
    if (!mfa) return;
    setMfaError(null);
    setResendNote(null);
    try {
      await resendMfaCode(mfa.token);
      setResendNote("A new code is on its way to your inbox.");
    } catch (e: unknown) {
      setMfaError(e instanceof Error ? e.message : "Could not resend the code");
    }
  }

  function handleGoogleOAuth() {
    window.location.href = "/api/auth/oauth/google";
  }

  // While auth is still bootstrapping, show a spinner. Also covers the brief
  // window between a successful signInWithPassword and the AuthProvider
  // catching up — the user never sees an inert form.
  if (status === "loading" || status === "ready" || status === "no_workspace") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-foreground" />
          <p className="text-sm">
            {status === "loading" ? "Checking your session…" : "Signing you in…"}
          </p>
        </div>
      </div>
    );
  }

  // ── Second-factor challenge ──────────────────────────────────────────────────
  if (mfa) {
    return (
      <div className="flex min-h-screen bg-background">
        <div className="m-auto w-full max-w-[400px] p-6">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Two-step verification
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {mfa.method === "email"
                ? "Enter the 6-digit code we sent to your email."
                : "Enter the 6-digit code from your authenticator app."}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-8 shadow-sm">
            <form className="space-y-4" onSubmit={handleVerifyMfa}>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full rounded-lg border border-border bg-background px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
              />

              {mfaError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                  {mfaError}
                </div>
              )}
              {!mfaError && resendNote && (
                <p className="text-xs text-muted-foreground">{resendNote}</p>
              )}

              <button
                type="submit"
                disabled={mfaSubmitting || mfaCode.length !== 6}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {mfaSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Verify <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-xs">
              {mfa.method === "email" ? (
                <button
                  type="button"
                  onClick={handleResend}
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-500"
                >
                  <Mail className="h-3.5 w-3.5" /> Resend code
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" /> Authenticator app
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setMfa(null);
                  setMfaCode("");
                  setMfaError(null);
                  setError(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                Back to login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="m-auto w-full max-w-[400px] p-6">
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white mb-4">
            L
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Log in to your HelloData workspace</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-8 shadow-sm">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/90">
                Work Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-foreground/90">Password</label>
                <Link to="/forgot-password" className="text-xs text-blue-600 hover:text-blue-500">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-3 pr-10 text-sm text-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Sign in <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">OR CONTINUE WITH</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleOAuth}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <Mail className="h-4 w-4" /> Google
            </button>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/signup" className="font-medium text-foreground hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
