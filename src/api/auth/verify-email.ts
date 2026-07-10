import {
  appendCookies,
  clearAuthMetadataToken,
  db,
  err,
  getAuthMetadataExpiry,
  issueTokens,
  ok,
  requireEnv,
  requireSupabaseJwtSecret,
  sendEmail,
  setSessionMarkerCookie,
  sha256hex,
  withAuthMetadataToken,
  type Env,
} from "./_utils";
import { verifyEmailOtpTemplate } from "./email-templates";

/** Generate a cryptographically random 6-digit OTP string */
function randomOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

export async function handleVerifyEmail(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { email?: string; otp?: string };
  const { email, otp } = body;

  if (!email || !otp) return err("Email and verification code are required");
  if (!/^\d{6}$/.test(otp)) return err("Verification code must be 6 digits");

  const hash = await sha256hex(otp);
  const client = db(env);

  const { data: profile, error: lookupErr } = await client
    .from("profiles")
    .select("id, metadata, email_verified")
    .eq("email", email.toLowerCase())
    .contains("metadata", { email_verify_token: hash })
    .maybeSingle();

  if (lookupErr) {
    console.error("[auth verify-email] token lookup failed", lookupErr);
    return err("Could not verify your email. Please try again.", 500);
  }
  if (!profile) return err("Invalid verification code. Please check and try again.", 400);
  if (profile.email_verified) {
    return ok({ message: "Email already verified. You can now sign in." });
  }

  const expiresAt = getAuthMetadataExpiry(profile.metadata, "email_verify");
  if (!expiresAt || new Date(expiresAt) < new Date()) {
    return err("Verification code has expired. Please request a new code.", 400);
  }

  requireSupabaseJwtSecret(env);

  const update = await client
    .from("profiles")
    .update({
      email_verified: true,
      metadata: clearAuthMetadataToken(profile.metadata, "email_verify"),
    })
    .eq("id", profile.id);

  if (update.error) {
    console.error("[auth verify-email] profile update failed", update.error);
    return err("Could not verify your email. Please try again.", 500);
  }

  // Issue tokens so the user is signed in immediately after verification
  const { accessToken, refreshCookie } = await issueTokens(profile.id as string, env, req);

  const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
    refreshCookie,
    setSessionMarkerCookie(req),
  ]);

  return new Response(JSON.stringify({ access_token: accessToken }), {
    status: 200,
    headers,
  });
}

/** Resend OTP — regenerates and sends a fresh verification code */
export async function handleResendVerification(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { email?: string };
  const { email } = body;
  if (!email) return err("Email is required");

  const client = db(env);
  const { data: profile, error } = await client
    .from("profiles")
    .select("id, email_verified, first_name, metadata")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  // Always return success to prevent email enumeration
  if (error || !profile || profile.email_verified) {
    return ok({ message: "If that account exists and is unverified, a new code has been sent." });
  }

  const otp = randomOtp();
  const verifyHash = await sha256hex(otp);
  const verifyExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await client
    .from("profiles")
    .update({
      metadata: withAuthMetadataToken(profile.metadata, "email_verify", verifyHash, verifyExpires),
    })
    .eq("id", profile.id);

  const appUrl = requireEnv(env, "VITE_APP_URL");
  const emailTemplate = verifyEmailOtpTemplate({
    appUrl,
    otp,
    firstName: (profile.first_name as string | null) ?? undefined,
  });

  try {
    await sendEmail(env, email, emailTemplate.subject, emailTemplate.html, emailTemplate.text);
  } catch (emailErr) {
    console.error("[auth resend-verification] email failed", emailErr);
    return err("Could not send verification email. Please try again.", 500);
  }

  return ok({ message: "A new verification code has been sent to your email." });
}
