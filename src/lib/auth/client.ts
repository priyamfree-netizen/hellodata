/**
 * Frontend auth client.
 *
 * - Access token lives in JS memory only (cleared when tab closes).
 * - Refresh token lives in an HttpOnly cookie — never readable by JS.
 * - A silent refresh is scheduled 60s before the access token expires.
 * - All functions throw on network / auth errors so callers can handle them.
 */

export interface TokenPayload {
  sub: string;
  email: string;
  aud: "authenticated";
  role: "authenticated";
  org_ids: string[];
  is_super_admin: boolean;
  iat: number;
  exp: number;
}

interface SilentRefreshOptions {
  requireSessionHint?: boolean;
}

let _accessToken: string | null = null;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _onTokenChange: (() => void) | null = null;
// Deduplicates concurrent silentRefresh calls so that only one HTTP request is
// in-flight at a time. Without this, two callers (e.g. AuthProvider bootstrap
// and a TanStack Query) can race to rotate the same one-time-use refresh token
// cookie — the loser gets 401 and incorrectly wipes the in-memory token.
let _refreshPromise: Promise<TokenPayload | null> | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  return _accessToken;
}

export function getTokenPayload(): TokenPayload | null {
  if (!_accessToken) return null;
  try {
    return JSON.parse(atob(_accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)billsos-session=1(?:;|$)/.test(document.cookie);
}

/** Called by AuthProvider so it re-renders when the token changes. */
export function onTokenChange(cb: () => void) {
  _onTokenChange = cb;
}

export type MfaMethod = "totp" | "email";

export type LoginResult =
  | { status: "ok"; payload: TokenPayload }
  | { status: "mfa"; challengeToken: string; method: MfaMethod };

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    mfa_required?: boolean;
    challenge_token?: string;
    method?: MfaMethod;
  };
  if (!res.ok) throw new Error(data.error ?? "Login failed");
  if (data.mfa_required && data.challenge_token) {
    return { status: "mfa", challengeToken: data.challenge_token, method: data.method ?? "totp" };
  }
  _setToken(data.access_token!);
  return { status: "ok", payload: getTokenPayload()! };
}

/** Exchange a login challenge + second-factor code for a real session. */
export async function verifyMfaChallenge(
  challengeToken: string,
  code: string,
): Promise<TokenPayload> {
  const res = await fetch("/api/auth/mfa/challenge/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ challenge_token: challengeToken, code }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Verification failed");
  _setToken(data.access_token!);
  return getTokenPayload()!;
}

/** Re-send the email OTP for an in-progress login challenge. */
export async function resendMfaChallengeCode(challengeToken: string): Promise<void> {
  const res = await fetch("/api/auth/mfa/challenge/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ challenge_token: challengeToken }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Could not resend the code");
  }
}

export async function logout(): Promise<void> {
  _clearToken();
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
}

/**
 * Attempt a silent token refresh using the HttpOnly refresh cookie.
 * Returns the new payload on success, null if there is no valid session.
 *
 * Concurrent calls share the same in-flight promise so the one-time-use
 * refresh token cookie is never rotated twice simultaneously.
 */
export async function silentRefresh(
  options: SilentRefreshOptions = {},
): Promise<TokenPayload | null> {
  if (options.requireSessionHint && !hasSessionHint()) {
    _clearToken();
    return null;
  }

  // Reuse an in-flight refresh if one is already running.
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = _doRefresh();
  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

async function _doRefresh(): Promise<TokenPayload | null> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (!res.ok) {
      _clearToken();
      return null;
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      _clearToken();
      return null;
    }
    _setToken(data.access_token);
    return getTokenPayload()!;
  } catch {
    _clearToken();
    return null;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _setToken(token: string) {
  _accessToken = token;
  _scheduleRefresh(token);
  _onTokenChange?.();
}

function _clearToken() {
  _accessToken = null;
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
  _onTokenChange?.();
}

function _scheduleRefresh(token: string) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  const payload = getTokenPayload();
  if (!payload) return;
  const msUntilExpiry = payload.exp * 1000 - Date.now();
  const delay = Math.max(msUntilExpiry - 60_000, 10_000); // 60s before expiry
  _refreshTimer = setTimeout(() => void silentRefresh(), delay);
}
