# BillSOS — Supabase Auth → Custom JWT Migration Plan

## Overview

We are removing Supabase Auth completely and replacing it with a custom JWT-based auth system.
Supabase continues to be used as a plain Postgres database and S3-compatible storage — nothing else changes there.

### What changes
| Layer | Before | After |
|---|---|---|
| Who issues JWTs | Supabase Auth | Your own API (Cloudflare Worker) |
| Password hashes | `auth.users` (Supabase internal) | `profiles.password_hash` (bcrypt) |
| Session storage | Supabase session cookie | `HttpOnly; Secure; SameSite=Strict` cookie you control |
| Token refresh | Supabase client auto-refresh | Your `/auth/refresh` endpoint |
| OAuth | Supabase OAuth flow | Direct OAuth 2.0 PKCE with Google / GitHub |
| MFA / TOTP | `supabase.auth.mfa.*` | `totp_factors` table + `otplib` library |
| RLS `auth.uid()` | Reads sub from Supabase JWT | Reads sub from your JWT — **no RLS changes needed** |

### What stays exactly the same
- All Supabase PostgREST database queries (`supabase.from(...).select()`)
- All RLS policies (they read `request.jwt.claims->>'sub'` — same field, different issuer)
- Supabase S3 storage access via service-role key
- `profiles`, `organizations`, `organization_members` table schema
- The `AuthContext` shape exposed to the frontend (`status`, `user`, `profile`, `orgs`, etc.)

---

## Phase 0 — Database migrations (non-breaking, run before any code changes)

### 0.1 — Add auth columns to `profiles`

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS password_hash         text,
  ADD COLUMN IF NOT EXISTS email_verified        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verify_token    text,
  ADD COLUMN IF NOT EXISTS email_verify_expires  timestamptz,
  ADD COLUMN IF NOT EXISTS pwd_reset_token       text,
  ADD COLUMN IF NOT EXISTS pwd_reset_expires     timestamptz;
```

### 0.2 — Create `oauth_accounts` table (replaces `auth.identities`)

```sql
CREATE TABLE oauth_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider         text NOT NULL,          -- 'google' | 'github'
  provider_user_id text NOT NULL,
  provider_email   text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);
```

### 0.3 — Create `refresh_tokens` table (replaces Supabase session management)

```sql
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,       -- SHA-256 of the raw token stored in cookie
  device       text,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now(),
  expires_at   timestamptz NOT NULL,       -- 30 days from creation
  revoked_at   timestamptz                 -- NULL = active
);

CREATE INDEX ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
```

### 0.4 — Create `totp_factors` table (replaces `supabase.auth.mfa.*`)

```sql
CREATE TABLE totp_factors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  secret        text NOT NULL,             -- AES-encrypted TOTP secret
  friendly_name text,
  verified      boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);
```

### 0.5 — Migrate existing users from `auth.users` → `profiles`

> Run this once from a Supabase SQL editor using the service role.
> It copies password hashes and email-verified status for all existing users.

```sql
UPDATE profiles p
SET
  password_hash  = a.encrypted_password,
  email_verified = a.email_confirmed_at IS NOT NULL
FROM auth.users a
WHERE a.id = p.id;

-- Migrate OAuth identities
INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email)
SELECT
  i.user_id,
  i.provider,
  i.id::text,
  i.identity_data->>'email'
FROM auth.identities i
ON CONFLICT DO NOTHING;
```

### 0.6 — Verify `auth.uid()` still works with your JWT

Supabase's `auth.uid()` SQL function reads `current_setting('request.jwt.claims', true)::json->>'sub'`.
Your JWT must set `sub` = the user's UUID (same value as `profiles.id`).
**No RLS changes are needed.**

```sql
-- Confirm the function definition (for your reference)
SELECT pg_get_functiondef('auth.uid()'::regprocedure);
```

---

## Phase 1 — Backend API (new Cloudflare Worker routes)

Create a new file: `src/api/auth.ts` (or split per endpoint).
All endpoints are server-side only — never expose secrets to the browser.

### Endpoints to build

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/signup` | Hash password, insert profile, send verification email |
| POST | `/api/auth/login` | Verify password, issue access + refresh tokens |
| POST | `/api/auth/logout` | Revoke refresh token, clear cookies |
| POST | `/api/auth/refresh` | Rotate refresh token, issue new access token |
| POST | `/api/auth/forgot-password` | Insert reset token, send email |
| POST | `/api/auth/reset-password` | Verify reset token, update password hash |
| GET  | `/api/auth/verify-email` | Verify email token, set `email_verified = true` |
| GET  | `/api/auth/oauth/:provider` | Redirect to Google / GitHub OAuth |
| GET  | `/api/auth/oauth/:provider/callback` | Handle OAuth callback, upsert user, issue tokens |
| POST | `/api/auth/mfa/enroll` | Generate TOTP secret, return QR URI |
| POST | `/api/auth/mfa/verify` | Verify TOTP code, mark factor verified |
| POST | `/api/auth/change-password` | Verify old password, update hash |
| DELETE | `/api/auth/account` | Delete account, revoke all tokens |

