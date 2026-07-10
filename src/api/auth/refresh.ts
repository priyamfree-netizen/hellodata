import {
  appendCookies,
  authClient,
  db,
  err,
  getRefreshCookie,
  isMissingCustomAuthSchemaError,
  issueTokens,
  setRefreshCookie,
  setSessionMarkerCookie,
  sha256hex,
  type Env,
} from "./_utils";

export async function handleRefresh(req: Request, env: Env): Promise<Response> {
  const raw = getRefreshCookie(req);
  if (!raw) return err("No session", 401);

  const hash = await sha256hex(raw);
  const client = db(env);

  const { data: stored, error: tokenLookupError } = await client
    .from("refresh_tokens")
    .select("id, user_id, expires_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (tokenLookupError) {
    if (!isMissingCustomAuthSchemaError(tokenLookupError)) {
      console.error("[auth refresh] token lookup failed", tokenLookupError);
      return err("Could not refresh session", 500);
    }

    const { data, error } = await authClient(env).auth.refreshSession({ refresh_token: raw });
    if (error || !data.session?.access_token || !data.session.refresh_token) {
      return err("Session expired", 401);
    }

    const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
      setRefreshCookie(data.session.refresh_token, req),
      setSessionMarkerCookie(req),
    ]);

    return new Response(JSON.stringify({ access_token: data.session.access_token }), {
      status: 200,
      headers,
    });
  }

  if (!stored) {
    const { data, error } = await authClient(env).auth.refreshSession({ refresh_token: raw });
    if (error || !data.session?.access_token || !data.session.refresh_token) {
      return err("Session not found", 401);
    }

    const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
      setRefreshCookie(data.session.refresh_token, req),
      setSessionMarkerCookie(req),
    ]);

    return new Response(JSON.stringify({ access_token: data.session.access_token }), {
      status: 200,
      headers,
    });
  }
  if (stored.revoked_at) return err("Session revoked", 401);
  if (new Date(stored.expires_at as string) < new Date()) return err("Session expired", 401);

  // Revoke old token (rotation — one-time use refresh tokens)
  await client.from("refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", stored.id);

  const { accessToken, refreshCookie } = await issueTokens(stored.user_id as string, env, req);

  // Update last_used_at on the new token (just inserted by issueTokens)
  // and last_activity_at on the profile
  await client.from("profiles")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", stored.user_id);

  const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
    refreshCookie,
    setSessionMarkerCookie(req),
  ]);

  return new Response(JSON.stringify({ access_token: accessToken }), {
    status: 200,
    headers,
  });
}
