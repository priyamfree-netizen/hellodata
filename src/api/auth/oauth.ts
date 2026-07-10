/**
 * OAuth 2.0 PKCE flow for Google.
 * GET  /api/auth/oauth/google          -> redirect to Google
 * GET  /api/auth/oauth/google/callback -> exchange code, issue tokens
 */

import {
  appendCookies,
  db,
  err,
  issueTokens,
  randomToken,
  requireEnv,
  requireSupabaseJwtSecret,
  setSessionMarkerCookie,
  sha256hex,
  type Env,
} from "./_utils";

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64urlEncode(buf);
}

export async function handleOAuthStart(
  req: Request,
  env: Env,
  provider: "google",
): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken() + randomToken();
  const challenge = await pkceChallenge(verifier);
  const stateHash = await sha256hex(state);

  const oauthCookie = [
    `billsos-oauth=${encodeURIComponent(JSON.stringify({ state: stateHash, verifier, provider }))}`,
    "Path=/api/auth/oauth",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=300",
  ].join("; ");

  const appUrl = requireEnv(env, "VITE_APP_URL");
  const redirectUri = `${appUrl}/api/auth/oauth/google/callback`;
  const params = new URLSearchParams({
    client_id: requireEnv(env, "GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": oauthCookie,
    },
  });
}

export async function handleOAuthCallback(
  req: Request,
  env: Env,
  provider: "google",
): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) return err("Missing code or state", 400);

  const cookieStr = req.headers.get("Cookie") ?? "";
  const cookieMatch = cookieStr.match(/billsos-oauth=([^;]+)/);
  if (!cookieMatch) return err("OAuth session expired. Please try again.", 400);

  let oauthSession: { state: string; verifier: string; provider: string };
  try {
    oauthSession = JSON.parse(decodeURIComponent(cookieMatch[1]));
  } catch {
    return err("Invalid OAuth session", 400);
  }

  const stateHash = await sha256hex(state);
  if (stateHash !== oauthSession.state || oauthSession.provider !== provider) {
    return err("State mismatch. Please try again.", 400);
  }

  const clearOauthCookie =
    "billsos-oauth=; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=0";
  const appUrl = requireEnv(env, "VITE_APP_URL");
  const redirectUri = `${appUrl}/api/auth/oauth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv(env, "GOOGLE_CLIENT_ID"),
      client_secret: requireEnv(env, "GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: oauthSession.verifier,
    }),
  });
  if (!tokenRes.ok) return err("Failed to exchange Google OAuth code", 502);
  const tokens = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) return err("Failed to load Google profile", 502);

  const gUser = (await userRes.json()) as { sub: string; email: string; name?: string };
  requireSupabaseJwtSecret(env);

  const oauthEmail = gUser.email.toLowerCase();
  const oauthName = gUser.name ?? "";
  const providerUserId = gUser.sub;
  const client = db(env);

  const { data: existing } = await client
    .from("oauth_accounts")
    .select("user_id")
    .eq("provider", provider)
    .eq("provider_user_id", providerUserId)
    .maybeSingle();

  let userId: string;

  if (existing) {
    userId = existing.user_id as string;
  } else {
    const { data: profileByEmail } = await client
      .from("profiles")
      .select("id")
      .eq("email", oauthEmail)
      .maybeSingle();

    if (profileByEmail) {
      userId = profileByEmail.id as string;
    } else {
      const nameParts = oauthName.trim().split(" ");
      const { data: authUserData, error: authUserErr } = await client.auth.admin.createUser({
        email: oauthEmail,
        email_confirm: true,
        user_metadata: {
          first_name: nameParts[0] ?? null,
          last_name: nameParts.slice(1).join(" ") || null,
          provider,
        },
      });
      if (authUserErr || !authUserData.user?.id) {
        console.error("[auth oauth] auth user create failed", authUserErr);
        return err("Could not create OAuth account. Please contact support.", 500);
      }

      userId = authUserData.user.id;
      const { error: profileInsertErr } = await client.from("profiles").upsert(
        {
          id: userId,
          email: oauthEmail,
          first_name: nameParts[0] ?? null,
          last_name: nameParts.slice(1).join(" ") || null,
          email_verified: true,
          password_hash: null,
        },
        { onConflict: "id" },
      );
      if (profileInsertErr) {
        console.error("[auth oauth] profile insert failed", profileInsertErr);
        await client.auth.admin.deleteUser(userId).catch((deleteErr) => {
          console.error("[auth oauth] failed to roll back auth user", deleteErr);
        });
        return err("Could not create OAuth account. Please contact support.", 500);
      }
    }

    const { error: oauthInsertErr } = await client.from("oauth_accounts").insert({
      user_id: userId,
      provider,
      provider_user_id: providerUserId,
      provider_email: oauthEmail,
    });
    if (oauthInsertErr) {
      console.error("[auth oauth] oauth account insert failed", oauthInsertErr);
      return err("Could not link OAuth account. Please contact support.", 500);
    }
  }

  await client
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", userId);

  const { accessToken, refreshCookie } = await issueTokens(userId, env, req);
  const { data: memberships } = await client
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);

  const destination = memberships?.length ? "/dashboard" : "/onboarding";
  const redirectUrl = new URL(`${appUrl}${destination}`);
  redirectUrl.searchParams.set("access_token", accessToken);

  const headers = appendCookies(new Headers({ Location: redirectUrl.toString() }), [
    refreshCookie,
    setSessionMarkerCookie(req),
    clearOauthCookie,
  ]);

  return new Response(null, {
    status: 302,
    headers,
  });
}