### 1.1 — JWT design

```
Access token:  HS256, signed with JWT_SECRET env var
Payload: { sub: userId, email, org_ids: [...], is_super_admin, iat, exp: now+15min }

Refresh token: random 32-byte hex, stored as SHA-256 hash in refresh_tokens table
Cookie name:   billsos-refresh
Cookie flags:  HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000
```

Access token is stored in memory (JS variable) on the client — never in a cookie or localStorage.
Refresh token lives in an `HttpOnly` cookie the browser sends automatically to `/api/auth/refresh`.

### 1.2 — Login endpoint (example implementation)

```typescript
// POST /api/auth/login
export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const { email, password } = await req.json();

  const { data: profile } = await getServiceClient(env)
    .from("profiles")
    .select("id, password_hash, email_verified, is_super_admin, current_org_id")
    .eq("email", email)
    .single();

  if (!profile?.password_hash) return error(401, "Invalid credentials");

  const valid = await bcrypt.compare(password, profile.password_hash);
  if (!valid) return error(401, "Invalid credentials");

  if (!profile.email_verified) return error(403, "Please verify your email first");

  // Load org memberships
  const { data: memberships } = await getServiceClient(env)
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", profile.id)
    .eq("status", "active");

  const orgIds = memberships?.map(m => m.organization_id) ?? [];

  // Issue access token (15 min)
  const accessToken = await signJwt({
    sub: profile.id,
    email,
    org_ids: orgIds,
    is_super_admin: profile.is_super_admin,
  }, env.JWT_SECRET, "15m");

  // Issue refresh token (30 days), store hash in DB
  const rawRefresh = crypto.randomUUID() + crypto.randomUUID();
  const hash = await sha256(rawRefresh);
  await getServiceClient(env).from("refresh_tokens").insert({
    user_id: profile.id,
    token_hash: hash,
    ip_address: req.headers.get("CF-Connecting-IP"),
    user_agent: req.headers.get("User-Agent"),
    expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  });

  return new Response(JSON.stringify({ access_token: accessToken, user_id: profile.id }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": refreshCookie(rawRefresh),
    },
  });
}
```

### 1.3 — Token refresh endpoint

```typescript
// POST /api/auth/refresh
export async function handleRefresh(req: Request, env: Env): Promise<Response> {
  const raw = getCookieValue(req, "billsos-refresh");
  if (!raw) return error(401, "No refresh token");

  const hash = await sha256(raw);

  const { data: stored } = await getServiceClient(env)
    .from("refresh_tokens")
    .select("id, user_id, expires_at, revoked_at")
    .eq("token_hash", hash)
    .single();

  if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
    return error(401, "Refresh token expired or revoked");
  }

  // Rotate: revoke old token, issue new one
  await getServiceClient(env)
    .from("refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", stored.id);

  // Re-load profile + orgs to get fresh claims
  const { data: profile } = await getServiceClient(env)
    .from("profiles")
    .select("id, email, is_super_admin")
    .eq("id", stored.user_id)
    .single();

  const { data: memberships } = await getServiceClient(env)
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", stored.user_id)
    .eq("status", "active");

  const orgIds = memberships?.map(m => m.organization_id) ?? [];

  const newAccess = await signJwt({
    sub: profile!.id,
    email: profile!.email,
    org_ids: orgIds,
    is_super_admin: profile!.is_super_admin,
  }, env.JWT_SECRET, "15m");

  const newRaw = crypto.randomUUID() + crypto.randomUUID();
  const newHash = await sha256(newRaw);
  await getServiceClient(env).from("refresh_tokens").insert({
    user_id: stored.user_id,
    token_hash: newHash,
    ip_address: req.headers.get("CF-Connecting-IP"),
    user_agent: req.headers.get("User-Agent"),
    expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  });

  return new Response(JSON.stringify({ access_token: newAccess }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": refreshCookie(newRaw),
    },
  });
}
```

