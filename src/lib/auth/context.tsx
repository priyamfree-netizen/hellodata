/**
 * AuthProvider — replaces src/lib/supabase/auth.tsx.
 *
 * The context shape is IDENTICAL to the old one so every component that
 * calls useAuth() continues to work with zero changes.
 *
 * Bootstrap sequence:
 *   1. silentRefresh() hits /api/auth/refresh with the HttpOnly cookie.
 *   2. If the server returns a new access token, load profile + orgs from DB.
 *   3. If the server returns 401 (no cookie / expired), status = "unauthenticated".
 *   4. Access token auto-refreshes 60s before expiry via the client scheduler.
 *
 * New incognito / new browser session:
 *   The HttpOnly cookie is NOT shared with other sessions or incognito windows,
 *   so silentRefresh() returns 401 immediately → login page, no spinner.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase/client";
import {
  getAccessToken,
  login as apiLogin,
  logout as apiLogout,
  onTokenChange,
  silentRefresh,
  verifyMfaChallenge as apiVerifyMfaChallenge,
  resendMfaChallengeCode as apiResendMfaChallengeCode,
  type LoginResult,
} from "./client";
import type { Organization, Profile } from "@/lib/supabase/types";

// ── Types ─────────────────────────────────────────────────────────────────────
export type AuthStatus = "loading" | "unauthenticated" | "no_workspace" | "ready" | "backend_error";

interface AuthState {
  loading: boolean;
  userId: string | null;
  userEmail: string | null;
  profile: Profile | null;
  orgs: Organization[];
  currentOrg: Organization | null;
  membershipError: boolean;
}

interface AuthContextValue {
  status: AuthStatus;
  loading: boolean;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  currentOrg: Organization | null;
  orgs: Organization[];
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setCurrentOrg: (orgId: string) => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeMfa: (challengeToken: string, code: string) => Promise<void>;
  resendMfaCode: (challengeToken: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Module-level cache so requireSuperAdmin guard skips a DB round-trip
export const superAdminCache = new Map<string, boolean>();

// ── Reducer ───────────────────────────────────────────────────────────────────
type Action =
  | { type: "LOADING" }
  | {
      type: "LOADED";
      userId: string;
      userEmail: string;
      profile: Profile | null;
      orgs: Organization[];
      currentOrg: Organization | null;
    }
  | { type: "ERROR" }
  | { type: "SIGNED_OUT" };

function reducer(state: AuthState, action: Action): AuthState {
  switch (action.type) {
    case "LOADING":
      return { ...state, loading: true, membershipError: false };
    case "LOADED":
      return {
        loading: false,
        membershipError: false,
        userId: action.userId,
        userEmail: action.userEmail,
        profile: action.profile,
        orgs: action.orgs,
        currentOrg: action.currentOrg,
      };
    case "ERROR":
      return { ...state, loading: false, membershipError: true };
    case "SIGNED_OUT":
      return {
        loading: false,
        membershipError: false,
        userId: null,
        userEmail: null,
        profile: null,
        orgs: [],
        currentOrg: null,
      };
  }
}

const INITIAL: AuthState = {
  loading: true,
  userId: null,
  userEmail: null,
  profile: null,
  orgs: [],
  currentOrg: null,
  membershipError: false,
};

// ── Provider ──────────────────────────────────────────────────────────────────
type SupabaseLoadError = {
  code?: string;
  message?: string;
  status?: number;
};

function isSupabaseUnauthorized(error: SupabaseLoadError | null): boolean {
  if (!error) return false;
  return (
    error.status === 401 ||
    error.code === "PGRST301" ||
    /jwt|unauthorized/i.test(error.message ?? "")
  );
}

function loadUserDataErrorMessage(
  profileError: SupabaseLoadError | null,
  membershipError: SupabaseLoadError | null,
): string {
  if (isSupabaseUnauthorized(profileError) || isSupabaseUnauthorized(membershipError)) {
    if (import.meta.env.DEV) {
      console.warn("Access token rejected by Supabase; check SUPABASE_JWT_SECRET and role claim.", {
        profileError,
        membershipError,
      });
    }
    return "Access token was rejected by Supabase. Check SUPABASE_JWT_SECRET and the authenticated role claim.";
  }

  return "Could not load your profile or workspace data. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Force re-render when the access token changes (refresh rotates it silently)
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    onTokenChange(forceUpdate);
  }, []);

  const loadUserData = useCallback(async (userId: string, userEmail: string) => {
    dispatch({ type: "LOADING" });

    const [{ data: p, error: pErr }, { data: memberships, error: mErr }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("organization_members")
        .select("organization_id, organizations(*)")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);

    if (pErr || mErr) {
      dispatch({ type: "ERROR" });
      throw new Error(loadUserDataErrorMessage(pErr, mErr));
    }

    const profile = (p as Profile) ?? null;
    if (profile) superAdminCache.set(userId, !!profile.is_super_admin);

    const orgList: Organization[] = [];
    for (const m of memberships ?? []) {
      const o = (m as { organizations: Organization | Organization[] | null }).organizations;
      if (!o) continue;
      if (Array.isArray(o)) {
        orgList.push(...o);
      } else {
        orgList.push(o);
      }
    }

    const wantedId = profile?.current_org_id ?? orgList[0]?.id ?? null;
    const currentOrg = orgList.find((o) => o.id === wantedId) ?? orgList[0] ?? null;

    dispatch({ type: "LOADED", userId, userEmail, profile, orgs: orgList, currentOrg });
  }, []);

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => {
      if (mounted) dispatch({ type: "ERROR" });
    }, 10_000);

    (async () => {
      try {
        const publicAuthPath = [
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
        ].includes(window.location.pathname);
        const payload = await silentRefresh({ requireSessionHint: publicAuthPath });
        if (!mounted) return;
        if (!payload) {
          dispatch({ type: "SIGNED_OUT" });
        } else {
          await loadUserData(payload.sub, payload.email);
        }
      } catch {
        if (mounted) dispatch({ type: "ERROR" });
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [loadUserData]);

  // ── Computed status ──────────────────────────────────────────────────────────
  const status: AuthStatus = useMemo(() => {
    if (state.loading) return "loading";
    if (!state.userId) return "unauthenticated";
    if (state.membershipError) return "backend_error";
    if (state.orgs.length === 0) return "no_workspace";
    return "ready";
  }, [state.loading, state.userId, state.membershipError, state.orgs.length]);

  // ── Context value ────────────────────────────────────────────────────────────
  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      loading: state.loading,
      user: state.userId ? { id: state.userId, email: state.userEmail! } : null,
      profile: state.profile,
      currentOrg: state.currentOrg,
      orgs: state.orgs,

      login: async (email, password) => {
        dispatch({ type: "LOADING" });
        try {
          const result = await apiLogin(email, password);
          if (result.status === "ok") {
            await loadUserData(result.payload.sub, result.payload.email);
          } else {
            // A second factor is required — leave the session signed out so the
            // login page can render the code-entry step.
            dispatch({ type: "SIGNED_OUT" });
          }
          return result;
        } catch (e) {
          dispatch({ type: "SIGNED_OUT" });
          throw e;
        }
      },

      completeMfa: async (challengeToken, code) => {
        dispatch({ type: "LOADING" });
        try {
          const payload = await apiVerifyMfaChallenge(challengeToken, code);
          await loadUserData(payload.sub, payload.email);
        } catch (e) {
          dispatch({ type: "SIGNED_OUT" });
          throw e;
        }
      },

      resendMfaCode: (challengeToken) => apiResendMfaChallengeCode(challengeToken),

      refresh: async () => {
        if (state.userId) {
          await loadUserData(state.userId, state.userEmail!);
          return;
        }

        const payload = await silentRefresh();
        if (!payload) {
          dispatch({ type: "SIGNED_OUT" });
          return;
        }
        await loadUserData(payload.sub, payload.email);
      },

      signOut: async () => {
        if (state.userId) superAdminCache.delete(state.userId);
        dispatch({ type: "SIGNED_OUT" });
        await apiLogout();
      },

      setCurrentOrg: async (orgId: string) => {
        if (state.profile?.id) {
          const { error } = await supabase
            .from("profiles")
            .update({ current_org_id: orgId })
            .eq("id", state.profile.id);
          if (error) throw error;
        }
        const org = state.orgs.find((x) => x.id === orgId) ?? null;
        dispatch({
          type: "LOADED",
          userId: state.userId!,
          userEmail: state.userEmail!,
          profile: state.profile,
          orgs: state.orgs,
          currentOrg: org,
        });
      },
    }),
    [status, state, loadUserData],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function useCurrentOrgId(): string | null {
  return useAuth().currentOrg?.id ?? null;
}
