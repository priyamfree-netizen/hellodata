type AuthEmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

type VerifyEmailInput = {
  firstName?: string;
  appUrl: string;
  verifyUrl: string;
};

type VerifyEmailOtpInput = {
  firstName?: string;
  appUrl: string;
  otp: string;
};

type ResetPasswordInput = {
  firstName?: string | null;
  appUrl: string;
  resetUrl: string;
};

export function verifyEmailOtpTemplate(input: VerifyEmailOtpInput): AuthEmailTemplate {
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Welcome to HelloData,";
  // Format as "123 456" for readability
  const otpDisplay = `${input.otp.slice(0, 3)} ${input.otp.slice(3)}`;
  const text = `${greeting}

Your HelloData verification code is:

  ${otpDisplay}

Enter this code on the verification page to activate your account.
This code expires in 15 minutes. If you did not create an account, ignore this email.`;

  return {
    subject: "Your HelloData verification code",
    text,
    html: renderEmailLayout({
      appUrl: input.appUrl,
      preheader: `Your HelloData verification code is ${otpDisplay}`,
      title: "Verify your email",
      eyebrow: "Account verification",
      body: `
        <p style="${styles.p}">${escapeHtml(greeting)}</p>
        <p style="${styles.p}">Enter the code below on the verification page to activate your HelloData account.</p>
        <div style="margin:28px 0;text-align:center;">
          <span style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:18px 36px;font-size:36px;font-weight:700;letter-spacing:0.18em;color:#0f172a;font-family:'Courier New',monospace;">${escapeHtml(otpDisplay)}</span>
        </div>
      `,
      ctaHref: `${escapeAttr(input.appUrl)}/verify-email`,
      ctaLabel: "Go to verification page",
      note: "This code expires in 15 minutes. If you did not create an account, you can safely ignore this email.",
    }),
  };
}

export function verifyEmailTemplate(input: VerifyEmailInput): AuthEmailTemplate {
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Welcome to HelloData,";
  const text = `${greeting}

Confirm your email address to activate your HelloData account:
${input.verifyUrl}

This link expires in 24 hours. If you did not create an account, ignore this email.`;

  return {
    subject: "Confirm your HelloData account",
    text,
    html: renderEmailLayout({
      appUrl: input.appUrl,
      preheader: "Confirm your email address to activate your HelloData account.",
      title: "Confirm your email address",
      eyebrow: "Account verification",
      body: `
        <p style="${styles.p}">${escapeHtml(greeting)}</p>
        <p style="${styles.p}">Thanks for signing up for HelloData. Confirm your email address to activate your account and start setting up your workspace.</p>
      `,
      ctaHref: input.verifyUrl,
      ctaLabel: "Confirm email address",
      note: "This link expires in 24 hours. If you did not create an account, you can safely ignore this email.",
    }),
  };
}

export function resetPasswordTemplate(input: ResetPasswordInput): AuthEmailTemplate {
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const text = `${greeting}

We received a request to reset your HelloData password. Set a new password here:
${input.resetUrl}

This link expires in 1 hour. If you did not request this, ignore this email.`;

  return {
    subject: "Reset your HelloData password",
    text,
    html: renderEmailLayout({
      appUrl: input.appUrl,
      preheader: "Use this secure link to reset your HelloData password.",
      title: "Reset your password",
      eyebrow: "Security request",
      body: `
        <p style="${styles.p}">${escapeHtml(greeting)}</p>
        <p style="${styles.p}">We received a request to reset your HelloData password. Use the secure link below to create a new password.</p>
      `,
      ctaHref: input.resetUrl,
      ctaLabel: "Reset password",
      note: "This link expires in 1 hour. If you did not request a password reset, your account is still secure and no action is needed.",
    }),
  };
}

type OrgInviteInput = {
  inviterName: string | null;
  orgName: string;
  role: string;
  appUrl: string;
  acceptUrl: string;
};