### 1.4 — Environment variables needed

```
JWT_SECRET=<64-char random hex>           # Signs access tokens
TOTP_ENCRYPTION_KEY=<32-char random hex>  # AES-encrypts TOTP secrets at rest
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS # For verification / reset emails
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
VITE_APP_URL                              # Already exists
SUPABASE_SERVICE_ROLE_KEY                 # Already exists — used for all server DB calls
VITE_SUPABASE_URL                         # Already exists — keep for PostgREST
```

---

## Phase 2 — Frontend auth client (replaces `src/lib/supabase/auth.tsx`)

### 2.1 — New file: `src/lib/auth/client.ts`

This replaces `supabase.auth.*` calls. It manages the access token in memory and calls your API.

```typescript
// src/lib/auth/client.ts

let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export async function login(email: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",    // sends/receives the HttpOnly refresh cookie
  });
  if (!res.ok) throw new Error((await res.json()).error);
  const { access_token } = await res.json();
  setAccessToken(access_token);
  return access_token;
}

export async function logout() {
  clearRefreshTimer();
  accessToken = null;
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function refresh(): Promise<string | null> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    accessToken = null;
    return null;
  }
  const { access_token } = await res.json();
  setAccessToken(access_token);
  return access_token;
}

function setAccessToken(token: string) {
  accessToken = token;
  scheduleRefresh(token);
}

function scheduleRefresh(token: string) {
  clearRefreshTimer();
  try {
    // Decode exp from JWT payload (no signature verification needed client-side)
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresIn = payload.exp * 1000 - Date.now();
    // Refresh 60s before expiry
    const delay = Math.max(expiresIn - 60_000, 10_000);
    refreshTimer = setTimeout(() => void refresh(), delay);
  } catch {
    // Malformed token — just let it expire naturally
  }
}

function clearRefreshTimer() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}
```

### 2.2 — New file: `src/lib/auth/context.tsx` (replaces `src/lib/supabase/auth.tsx`)

The context shape stays **identical** — all components using `useAuth()` work without changes.

