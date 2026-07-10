import {
  db,
  ok,
  randomToken,
  requireEnv,
  sendEmail,
  sha256hex,
  type Env,
  withAuthMetadataToken,
} from "./_utils";
import { resetPasswordTemplate } from "./email-templates";

export async function handleForgotPassword(req: Request, env: Env): Promise<Response> {
  const { email } = (await req.json()) as { email?: string };

  // Always return 200 — never reveal whether an account exists
  const successResponse = ok({
    message: "If that email is registered, a reset link has been sent.",
  });

  if (!email) return successResponse;

  const client = db(env);
  const { data: profile, error: lookupErr } = await client
    .from("profiles")
    .select("id, first_name, metadata")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (lookupErr) {
    console.error("[auth forgot-password] profile lookup failed", lookupErr);
    return successResponse;
  }
  if (!profile) return successResponse;

  const token = randomToken();
  const hash = await sha256hex(token);

  const update = await client
    .from("profiles")
    .update({
      metadata: withAuthMetadataToken(
        profile.metadata,
        "pwd_reset",
        hash,
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ),
    })
    .eq("id", profile.id);
  if (update.error) {
    console.error("[auth forgot-password] reset token update failed", update.error);
    return successResponse;
  }

  const appUrl = requireEnv(env, "VITE_APP_URL");
  const resetUrl = `${appUrl}/reset-password?token=${token}`;
  const emailTemplate = resetPasswordTemplate({
    appUrl,
    resetUrl,
    firstName: profile.first_name as string | null,
  });
  try {
    await sendEmail(env, email, emailTemplate.subject, emailTemplate.html, emailTemplate.text);
  } catch (error) {
    console.error("[auth forgot-password] reset email failed", error);
  }

  return successResponse;
}
