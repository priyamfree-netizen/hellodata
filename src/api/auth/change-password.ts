import { db, err, hashPassword, ok, verifyAccessJwt, verifyPassword, type Env } from "./_utils";

export async function handleChangePassword(req: Request, env: Env): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  const payload = await verifyAccessJwt(token, env);
  if (!payload) return err("Unauthorized", 401);

  const { old_password, new_password } = (await req.json()) as {
    old_password?: string;
    new_password?: string;
  };
  if (!old_password || !new_password) return err("old_password and new_password are required");
  if (new_password.length < 8) return err("New password must be at least 8 characters");
  if (old_password === new_password)
    return err("New password must be different from the current one");

  const client = db(env);
  const { data: profile } = await client
    .from("profiles")
    .select("id, password_hash")
    .eq("id", payload.sub)
    .single();

  if (!profile?.password_hash) return err("Account uses OAuth — no password to change", 400);

  const valid = await verifyPassword(old_password, profile.password_hash as string);
  if (!valid) return err("Current password is incorrect", 401);

  await client
    .from("profiles")
    .update({
      password_hash: await hashPassword(new_password),
      password_changed_at: new Date().toISOString(),
    })
    .eq("id", payload.sub);

  return ok({ message: "Password updated successfully" });
}