```typescript
// src/lib/auth/context.tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { getAccessToken, login as apiLogin, logout as apiLogout, refresh } from "./client";
import type { Organization, Profile } from "@/lib/supabase/types";

export type AuthStatus = "loading" | "unauthenticated" | "no_workspace" | "ready" | "backend_error";

// Context shape unchanged — every component continues to work
interface AuthContextValue {
  status: AuthStatus;
  loading: boolean;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  currentOrg: Organization | null;
  orgs: Organization[];
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setCurrentOrg: (orgId: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const superAdminCache = new Map<string, boolean>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrgState] = useState<Organization | null>(null);
  const [membershipError, setMembershipError] = useState(false);

  async function loadUserData(uid: string) {
    const token = getAccessToken();
    if (!token) return;

    const [{ data: p, error: pErr }, { data: memberships, error: mErr }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
        supabase.from("organization_members")
          .select("organization_id, organizations(*)")
          .eq("user_id", uid)
          .eq("status", "active"),
      ]);

    if (pErr || mErr) { setMembershipError(true); return; }

    setProfile((p as Profile) ?? null);
    if (p) superAdminCache.set(uid, !!(p as Profile).is_super_admin);

    const orgList: Organization[] = [];
    for (const m of memberships ?? []) {
      const o = (m as { organizations: Organization | Organization[] | null }).organizations;
      if (!o) continue;
      Array.isArray(o) ? orgList.push(...o) : orgList.push(o);
    }
    setOrgs(orgList);

    const wantedId = (p as Profile | null)?.current_org_id ?? orgList[0]?.id ?? null;
    setCurrentOrgState(orgList.find(o => o.id === wantedId) ?? orgList[0] ?? null);
    setMembershipError(false);
  }

  // Bootstrap: try to get a fresh access token from the HttpOnly refresh cookie
  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => {
      if (mounted) { setMembershipError(true); setLoading(false); }
    }, 10_000);

    (async () => {
      try {
        const token = await refresh();   // hits /api/auth/refresh with the cookie
        if (!mounted) return;
        if (token) {
          const payload = JSON.parse(atob(token.split(".")[1]));
          setUserId(payload.sub);
          setUserEmail(payload.email);
          await loadUserData(payload.sub);
        }
      } finally {
        if (mounted) { clearTimeout(timeout); setLoading(false); }
      }
    })();

    return () => { mounted = false; clearTimeout(timeout); };
  }, []);

  const status: AuthStatus = useMemo(() => {
    if (loading) return "loading";
    if (!userId) return "unauthenticated";
    if (membershipError) return "backend_error";
    if (orgs.length === 0) return "no_workspace";
    return "ready";
  }, [loading, userId, membershipError, orgs.length]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    loading,
    user: userId ? { id: userId, email: userEmail! } : null,
    profile,
    currentOrg,
    orgs,
    login: async (email, password) => {
      setLoading(true);
      try {
        const token = await apiLogin(email, password);
        const payload = JSON.parse(atob(token.split(".")[1]));
        setUserId(payload.sub);
        setUserEmail(payload.email);
        await loadUserData(payload.sub);
      } finally {
        setLoading(false);
      }
    },
    refresh: async () => {
      setLoading(true);
      try {
        const token = await refresh();
        if (token) {
          const payload = JSON.parse(atob(token.split(".")[1]));
          await loadUserData(payload.sub);
        }
      } finally {
        setLoading(false);
      }
    },
    signOut: async () => {
      if (userId) superAdminCache.delete(userId);
      await apiLogout();
      setUserId(null);
      setUserEmail(null);
      setProfile(null);
      setOrgs([]);
      setCurrentOrgState(null);
    },
    setCurrentOrg: async (orgId: string) => {
      if (profile?.id) {
        const { error } = await supabase.from("profiles")
          .update({ current_org_id: orgId }).eq("id", profile.id);
        if (error) throw error;
      }
      setCurrentOrgState(orgs.find(x => x.id === orgId) ?? null);
    },
  }), [status, loading, userId, userEmail, profile, currentOrg, orgs]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function useCurrentOrgId(): string | null {
  return useAuth().currentOrg?.id ?? null;
}
```

### 2.3 — Update Supabase client to attach access token

PostgREST needs the JWT in the `Authorization` header so RLS `auth.uid()` works.

```typescript
// src/lib/supabase/client.ts — change the global headers
import { getAccessToken } from "@/lib/auth/client";

cached = createClient(url, anonKey, {
  auth: {
    persistSession: false,    // we manage sessions ourselves now
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: { "x-client-info": "billsos-web" },
    fetch: async (input, init) => {
      // Attach the current access token to every PostgREST request
      const token = getAccessToken();
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new DOMException("Timeout", "TimeoutError")),
        15_000,
      );
      return fetch(input, { ...init, headers, signal: controller.signal })
        .finally(() => clearTimeout(timer));
    },
  },
});
```

### 2.4 — Update `src/routes/login.tsx`

Replace `supabase.auth.signInWithPassword` with `useAuth().login`:

```typescript
// Before
const { error } = await supabase.auth.signInWithPassword({ email, password });

// After
const { login } = useAuth();
await login(email, password);
// Navigation is handled by the status useEffect — no change there
```

### 2.5 — Update `src/routes/signup.tsx`

Replace `supabase.auth.signUp` with a fetch to `/api/auth/signup`:

```typescript
// Before
const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { first_name, last_name } } });

// After
const res = await fetch("/api/auth/signup", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, first_name, last_name }),
});
if (!res.ok) { const { error } = await res.json(); throw new Error(error); }
// Show "check your email" screen — same as before
```

### 2.6 — Update `src/lib/queries/index.ts`

| Current call | Replace with |
|---|---|
| `supabase.auth.getSession()` in `useMyActiveSessions` | Read `userId` from `useAuth().user.id` |
| `supabase.auth.updateUser({ password })` in `useChangePassword` | `fetch("/api/auth/change-password", ...)` |
| `supabase.auth.signOut()` in `useDeleteAccount` | `useAuth().signOut()` |
| `supabase.auth.mfa.enroll()` | `fetch("/api/auth/mfa/enroll", ...)` |
| `supabase.auth.mfa.challenge()` | `fetch("/api/auth/mfa/verify", ...)` |
| `supabase.auth.mfa.verify()` | `fetch("/api/auth/mfa/verify", ...)` |

