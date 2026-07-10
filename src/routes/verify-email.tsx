import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle, MailCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { silentRefresh } from "@/lib/auth/client";
import { getPendingInvite } from "@/lib/pending-invite";

// TanStack Router search params schema
type VerifyEmailSearch = {
  email?: string;
};

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  component: VerifyEmail,
});

function VerifyEmail() {
  const { email: searchEmail } = Route.useSearch();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [email, setEmail] = useState(searchEmail ?? "");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  function handleOtpChange(index: number, value: string) {
    // Handle paste of full OTP
    if (value.length === 6 && /^\d{6}$/.test(value)) {
      const digits = value.split("");
      setOtp(digits);
      inputRefs.current[5]?.focus();
      return;
    }
    // Only allow single digit
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) { setError("Please enter the full 6-digit code"); return; }
    if (!email) { setError("Email is required"); return; }

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await res.json() as { error?: string; access_token?: string };

      if (!res.ok) {
        setError(data.error ?? "Verification failed. Please try again.");
        setSubmitting(false);
        return;
      }

      // The server set the refresh cookie — bootstrap the session via silentRefresh
      // so the auth context picks up the user without a hard page reload.
      await silentRefresh();
      await refresh();

      setSuccess(true);
      setTimeout(() => {
        const pendingToken = getPendingInvite();
        if (pendingToken) void navigate({ to: "/invite", search: { token: pendingToken } });
        else void navigate({ to: "/onboarding" });
      }, 1500);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!email) { setError("Enter your email address first"); return; }
    setResending(true);
    setResendMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json() as { message?: string; error?: string };
      setResendMessage(data.message ?? "A new code has been sent.");
    } catch {
      setError("Could not resend the code. Please try again.");
    } finally {
      setResending(false);
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Email verified!</h1>
          <p className="mt-2 text-sm text-muted-foreground">Redirecting you to your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="m-auto w-full max-w-[400px] p-6">
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
            <MailCheck className="h-6 w-6 text-blue-500" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a 6-digit code to{" "}
            {email ? (
              <span className="font-medium text-foreground">{email}</span>
            ) : (
              "your email address"
            )}
            . Enter it below to verify your account.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-8 shadow-sm">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* Email field — shown when no email in URL */}
            {!searchEmail && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground/90">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                />
              </div>
            )}

            {/* OTP inputs */}
            <div>
              <label className="mb-3 block text-xs font-medium text-foreground/90">
                Verification code
              </label>
              <div className="flex gap-2 justify-between">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className="h-12 w-12 rounded-lg border border-border bg-background text-center text-lg font-semibold text-foreground outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    aria-label={`Digit ${i + 1}`}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            {resendMessage && (
              <p className="text-xs text-green-600">{resendMessage}</p>
            )}

            <button
              type="submit"
              disabled={submitting || otp.join("").length !== 6}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify email"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            Didn't receive a code?{" "}
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="font-medium text-blue-600 hover:underline disabled:opacity-60"
            >
              {resending ? "Sending…" : "Resend code"}
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Wrong account?{" "}
          <a href="/signup" className="font-medium text-foreground hover:underline">
            Back to sign up
          </a>
        </p>
      </div>
    </div>
  );
}
