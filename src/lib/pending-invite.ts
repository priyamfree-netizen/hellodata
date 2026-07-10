/**
 * Carries a workspace invite token across the signup/login flow.
 *
 * `/invite?token=...` can't just pass the token via query params through
 * signup -> email verification -> login, since none of those steps forward
 * search params. sessionStorage survives that hop (and self-clears when the
 * tab closes), so a brand-new user who was invited lands back on the invite
 * accept screen instead of being forced into onboarding's "create a
 * workspace" form first.
 */
const KEY = "billsos.pending_invite_token";

export function stashPendingInvite(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — falls back to
    // the normal onboarding redirect.
  }
}

export function getPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