### 2.7 — Delete files that become dead code

```
src/lib/supabase/cookie-storage.ts   ← replaced by HttpOnly cookie on the server
src/lib/supabase/auth.tsx            ← replaced by src/lib/auth/context.tsx
```

Update `__root.tsx` import:
```typescript
// Before
import { AuthProvider } from "@/lib/supabase/auth";
// After
import { AuthProvider } from "@/lib/auth/context";
```

### 2.8 — Update `src/lib/auth-guards.ts`

Replace `supabase.auth.getSession()` with a JWT decode of the in-memory token:

```typescript
import { getAccessToken } from "@/lib/auth/client";

function getSession() {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp * 1000 < Date.now()) return null;  // expired
    return payload;
  } catch { return null; }
}

export async function requireAuth() {
  if (typeof window === "undefined") return;
  if (!getSession()) throw redirect({ to: "/login" });
}

export async function requireSuperAdmin() {
  if (typeof window === "undefined") return;
  const session = getSession();
  if (!session) throw redirect({ to: "/login" });
  const uid = session.sub;
  const cached = superAdminCache.get(uid);
  if (cached === true) return;
  if (cached === false) throw redirect({ to: "/" });
  // cold navigation: check DB
  const { data } = await supabase.from("profiles")
    .select("is_super_admin").eq("id", uid).single();
  const isAdmin = !!data?.is_super_admin;
  superAdminCache.set(uid, isAdmin);
  if (!isAdmin) throw redirect({ to: "/" });
}
```

---

## Phase 3 — OAuth (Google + GitHub)

### 3.1 — OAuth flow (PKCE, server-side callback)

```
Browser → GET /api/auth/oauth/google
  → Your server generates state + code_verifier, stores in a short-lived cookie
  → Redirect to accounts.google.com with client_id, redirect_uri, code_challenge

Google → GET /api/auth/oauth/google/callback?code=...&state=...
  → Your server exchanges code for tokens
  → Fetch user profile from Google
  → Upsert profile + oauth_accounts in DB
  → Issue your own access + refresh tokens
  → Redirect to /dashboard with access token in URL fragment (or set cookie + redirect)
```

### 3.2 — Update `src/routes/login.tsx` OAuth buttons

```typescript
// Before
await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });

// After — just navigate to your own OAuth start endpoint
window.location.href = `/api/auth/oauth/google`;
```

---

## Phase 4 — Email flows

### 4.1 — Verification email

On signup (`/api/auth/signup`):
1. Insert profile with `email_verified = false`
2. Generate a 32-byte random token, store SHA-256 hash in `profiles.email_verify_token` with 24h expiry
3. Send email with link: `https://app.billsos.com/verify-email?token=<raw>`

On click (`GET /api/auth/verify-email?token=...`):
1. Hash the token, find the profile
2. Check expiry
3. Set `email_verified = true`, clear token fields
4. Issue access + refresh tokens, redirect to `/onboarding`

### 4.2 — Password reset

On forgot-password form submit (`/api/auth/forgot-password`):
1. Find profile by email — always return 200 (no user enumeration)
2. Generate token, store hash with 1h expiry
3. Send email with: `https://app.billsos.com/reset-password?token=<raw>`

On reset form submit (`/api/auth/reset-password`):
1. Hash the token, find the profile
2. Check expiry
3. `bcrypt.hash(newPassword, 12)` → update `profiles.password_hash`
4. Revoke all existing refresh tokens for that user
5. Issue new tokens, redirect to `/dashboard`

---

## Phase 5 — MFA / TOTP

### 5.1 — Enroll (`POST /api/auth/mfa/enroll`)

```typescript
import * as OTPAuth from "otpauth";
import { encrypt } from "@/lib/crypto"; // AES-256-GCM with TOTP_ENCRYPTION_KEY

const totp = new OTPAuth.TOTP({ issuer: "BillSOS", label: userEmail, digits: 6, period: 30 });
const secret = totp.secret.base32;
const encrypted = await encrypt(secret, env.TOTP_ENCRYPTION_KEY);

await supabase.from("totp_factors").insert({
  user_id: uid, secret: encrypted, friendly_name, verified: false,
});

return { uri: totp.toString(), secret };  // frontend shows QR code
```