export function organizationInviteTemplate(input: OrgInviteInput): AuthEmailTemplate {
  const inviter = input.inviterName?.trim() || "A teammate";
  const text = `${inviter} invited you to join "${input.orgName}" on HelloData as ${input.role}.

Accept the invitation here:
${input.acceptUrl}

If you don't have a HelloData account yet, sign up with this email address first, then open the link again.
This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.`;

  return {
    subject: `${inviter} invited you to join ${input.orgName} on HelloData`,
    text,
    html: renderEmailLayout({
      appUrl: input.appUrl,
      preheader: `${inviter} invited you to join ${input.orgName} on HelloData.`,
      title: `Join ${input.orgName} on HelloData`,
      eyebrow: "Workspace invitation",
      body: `
        <p style="${styles.p}">Hi,</p>
        <p style="${styles.p}"><strong>${escapeHtml(inviter)}</strong> invited you to join the workspace <strong>${escapeHtml(input.orgName)}</strong> on HelloData as <strong>${escapeHtml(input.role)}</strong>.</p>
        <p style="${styles.p}">HelloData extracts data from invoices and financial documents automatically, so your team stops retyping them.</p>
      `,
      ctaHref: input.acceptUrl,
      ctaLabel: "Accept invitation",
      note: "This invitation expires in 7 days. If you don't have a HelloData account yet, sign up with this email address first, then open the link again. If you weren't expecting this invitation, you can safely ignore this email.",
    }),
  };
}

type MfaCodeInput = {
  firstName?: string | null;
  appUrl: string;
  otp: string;
  purpose: "enroll" | "login";
};

export function mfaCodeTemplate(input: MfaCodeInput): AuthEmailTemplate {
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const otpDisplay = `${input.otp.slice(0, 3)} ${input.otp.slice(3)}`;
  const intro =
    input.purpose === "enroll"
      ? "Enter this code to turn on two-factor authentication for your HelloData account."
      : "Enter this code to finish signing in to HelloData.";
  const text = `${greeting}

Your HelloData security code is:

  ${otpDisplay}

${intro}
This code expires in 10 minutes. If you didn't request it, someone may have your password — change it right away.`;

  return {
    subject: "Your HelloData security code",
    text,
    html: renderEmailLayout({
      appUrl: input.appUrl,
      preheader: `Your HelloData security code is ${otpDisplay}`,
      title: input.purpose === "enroll" ? "Confirm two-factor authentication" : "Your sign-in code",
      eyebrow: "Security code",
      body: `
        <p style="${styles.p}">${escapeHtml(greeting)}</p>
        <p style="${styles.p}">${escapeHtml(intro)}</p>
        <div style="margin:28px 0;text-align:center;">
          <span style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:18px 36px;font-size:36px;font-weight:700;letter-spacing:0.18em;color:#0f172a;font-family:'Courier New',monospace;">${escapeHtml(otpDisplay)}</span>
        </div>
      `,
      ctaHref: `${escapeAttr(input.appUrl)}/login`,
      ctaLabel: "Go to HelloData",
      note: "This code expires in 10 minutes. If you didn't request it, someone may have your password — change it right away.",
    }),
  };
}

function renderEmailLayout(input: {
  appUrl: string;
  preheader: string;
  title: string;
  eyebrow: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
  note: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,'Segoe UI',sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;">
            <tr>
              <td style="padding:0 0 18px;text-align:center;">
                <span style="display:inline-block;width:40px;height:40px;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:20px;line-height:40px;text-align:center;vertical-align:middle;">B</span>
                <span style="display:inline-block;margin-left:10px;color:#0f172a;font-size:20px;font-weight:700;vertical-align:middle;">HelloData</span>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:40px 36px;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
                <p style="margin:0 0 10px;color:#2563eb;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(input.eyebrow)}</p>
                <h1 style="margin:0 0 18px;color:#0f172a;font-size:26px;line-height:1.25;font-weight:700;">${escapeHtml(input.title)}</h1>
                ${input.body}
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:30px 0;">
                  <tr>
                    <td>
                      <a href="${escapeAttr(input.ctaHref)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:10px;padding:14px 24px;font-size:14px;font-weight:700;">${escapeHtml(input.ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin:0 0 24px;">
                  <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">${escapeHtml(input.note)}</p>
                </div>
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;word-break:break-all;">Copy link: <a href="${escapeAttr(input.ctaHref)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(input.ctaHref)}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 8px 0;text-align:center;">
                <p style="margin:0 0 6px;color:#64748b;font-size:12px;">HelloData - AI financial document automation</p>
                <p style="margin:0;color:#94a3b8;font-size:12px;"><a href="${escapeAttr(input.appUrl)}/privacy" style="color:#64748b;text-decoration:none;">Privacy Policy</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const styles = {
  p: "margin:0 0 16px;color:#475569;font-size:15px;line-height:1.7;",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
