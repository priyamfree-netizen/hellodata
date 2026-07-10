import {
  appendCookies,
  clearRefreshCookie,
  clearSessionMarkerCookie,
  db,
  getRefreshCookie,
  sha256hex,
  type Env,
} from "./_utils";

export async function handleLogout(req: Request, env: Env): Promise<Response> {
  const raw = getRefreshCookie(req);
  if (raw) {
    const hash = await sha256hex(raw);
    await db(env).from("refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hash);
  }

  const headers = appendCookies(new Headers({ "Content-Type": "application/json" }), [
    clearRefreshCookie(req),
    clearSessionMarkerCookie(req),
  ]);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}
