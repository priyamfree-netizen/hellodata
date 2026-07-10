/**
 * Auth API router.
 * Mounted at /api/auth/* in src/server.ts.
 *
 * POST /api/auth/signup
 * POST /api/auth/login
 * POST /api/auth/logout
 * POST /api/auth/refresh
 * GET  /api/auth/verify-email?token=...
 * POST /api/auth/forgot-password
 * POST /api/auth/reset-password
 * POST /api/auth/change-password
 * POST /api/auth/mfa/enroll
 * POST /api/auth/mfa/verify
 * POST /api/auth/mfa/unenroll
 * GET  /api/auth/oauth/google
 * GET  /api/auth/oauth/google/callback
 */

import { handleSignup } from "./signup";
import { handleLogin } from "./login";
import { handleLogout } from "./logout";
import { handleRefresh } from "./refresh";
import { handleVerifyEmail, handleResendVerification } from "./verify-email";
import { handleForgotPassword } from "./forgot-password";
import { handleResetPassword } from "./reset-password";
import { handleChangePassword } from "./change-password";
import {
  handleMfaEnroll,
  handleMfaVerify,
  handleMfaUnenroll,
  handleMfaDisable,
  handleMfaEmailStart,
  handleMfaEmailVerify,
  handleMfaChallengeSend,
  handleMfaChallengeVerify,
} from "./mfa";
import { handleOAuthStart, handleOAuthCallback } from "./oauth";
import { AuthApiError, err, type Env } from "./_utils";

export async function handleAuthApi(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname; // e.g. /api/auth/login
  const method = req.method.toUpperCase();

  if (!path.startsWith("/api/auth")) return null; // not our route

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  try {
    if (method === "POST" && path === "/api/auth/signup") return await handleSignup(req, env);
    if (method === "POST" && path === "/api/auth/login") return await handleLogin(req, env);
    if (method === "POST" && path === "/api/auth/logout") return await handleLogout(req, env);
    if (method === "POST" && path === "/api/auth/refresh") return await handleRefresh(req, env);
    if (method === "POST" && path === "/api/auth/verify-email")
      return await handleVerifyEmail(req, env);
    if (method === "POST" && path === "/api/auth/resend-verification")
      return await handleResendVerification(req, env);
    if (method === "POST" && path === "/api/auth/forgot-password")
      return await handleForgotPassword(req, env);
    if (method === "POST" && path === "/api/auth/reset-password")
      return await handleResetPassword(req, env);
    if (method === "POST" && path === "/api/auth/change-password")
      return await handleChangePassword(req, env);
    if (method === "POST" && path === "/api/auth/mfa/enroll")
      return await handleMfaEnroll(req, env);
    if (method === "POST" && path === "/api/auth/mfa/verify")
      return await handleMfaVerify(req, env);
    if (method === "POST" && path === "/api/auth/mfa/unenroll")
      return await handleMfaUnenroll(req, env);
    if (method === "POST" && path === "/api/auth/mfa/disable")
      return await handleMfaDisable(req, env);
    if (method === "POST" && path === "/api/auth/mfa/email/start")
      return await handleMfaEmailStart(req, env);
    if (method === "POST" && path === "/api/auth/mfa/email/verify")
      return await handleMfaEmailVerify(req, env);
    if (method === "POST" && path === "/api/auth/mfa/challenge/send")
      return await handleMfaChallengeSend(req, env);
    if (method === "POST" && path === "/api/auth/mfa/challenge/verify")
      return await handleMfaChallengeVerify(req, env);

    if (method === "GET" && path === "/api/auth/oauth/google")
      return await handleOAuthStart(req, env, "google");
    if (method === "GET" && path === "/api/auth/oauth/google/callback")
      return await handleOAuthCallback(req, env, "google");

    return err("Not found", 404);
  } catch (e) {
    if (e instanceof AuthApiError) {
      console.error("[auth api config]", e.message);
      return err(e.publicMessage, e.status);
    }
    console.error("[auth api]", e);
    return err("Internal server error", 500);
  }
}
