import {
  appendCookies,
  authClient,
  db,
  err,
  isMissingCustomAuthSchemaError,
  issueTokens,
  setRefreshCookie,
  setSessionMarkerCookie,
  verifyPassword,
  type Env,
} from "./_utils";
import { createMfaChallenge, sendLoginEmailCode } from "./mfa";

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { email?: string; password?: string };
  const { email, password } = body;

  if (!email || !password) return err("Email and password are required");

  const client = db(env);

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id, password_hash, email_verified, status, two_factor_enabled, two_factor_method")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (profileError) {
    if (!isMissingCustomAuthSchemaError(profileError)) {
      console.error("[auth login] profile lookup failed", profileError);
      return err("Could not check your account. Please try again.", 500);
    }

    const { data, error } = await authClient(env).auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (error || !data.session?.access_token || !data.session.refresh_token) {
      return err("Invalid email or password", 401);
    }

    await client
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", data.user.id);

    const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
      setRefreshCookie(data.session.refresh_token, req),
      setSessionMarkerCookie(req),
    ]);

    return new Response(JSON.stringify({ access_token: data.session.access_token }), {
      status: 200,
      headers,
    });
  }

  if (profile && !profile.password_hash) {
    if (!profile.email_verified) return err("Please verify your email before signing in", 403);
    if (profile.status === "suspended")
      return err("Your account has been suspended. Contact support.", 403);

    const { data, error } = await authClient(env).auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (error || !data.session?.access_token || !data.session.refresh_token) {
      return err("Invalid email or password", 401);
    }

    await client
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", data.user.id);

    const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
      setRefreshCookie(data.session.refresh_token, req),
      setSessionMarkerCookie(req),
    ]);

    return new Response(JSON.stringify({ access_token: data.session.access_token }), {
      status: 200,
      headers,
    });
  }

  // Always run verifyPassword even on no-match to prevent timing attacks
  const hash =
    profile?.password_hash ??
    "pbkdf2$210000$0000000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
  const valid = await verifyPassword(password, hash);

  if (!profile || !valid) return err("Invalid email or password", 401);
  if (!profile.email_verified) return err("Please verify your email before signing in", 403);
  if (profile.status === "suspended")
    return err("Your account has been suspended. Contact support.", 403);

  // Second factor required — issue a short-lived challenge instead of tokens.
  if (profile.two_factor_enabled) {
    const method = (profile.two_factor_method as "totp" | "email" | null) ?? "totp";
    const challengeToken = await createMfaChallenge(env, profile.id as string, method);
    if (method === "email") {
      // Best-effort: if email delivery fails the user can hit "resend".
      await sendLoginEmailCode(env, profile.id as string).catch(() => {});
    }
    return new Response(
      JSON.stringify({ mfa_required: true, challenge_token: challengeToken, method }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const { accessToken, refreshCookie } = await issueTokens(profile.id as string, env, req);

  // Update last_login_at
  await client
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", profile.id);

  const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
    refreshCookie,
    setSessionMarkerCookie(req),
  ]);

  return new Response(JSON.stringify({ access_token: accessToken }), {
    status: 200,
    headers,
  });
}
