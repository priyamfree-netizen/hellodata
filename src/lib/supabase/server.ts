import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service-role key.
 * NEVER import this from client components — it bypasses RLS.
 *
 * On Cloudflare Workers the Worker env is injected into globalThis.__cf_env__
 * by src/server.ts before the first request is handled. On Node.js runtimes
 * (local dev, Supabase Edge Functions) process.env is used as the fallback.
 */

function getEnvVar(key: string): string | undefined {
  const cfEnv = (globalThis as { __cf_env__?: Record<string, unknown> }).__cf_env__;
  if (cfEnv?.[key]) return cfEnv[key] as string;
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
}

export function getServiceRoleClient(): SupabaseClient {
  const url =
    getEnvVar("VITE_SUPABASE_URL") ??
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL;

  const serviceKey = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    throw new Error(
      "Service role Supabase client is not configured. Set SUPABASE_SERVICE_ROLE_KEY in your environment.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
