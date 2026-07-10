import {
  db,
  err,
  hashPassword,
  isMissingCustomAuthSchemaError,
  ok,
  requireEnv,
  sendEmail,
  sha256hex,
  type Env,
  withAuthMetadataToken,
} from "./_utils";
import { verifyEmailOtpTemplate } from "./email-templates";

/** Generate a cryptographically random 6-digit OTP string */
function randomOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

export async function handleSignup(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as {
    email?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
  };
  const { email, password, first_name = "", last_name = "" } = body;

  if (!email || !password) return err("Email and password are required");
  if (password.length < 8) return err("Password must be at least 8 characters");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Invalid email address");

  const client = db(env);

  // Check duplicate
  const { data: existing, error: duplicateErr } = await client
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (duplicateErr) {
    console.error("[auth signup] duplicate check failed", duplicateErr);
    return err("Could not check your account. Please try again.", 500);
  }
  if (existing) return err("An account with this email already exists", 409);

  const passwordHash = await hashPassword(password);
  const otp = randomOtp();
  const verifyHash = await sha256hex(otp);
  const verifyExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

  const { data: authUserData, error: authUserErr } = await client.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: false,
    user_metadata: {
      first_name: first_name.trim() || null,
      last_name: last_name.trim() || null,
    },
  });
  if (authUserErr || !authUserData.user?.id) {
    console.error("[auth signup] auth user create failed", authUserErr);
    if (/already|exists|registered/i.test(authUserErr?.message ?? "")) {
      return err("An account with this email already exists", 409);
    }
    return err("Failed to create account. Please try again.", 500);
  }

  const userId = authUserData.user.id;

  const { error: insertErr } = await client.from("profiles").upsert(
    {
      id: userId,
      email: email.toLowerCase(),
      first_name: first_name.trim() || null,
      last_name: last_name.trim() || null,
      password_hash: passwordHash,
      email_verified: false,
      metadata: withAuthMetadataToken({}, "email_verify", verifyHash, verifyExpires),
    },
    { onConflict: "id" },
  );
  if (insertErr) {
    console.error("[auth signup] profile insert failed", insertErr);
    await client.auth.admin.deleteUser(userId).catch((deleteErr) => {
      console.error(
        "[auth signup] failed to roll back auth user after profile insert failure",
        deleteErr,
      );
    });
    if (isMissingCustomAuthSchemaError(insertErr)) {
      return err(
        "Auth database schema is missing custom signup columns. Run the latest Supabase migration and try again.",
        500,
      );
    }
    return err("Failed to create account. Please try again.", 500);
  }

  const appUrl = requireEnv(env, "VITE_APP_URL");
  const emailTemplate = verifyEmailOtpTemplate({
    appUrl,
    otp,
    firstName: first_name.trim() || undefined,
  });
  try {
    await sendEmail(env, email, emailTemplate.subject, emailTemplate.html, emailTemplate.text);
  } catch (emailErr) {
    console.error("[auth signup] verification email failed", emailErr);
    const cleanup = await client.from("profiles").delete().eq("id", userId);
    if (cleanup.error) {
      console.error("[auth signup] failed to roll back profile after email failure", cleanup.error);
    }
    await client.auth.admin.deleteUser(userId).catch((deleteErr) => {
      console.error("[auth signup] failed to roll back auth user after email failure", deleteErr);
    });
    return err("Verification email could not be sent. Check SMTP settings and try again.", 500);
  }

  return ok({ message: "Account created. Please check your email to verify your account." }, 201);
}
