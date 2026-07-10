import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Smartphone, Mail, Loader2, Check } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getAccessToken, silentRefresh } from "@/lib/auth/client";

async function authFetch<T>(path: string, body?: unknown): Promise<T> {
  let token = getAccessToken();
  if (!token) {
    await silentRefresh();
    token = getAccessToken();
  }
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

type Mode = "idle" | "choose" | "totp" | "email";

/**
 * Self-contained Two-Factor Authentication card. Reads the current state from
 * the auth profile and drives enroll (TOTP or email OTP) and disable flows.
 * Used both in user Settings and the superadmin Admin Tools page.
 */
export function TwoFactorCard() {
  const { profile, refresh } = useAuth();
  const enabled = !!profile?.two_factor_enabled;
  const activeMethod = profile?.two_factor_method ?? null;

  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TOTP enroll
  const [uri, setUri] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");

  // shared code input
  const [code, setCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  function reset() {
    setMode("idle");
    setError(null);
    setCode("");
    setUri("");
    setSecret("");
    setFactorId("");
    setEmailSent(false);
    setBusy(false);
  }

  async function startTotp() {
    setError(null);
    setBusy(true);
    try {
      const data = await authFetch<{ factor_id: string; uri: string; secret: string }>(
        "/api/auth/mfa/enroll",
      );
      setFactorId(data.factor_id);
      setSecret(data.secret);
      setUri(data.uri ?? "");
      setCode("");
      setMode("totp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp() {
    setError(null);
    setBusy(true);
    try {
      await authFetch("/api/auth/mfa/verify", { factor_id: factorId, code });
      await refresh();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
      setBusy(false);
    }
  }

  async function startEmail() {
    setError(null);
    setBusy(true);
    try {
      await authFetch("/api/auth/mfa/email/start");
      setEmailSent(true);
      setCode("");
      setMode("email");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail() {
    setError(null);
    setBusy(true);
    try {
      await authFetch("/api/auth/mfa/email/verify", { code });
      await refresh();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
      setBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setBusy(true);
    try {
      await authFetch("/api/auth/mfa/disable");
      await refresh();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable 2FA.");
      setBusy(false);
    }
  }

  const methodLabel =
    activeMethod === "email"
      ? "email codes"
      : activeMethod === "totp"
        ? "an authenticator app"
        : "";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border p-6">
        <h3 className="font-medium">Two-Factor Authentication</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Add an extra layer of security. Choose an authenticator app or one-time codes sent to your
          email.
        </p>
      </div>

      <div className="p-6">
        {/* Idle — status + entry points */}
        {mode === "idle" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {enabled ? "2FA is enabled" : "2FA is not enabled"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {enabled
                    ? `You'll be asked for a code from ${methodLabel} when you sign in.`
                    : "Protect your account with a second step at sign-in."}
                </p>
              </div>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {enabled ? (
              <button
                onClick={disable}
                disabled={busy}
                className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-60"
              >
                {busy ? "Disabling…" : "Disable 2FA"}
              </button>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={startTotp}
                  disabled={busy}
                  className="flex items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-foreground/30 disabled:opacity-60"
                >
                  <Smartphone className="mt-0.5 h-4 w-4 text-foreground" />
                  <span>
                    <span className="block text-sm font-medium">Authenticator app</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Google Authenticator, 1Password, Authy…
                    </span>
                  </span>
                </button>
                <button
                  onClick={startEmail}
                  disabled={busy}
                  className="flex items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-foreground/30 disabled:opacity-60"
                >
                  <Mail className="mt-0.5 h-4 w-4 text-foreground" />
                  <span>
                    <span className="block text-sm font-medium">Email codes</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      One-time codes sent to your inbox
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* TOTP enrollment */}
        {mode === "totp" && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
            </p>
            {uri && (
              <div className="inline-flex rounded-lg border border-border bg-white p-3">
                <QRCodeSVG value={uri} size={160} level="M" />
              </div>
            )}
            <p className="font-mono text-xs text-muted-foreground">
              Manual key: <span className="select-all text-foreground">{secret}</span>
            </p>
            <CodeInput value={code} onChange={setCode} />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={verifyTotp}
                disabled={code.length !== 6 || busy}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Verify & enable
              </button>
              <button onClick={reset} className="rounded-lg border border-border px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Email enrollment */}
        {mode === "email" && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {emailSent
                ? `We sent a 6-digit code to ${profile?.email ?? "your email"}. Enter it below to confirm.`
                : "Sending a code to your email…"}
            </p>
            <CodeInput value={code} onChange={setCode} />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={verifyEmail}
                disabled={code.length !== 6 || busy}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Verify & enable
              </button>
              <button
                onClick={startEmail}
                disabled={busy}
                className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-60"
              >
                Resend code
              </button>
              <button onClick={reset} className="rounded-lg border border-border px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="000000"
      maxLength={6}
      className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-sm tracking-[0.3em] outline-none focus:border-blue-500"
    />
  );
}
