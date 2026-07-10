import {
  appendCookies,
  db,
  decryptAes,
  encryptAes,
  err,
  generateTotpSecret,
  issueTokens,
  ok,
  randomToken,
  requireEnv,
  setSessionMarkerCookie,
  sha256hex,
  sendEmail,
  verifyAccessJwt,
  verifyTotp,
  type Env,
} from "./_utils";
import { mfaCodeTemplate } from "./email-templates";

// =============================================================================
// Constants & small helpers
// =============================================================================

const CODE_TTL_MS = 10 * 60 * 1000; // email OTP validity
const CHALLENGE_TTL_MS = 10 * 60 * 1000; // login challenge validity
const MAX_ATTEMPTS = 5;

type MfaMethod = "totp" | "email";

function bearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
}

function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

async function loadEmailProfile(env: Env, userId: string) {
  const { data } = await db(env)
    .from("profiles")
    .select("email, first_name")
    .eq("id", userId)
    .single();
  return data as { email: string; first_name: string | null } | null;
}

/** Generate an email OTP, store it encrypted, and email it to the user. */
async function issueEmailCode(
  env: Env,
  userId: string,
  purpose: "enroll" | "login",
): Promise<void> {
  const profile = await loadEmailProfile(env, userId);
  if (!profile) throw new Error("User not found");

  const code = randomCode();
  const code_enc = await encryptAes(code, requireEnv(env, "TOTP_ENCRYPTION_KEY"));
  const client = db(env);

  // Invalidate any earlier unconsumed codes for this purpose so only the newest works.
  await client
    .from("mfa_email_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("consumed_at", null);

  await client.from("mfa_email_codes").insert({
    user_id: userId,
    code_enc,
    purpose,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  const template = mfaCodeTemplate({
    appUrl: requireEnv(env, "VITE_APP_URL"),
    firstName: profile.first_name,
    otp: code,
    purpose,
  });
  await sendEmail(env, profile.email, template.subject, template.html, template.text);
}

/** Validate a submitted email OTP. Returns true and consumes the code on success. */
async function consumeEmailCode(
  env: Env,
  userId: string,
  purpose: "enroll" | "login",
  submitted: string,
): Promise<boolean> {
  const client = db(env);
  const { data: row } = await client
    .from("mfa_email_codes")
    .select("id, code_enc, attempts, expires_at")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return false;
  if ((row.attempts as number) >= MAX_ATTEMPTS) return false;

  await client
    .from("mfa_email_codes")
    .update({ attempts: (row.attempts as number) + 1 })
    .eq("id", row.id as string);

  const expected = await decryptAes(row.code_enc as string, requireEnv(env, "TOTP_ENCRYPTION_KEY"));
  if (expected !== submitted.trim()) return false;

  await client
    .from("mfa_email_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id as string);
  return true;
}

/** Create a short-lived login challenge handle. Used by the login endpoint. */
export async function createMfaChallenge(
  env: Env,
  userId: string,
  method: MfaMethod,
): Promise<string> {
  const raw = randomToken();
  const token_hash = await sha256hex(raw);
  await db(env)
    .from("mfa_challenges")
    .insert({
      token_hash,
      user_id: userId,
      method,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    });
  return raw;
}

/** Send the login email code for a freshly-created challenge (email method). */
export async function sendLoginEmailCode(env: Env, userId: string): Promise<void> {
  await issueEmailCode(env, userId, "login");
}

async function loadChallenge(env: Env, rawToken: string) {
  const token_hash = await sha256hex(rawToken);
  const { data } = await db(env)
    .from("mfa_challenges")
    .select("id, user_id, method, attempts, expires_at, consumed_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  return data as {
    id: string;
    user_id: string;
    method: MfaMethod;
    attempts: number;
    expires_at: string;
    consumed_at: string | null;
  } | null;
}

// =============================================================================
// TOTP enrollment (authenticated)
// =============================================================================

export async function handleMfaEnroll(req: Request, env: Env): Promise<Response> {
  const payload = await verifyAccessJwt(bearer(req), env);
  if (!payload) return err("Unauthorized", 401);

  const { friendly_name = "Authenticator" } = (await req.json().catch(() => ({}))) as {
    friendly_name?: string;
  };

  const secret = await generateTotpSecret();
  const encrypted = await encryptAes(secret, requireEnv(env, "TOTP_ENCRYPTION_KEY"));

  const client = db(env);
  // Drop any earlier unverified attempts so we don't leave orphans.
  await client.from("totp_factors").delete().eq("user_id", payload.sub).eq("verified", false);

  const { data: factor, error } = await client
    .from("totp_factors")
    .insert({ user_id: payload.sub, secret: encrypted, friendly_name, verified: false })
    .select("id")
    .single();

  if (error) return err("Failed to create MFA factor", 500);

  const profile = await loadEmailProfile(env, payload.sub);
  const uri =
    `otpauth://totp/HelloData:${encodeURIComponent(profile?.email ?? payload.sub)}` +
    `?secret=${secret}&issuer=HelloData&digits=6&period=30`;

  return ok({ factor_id: (factor as { id: string }).id, secret, uri });
}

export async function handleMfaVerify(req: Request, env: Env): Promise<Response> {
  const payload = await verifyAccessJwt(bearer(req), env);
  if (!payload) return err("Unauthorized", 401);

  const { factor_id, code } = (await req.json()) as { factor_id?: string; code?: string };
  if (!factor_id || !code) return err("factor_id and code are required");

  const client = db(env);
  const { data: factor } = await client
    .from("totp_factors")
    .select("id, secret")
    .eq("id", factor_id)
    .eq("user_id", payload.sub)
    .maybeSingle();

  if (!factor) return err("Factor not found", 404);

  const secret = await decryptAes(factor.secret as string, requireEnv(env, "TOTP_ENCRYPTION_KEY"));
  const valid = await verifyTotp(secret, code.trim());
  if (!valid) return err("Invalid code. Check your authenticator app and try again.", 400);

  await Promise.all([
    client.from("totp_factors").update({ verified: true }).eq("id", factor_id),
    client
      .from("profiles")
      .update({ two_factor_enabled: true, two_factor_method: "totp" })
      .eq("id", payload.sub),
  ]);

  return ok({ verified: true });
}

// =============================================================================
// Email-based enrollment (authenticated)
// =============================================================================

export async function handleMfaEmailStart(req: Request, env: Env): Promise<Response> {
  const payload = await verifyAccessJwt(bearer(req), env);
  if (!payload) return err("Unauthorized", 401);

  try {
    await issueEmailCode(env, payload.sub, "enroll");
  } catch {
    return err("Could not send the verification code. Please try again.", 500);
  }
  return ok({ sent: true });
}

export async function handleMfaEmailVerify(req: Request, env: Env): Promise<Response> {
  const payload = await verifyAccessJwt(bearer(req), env);
  if (!payload) return err("Unauthorized", 401);

  const { code } = (await req.json()) as { code?: string };
  if (!code) return err("code is required");

  const valid = await consumeEmailCode(env, payload.sub, "enroll", code);
  if (!valid) return err("Invalid or expired code. Request a new one and try again.", 400);

  await db(env)
    .from("profiles")
    .update({ two_factor_enabled: true, two_factor_method: "email" })
    .eq("id", payload.sub);

  return ok({ verified: true });
}

// =============================================================================
// Disable (authenticated) — turns off whichever method is active
// =============================================================================

export async function handleMfaDisable(req: Request, env: Env): Promise<Response> {
  const payload = await verifyAccessJwt(bearer(req), env);
  if (!payload) return err("Unauthorized", 401);

  const client = db(env);
  await Promise.all([
    client.from("totp_factors").delete().eq("user_id", payload.sub),
    client
      .from("mfa_email_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", payload.sub)
      .is("consumed_at", null),
    client
      .from("profiles")
      .update({ two_factor_enabled: false, two_factor_method: null })
      .eq("id", payload.sub),
  ]);

  return ok({ disabled: true });
}

// Backwards-compatible alias for the previous /mfa/unenroll route.
export async function handleMfaUnenroll(req: Request, env: Env): Promise<Response> {
  return handleMfaDisable(req, env);
}

// =============================================================================
// Login challenge (UNauthenticated — gated by the challenge handle from login)
// =============================================================================

export async function handleMfaChallengeSend(req: Request, env: Env): Promise<Response> {
  const { challenge_token } = (await req.json()) as { challenge_token?: string };
  if (!challenge_token) return err("challenge_token is required");

  const challenge = await loadChallenge(env, challenge_token);
  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) < new Date()) {
    return err("This sign-in request expired. Please log in again.", 400);
  }
  if (challenge.method !== "email") return err("This factor does not use email codes.");

  try {
    await issueEmailCode(env, challenge.user_id, "login");
  } catch {
    return err("Could not send the code. Please try again.", 500);
  }
  return ok({ sent: true });
}

export async function handleMfaChallengeVerify(req: Request, env: Env): Promise<Response> {
  const { challenge_token, code } = (await req.json()) as {
    challenge_token?: string;
    code?: string;
  };
  if (!challenge_token || !code) return err("challenge_token and code are required");

  const client = db(env);
  const challenge = await loadChallenge(env, challenge_token);
  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) < new Date()) {
    return err("This sign-in request expired. Please log in again.", 400);
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return err("Too many attempts. Please log in again.", 429);
  }

  await client
    .from("mfa_challenges")
    .update({ attempts: challenge.attempts + 1 })
    .eq("id", challenge.id);

  let valid = false;
  if (challenge.method === "totp") {
    const { data: factor } = await client
      .from("totp_factors")
      .select("secret")
      .eq("user_id", challenge.user_id)
      .eq("verified", true)
      .maybeSingle();
    if (factor) {
      const secret = await decryptAes(
        factor.secret as string,
        requireEnv(env, "TOTP_ENCRYPTION_KEY"),
      );
      valid = await verifyTotp(secret, code.trim());
    }
  } else {
    valid = await consumeEmailCode(env, challenge.user_id, "login", code);
  }

  if (!valid) return err("Invalid code. Please try again.", 400);

  // Success — consume the challenge and issue the real session tokens.
  await client
    .from("mfa_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challenge.id);

  const { accessToken, refreshCookie } = await issueTokens(challenge.user_id, env, req);

  await client
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", challenge.user_id);

  const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
    refreshCookie,
    setSessionMarkerCookie(req),
  ]);

  return new Response(JSON.stringify({ access_token: accessToken }), { status: 200, headers });
}