### 5.2 — Verify (`POST /api/auth/mfa/verify`)

```typescript
const { data: factor } = await supabase.from("totp_factors")
  .select("id, secret").eq("user_id", uid).eq("verified", false).single();

const secret = await decrypt(factor.secret, env.TOTP_ENCRYPTION_KEY);
const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
const delta = totp.validate({ token: code, window: 1 });

if (delta === null) return error(400, "Invalid code");
await supabase.from("totp_factors").update({ verified: true }).eq("id", factor.id);
await supabase.from("profiles").update({ two_factor_enabled: true }).eq("id", uid);
```

---

## Phase 6 — New session/incognito behaviour

With the new system:

- **Access token** lives in JS memory only — cleared the moment the tab closes
- **Refresh token** lives in an `HttpOnly` cookie with `Path=/api/auth` — never readable by JS
- **Incognito window** has no cookies from the normal session → `/api/auth/refresh` returns 401 → `AuthProvider` sets `status = "unauthenticated"` → user sees login page immediately, no spinner
- **New browser session** same as incognito — cookies from the previous session don't carry over (session cookies without `Max-Age` are cleared on browser close; if you want "remember me" you can add `Max-Age=2592000` only when the user checks a box)

---

## Phase 7 — Cleanup

After all phases are tested and deployed:

1. In Supabase Dashboard → Auth → disable email/password provider
2. In Supabase Dashboard → Auth → disable Google/GitHub providers
3. Run `DROP TABLE auth.sessions` (Supabase internal — only after confirming no dependencies)
4. Remove `VITE_SUPABASE_ANON_KEY` from frontend env (anon key is only needed if you use Supabase Auth; with service-role-only PostgREST calls from the server you don't need it client-side)
5. Remove `@supabase/supabase-js` auth options from `createClient` call (keep the client for PostgREST)
6. Delete `src/lib/supabase/cookie-storage.ts`
7. Delete `src/lib/supabase/auth.tsx`

---

## Migration order (safe, incremental)

```
Phase 0  — DB migrations         (run on live DB, non-breaking, additive only)
Phase 1  — Build all API routes   (deploy behind feature flag or separate worker route)
Phase 2  — Frontend auth client   (keep both auth systems in parallel behind a flag)
Phase 3  — OAuth                  (test in staging)
Phase 4  — Email flows            (test in staging)
Phase 5  — MFA                    (test in staging)
Phase 6  — Flip flag to new auth  (remove old Supabase Auth calls)
Phase 7  — Cleanup                (remove dead code + disable Supabase Auth)
```

---

## Files changed summary

| File | Action |
|---|---|
| `src/lib/supabase/auth.tsx` | DELETE — replaced by `src/lib/auth/context.tsx` |
| `src/lib/supabase/cookie-storage.ts` | DELETE — session managed server-side |
| `src/lib/supabase/client.ts` | UPDATE — disable Supabase Auth, inject access token in fetch |
| `src/lib/auth-guards.ts` | UPDATE — decode JWT from memory instead of `getSession()` |
| `src/lib/auth/client.ts` | CREATE — login / logout / refresh / token memory |
| `src/lib/auth/context.tsx` | CREATE — AuthProvider using new client |
| `src/api/auth.ts` | CREATE — all auth endpoints |
| `src/routes/login.tsx` | UPDATE — call `useAuth().login()` |
| `src/routes/signup.tsx` | UPDATE — call `/api/auth/signup` |
| `src/routes/__root.tsx` | UPDATE — import from `src/lib/auth/context` |
| `src/lib/queries/index.ts` | UPDATE — replace 6 Supabase Auth calls |
| `supabase/migrations/` | ADD — Phase 0 SQL files |

---

## Dependencies to add

```bash
npm install bcryptjs otpauth nodemailer
npm install --save-dev @types/bcryptjs
```

## Dependencies to remove (after Phase 7)

The `@supabase/supabase-js` package stays — you still use it for PostgREST queries.
Only the auth-specific usage is removed.
