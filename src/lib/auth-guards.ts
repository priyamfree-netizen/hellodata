import { redirect } from "@tanstack/react-router";
import { supabase } from "./supabase/client";
import { superAdminCache } from "./auth/context";
import { getAccessToken, getTokenPayload } from "./auth/client";

/** Returns the decoded JWT payload if an unexpired access token is in memory. */
function getSession() {
  const token = getAccessToken();
  if (!token) return null;
  const payload = getTokenPayload();
  if (!payload) return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/** App routes: just need a logged-in user. Workspace check happens in <RequireWorkspace>. */
export async function requireAuth() {
  if (typeof window === "undefined") return;
  if (!getSession()) throw redirect({ to: "/login" });
}

/** /admin/*: must be a super admin. */
export async function requireSuperAdmin() {
  if (typeof window === "undefined") return;
  const session = getSession();
  if (!session) throw redirect({ to: "/login" });

  const uid = session.sub;

  const cached = superAdminCache.get(uid);
  if (cached === true) return;
  if (cached === false) throw redirect({ to: "/" });

  // Cache miss — cold navigation before AuthProvider has bootstrapped
  const { data: profile } = await supabase
    .from("profiles").select("is_super_admin").eq("id", uid).single();

  const isAdmin = !!profile?.is_super_admin;
  superAdminCache.set(uid, isAdmin);
  if (!isAdmin) throw redirect({ to: "/" });
}
