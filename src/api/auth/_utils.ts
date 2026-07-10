/**
 * Shared utilities for the custom auth API.
 * All functions run in Cloudflare Workers (Web Crypto API only — no Node.js).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendSmtpEmail } from "./smtp";

// ── Env type ─────────────────────────────────────────────────────────────────
export interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_JWT_SECRET?: string; // Supabase project JWT secret; signs REST/RLS access tokens
  // Deprecated local secret; it is not valid for Supabase REST/RLS access tokens.
  JWT_SECRET?: string; // Deprecated; not valid for Supabase REST/RLS access tokens
  TOTP_ENCRYPTION_KEY?: string; // 32-char hex — AES-256 encrypts TOTP secrets
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  SMTP_REPLY_TO?: string;
  SMTP_SECURE?: string;
  SMTP_ALLOW_INSECURE?: string;
  SMTP_HELO_DOMAIN?: string;
  VITE_APP_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  EXDOC_API_KEY?: string;
  EXDOC_API_BASE_URL?: string;
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly publicMessage = message,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

function runtimeEnv(): Record<string, unknown> {
  const cfEnv = (globalThis as { __cf_env__?: Record<string, unknown> }).__cf_env__;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return { ...(viteEnv ?? {}), ...(processEnv ?? {}), ...(cfEnv ?? {}) };
}

export function envVar(env: Env, key: keyof Env): string | undefined {
  const direct = env?.[key];
  if (typeof direct === "string" && direct.length > 0) return direct;

  const fallback = runtimeEnv()[key];
  return typeof fallback === "string" && fallback.length > 0 ? fallback : undefined;
}

export function requireEnv(env: Env, key: keyof Env): string {
  const value = envVar(env, key);
  if (value) return value;
  throw new AuthApiError(
    `Missing auth server environment variable: ${key}`,
    500,
    `Auth server is missing ${key}. Check your local .env / Worker secret configuration.`,
  );
}

// ── Service-role Supabase client (bypasses RLS) ───────────────────────────
export function requireSupabaseJwtSecret(env: Env): string {
  const secret = envVar(env, "SUPABASE_JWT_SECRET");
  if (secret) return secret;

  const hasLegacySecret = !!envVar(env, "JWT_SECRET");
  throw new AuthApiError(
    hasLegacySecret
      ? "JWT_SECRET cannot be used for Supabase REST/RLS access tokens. Set SUPABASE_JWT_SECRET to the Supabase project JWT secret."
      : "Missing auth server environment variable: SUPABASE_JWT_SECRET",
    500,
    "Auth server is missing SUPABASE_JWT_SECRET. Set it to your Supabase project JWT secret without the VITE_ prefix.",
  );
}

export function db(env: Env): SupabaseClient {
  return createClient(
    requireEnv(env, "VITE_SUPABASE_URL"),
    requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export function authClient(env: Env): SupabaseClient {
  return createClient(
    requireEnv(env, "VITE_SUPABASE_URL"),
    requireEnv(env, "VITE_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export function isMissingCustomAuthSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  return (
    message.includes("profiles.password_hash") ||
    message.includes("profiles.email_verified") ||
    message.includes("email_verify_token") ||
    message.includes("email_verify_expires") ||
    message.includes("pwd_reset_token") ||
    message.includes("pwd_reset_expires") ||
    message.includes("public.refresh_tokens") ||
    message.includes("refresh_tokens")
  );
}

// ── JSON response helpers ─────────────────────────────────────────────────
export function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Cookie helpers ────────────────────────────────────────────────────────
function isSecureRequest(req?: Request): boolean {
  if (!req) return true;
  return new URL(req.url).protocol === "https:";
}

export function setRefreshCookie(token: string, req?: Request): string {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  return [
    `billsos-refresh=${encodeURIComponent(token)}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Strict",
    isSecureRequest(req) ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function setSessionMarkerCookie(req?: Request): string {
  return [
    "billsos-session=1",
    "Path=/",
    "SameSite=Strict",
    isSecureRequest(req) ? "Secure" : "",
    `Max-Age=${30 * 24 * 60 * 60}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearRefreshCookie(req?: Request): string {
  return [
    "billsos-refresh=; Path=/api/auth",
    "HttpOnly",
    "SameSite=Strict",
    isSecureRequest(req) ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionMarkerCookie(req?: Request): string {
  return [
    "billsos-session=; Path=/",
    "SameSite=Strict",
    isSecureRequest(req) ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

export function appendCookies(headers: Headers, cookies: string[]): Headers {
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

export function getRefreshCookie(req: Request): string | null {
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)billsos-refresh=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ── JWT (HS256 via Web Crypto) ────────────────────────────────────────────
export interface JwtPayload {
  sub: string;
  email: string;
  aud: "authenticated";
  role: "authenticated";
  org_ids: string[];
  is_super_admin: boolean;
  iat: number;
  exp: number;
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function str2ab(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", str2ab(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signJwt(
  payload: Omit<JwtPayload, "aud" | "role" | "iat" | "exp">,
  secret: string,
  expiresInSeconds = 15 * 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = {
    ...payload,
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = b64url(str2ab(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(str2ab(JSON.stringify(full)));
  const sig = b64url(
    await crypto.subtle.sign("HMAC", await importHmacKey(secret), str2ab(`${header}.${body}`)),
  );
  return `${header}.${body}.${sig}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const [header, body, sig] = token.split(".");
    const valid = await crypto.subtle.verify(
      "HMAC",
      await importHmacKey(secret),
      Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      str2ab(`${header}.${body}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.aud !== "authenticated" || payload.role !== "authenticated") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyAccessJwt(token: string, env: Env): Promise<JwtPayload | null> {
  return verifyJwt(token, requireSupabaseJwtSecret(env));
}

// ── SHA-256 hex hash ──────────────────────────────────────────────────────
export async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Random token ──────────────────────────────────────────────────────────
export function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── bcrypt via Web Crypto (PBKDF2 — no native bcrypt in Workers) ──────────
// We use PBKDF2-SHA256 with 210,000 iterations (OWASP 2024 recommendation).
// Format: "pbkdf2$<iterations>$<salt-hex>$<hash-hex>"

const PBKDF2_ITERATIONS = 210_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  const hashHex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [, iterStr, saltHex, storedHash] = stored.split("$");
    const iterations = parseInt(iterStr, 10);
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      256,
    );
    const hashHex = Array.from(new Uint8Array(bits))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // Constant-time compare
    if (hashHex.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < hashHex.length; i++)
      diff |= hashHex.charCodeAt(i) ^ storedHash.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// ── AES-256-GCM encrypt/decrypt (for TOTP secrets) ───────────────────────
async function importAesKey(hexKey: string): Promise<CryptoKey> {
  const raw = new Uint8Array(hexKey.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptAes(plaintext: string, hexKey: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importAesKey(hexKey);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ivHex = Array.from(iv)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ctHex = Array.from(new Uint8Array(ct))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${ivHex}:${ctHex}`;
}

export async function decryptAes(ciphertext: string, hexKey: string): Promise<string> {
  const [ivHex, ctHex] = ciphertext.split(":");
  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const ct = new Uint8Array(ctHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await importAesKey(hexKey);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plain);
}

// ── TOTP (RFC 6238) ───────────────────────────────────────────────────────
function base32Decode(s: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/=+$/, "");
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export async function generateTotpSecret(): Promise<string> {
  const raw = new Uint8Array(20);
  crypto.getRandomValues(raw);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let result = "";
  let bits = 0,
    value = 0;
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >> bits) & 0x1f];
    }
  }
  return result;
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const keyData = base32Decode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    const counter = now + offset;
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint32(4, counter, false);
    const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));
    const o = hmac[19] & 0xf;
    const otp = String(
      (((hmac[o] & 0x7f) << 24) | (hmac[o + 1] << 16) | (hmac[o + 2] << 8) | hmac[o + 3]) %
        1_000_000,
    ).padStart(6, "0");
    if (otp === code) return true;
  }
  return false;
}

// ── Email sender (SMTP via fetch to a relay, or adapt to Resend/Postmark) ─
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<void> {
  await sendSmtpEmail(env, { to, subject, html, text });
}

// ── Load user + orgs (used by multiple endpoints) ─────────────────────────
export function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function withAuthMetadataToken(
  metadata: unknown,
  tokenKey: "email_verify" | "pwd_reset",
  tokenHash: string,
  expiresAt: string,
): Record<string, unknown> {
  return {
    ...asMetadata(metadata),
    [`${tokenKey}_token`]: tokenHash,
    [`${tokenKey}_expires`]: expiresAt,
  };
}

export function clearAuthMetadataToken(
  metadata: unknown,
  tokenKey: "email_verify" | "pwd_reset",
): Record<string, unknown> {
  const next = asMetadata(metadata);
  delete next[`${tokenKey}_token`];
  delete next[`${tokenKey}_expires`];
  return next;
}

export function getAuthMetadataExpiry(
  metadata: unknown,
  tokenKey: "email_verify" | "pwd_reset",
): string | null {
  const value = asMetadata(metadata)[`${tokenKey}_expires`];
  return typeof value === "string" ? value : null;
}

export async function loadUserClaims(
  userId: string,
  env: Env,
): Promise<{ sub: string; email: string; org_ids: string[]; is_super_admin: boolean } | null> {
  const client = db(env);
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    client.from("profiles").select("id, email, is_super_admin").eq("id", userId).single(),
    client
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);
  if (!profile) return null;
  return {
    sub: profile.id as string,
    email: profile.email as string,
    is_super_admin: !!profile.is_super_admin,
    org_ids: (memberships ?? []).map((m: Record<string, unknown>) => m.organization_id as string),
  };
}

// ── Issue token pair ──────────────────────────────────────────────────────
export async function issueTokens(
  userId: string,
  env: Env,
  req: Request,
): Promise<{ accessToken: string; refreshCookie: string }> {
  const claims = await loadUserClaims(userId, env);
  if (!claims) throw new Error("User not found");

  const accessToken = await signJwt(claims, requireSupabaseJwtSecret(env), 15 * 60);

  const raw = randomToken();
  const hash = await sha256hex(raw);
  await db(env)
    .from("refresh_tokens")
    .insert({
      user_id: userId,
      token_hash: hash,
      ip_address: req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For"),
      user_agent: req.headers.get("User-Agent"),
      expires_at: new Date(Date.now() + 30 * 86_400 * 1000).toISOString(),
    });

  return { accessToken, refreshCookie: setRefreshCookie(raw, req) };
}
