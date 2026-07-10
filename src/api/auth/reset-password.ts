import {
  appendCookies,
  clearAuthMetadataToken,
  db,
  err,
  getAuthMetadataExpiry,
  hashPassword,
  issueTokens,
  requireSupabaseJwtSecret,
  setSessionMarkerCookie,
  sha256hex,
  type Env,
} from "./_utils";

export async function handleResetPassword(req: Request, env: Env): Promise<Response> {
  const { token, password } = (await req.json()) as { token?: string; password?: string };

  if (!token || !password) return err("Token and new password are required");
  if (password.length < 8) return err("Password must be at least 8 characters");

  const hash = await sha256hex(token);
  const client = db(env);

  const { data: profile, error: lookupErr } = await client
    .from("profiles")
    .select("id, metadata")
    .contains("metadata", { pwd_reset_token: hash })
    .maybeSingle();

  if (lookupErr) {
    console.error("[auth reset-password] token lookup failed", lookupErr);
    return err("Could not reset password. Please try again.", 500);
  }
  if (!profile) return err("Invalid or expired reset link", 400);
  const expiresAt = getAuthMetadataExpiry(profile.metadata, "pwd_reset");
  if (!expiresAt || new Date(expiresAt) < new Date()) {
    return err("Reset link has expired. Please request a new one.", 400);
  }
  requireSupabaseJwtSecret(env);

  const newHash = await hashPassword(password);

  const [profileUpdate, refreshRevoke] = await Promise.all([
    // Update password + clear reset token
    client
      .from("profiles")
      .update({
        password_hash: newHash,
        metadata: clearAuthMetadataToken(profile.metadata, "pwd_reset"),
        password_changed_at: new Date().toISOString(),
      })
      .eq("id", profile.id),

    // Revoke all active refresh tokens for this user (force re-login everywhere)
    client
      .from("refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", profile.id)
      .is("revoked_at", null),
  ]);
  if (profileUpdate.error) {
    console.error("[auth reset-password] profile update failed", profileUpdate.error);
    return err("Could not reset password. Please try again.", 500);
  }
  if (refreshRevoke.error) {
    console.error("[auth reset-password] refresh token revoke failed", refreshRevoke.error);
  }

  // Issue a fresh session so the user lands on the app immediately
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
