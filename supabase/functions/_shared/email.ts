/**
 * BillSOS · Resend email helper
 * Set RESEND_API_KEY and EMAIL_FROM in Supabase secrets.
 * If RESEND_API_KEY is absent the call is skipped with a warning (non-fatal).
 */

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

const DEFAULT_FROM = "BillSOS <noreply@billsos.com>";

export async function sendEmail(opts: EmailOptions): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn(JSON.stringify({ level: "warn", fn: "email", message: "RESEND_API_KEY not set — skipping email" }));
    return;
  }

  const from = Deno.env.get("EMAIL_FROM") ?? DEFAULT_FROM;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}

// ── Template helpers ──────────────────────────────────────────────────────────

export function extractionCompleteHtml(docName: string, fieldCount: number, appUrl: string): string {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#111">
  <h2 style="font-size:20px;margin-bottom:4px">Extraction complete</h2>
  <p style="color:#555;margin-top:0"><strong>${escHtml(docName)}</strong> has been processed.</p>
  <p>${fieldCount} field${fieldCount !== 1 ? "s" : ""} extracted successfully.</p>
  <a href="${escHtml(appUrl)}/output"
     style="display:inline-block;margin-top:12px;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-size:14px">
    View results
  </a>
  <p style="margin-top:32px;font-size:12px;color:#999">BillSOS · AI financial document automation</p>
</body></html>`;
}

export function extractionFailedHtml(docName: string, reason: string): string {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#111">
  <h2 style="font-size:20px;margin-bottom:4px;color:#dc2626">Extraction failed</h2>
  <p style="color:#555;margin-top:0">We could not process <strong>${escHtml(docName)}</strong>.</p>
  <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;font-size:13px;color:#b91c1c">${escHtml(reason)}</p>
  <p>Please re-upload the file or contact support if the problem persists.</p>
  <p style="margin-top:32px;font-size:12px;color:#999">BillSOS · AI financial document automation</p>
</body></html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
