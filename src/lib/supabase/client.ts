import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/auth/client";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn(
    "[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing. " +
      "Copy .env.example to .env.local and fill in values.",
  );
}

let cached: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file.",
    );
  }
  if (!cached) {
    cached = createClient(url, anonKey, {
      auth: {
        // Supabase Auth is disabled — we manage sessions ourselves.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { "x-client-info": "billsos-web" },
        fetch: (input, init) => {
          // Inject our custom JWT so RLS auth.uid() resolves correctly.
          const token = getAccessToken();
          const headers = new Headers((init?.headers as HeadersInit | undefined) ?? {});
          if (token) headers.set("Authorization", `Bearer ${token}`);

          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(new DOMException("Supabase request timed out after 15s", "TimeoutError")),
            15_000,
          );
          return fetch(input, { ...init, headers, signal: controller.signal }).finally(() =>
            clearTimeout(timer),
          );
        },
      },
    });
  }
  return cached;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    return (getSupabase() as never)[prop as never];
  },
});
