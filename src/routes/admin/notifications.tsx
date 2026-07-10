import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Send, Mail, Bell as BellIcon, X, Search, Check,
  Eye, EyeOff, Smartphone,
} from "lucide-react";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import { adaptNotification } from "@/lib/admin-data";
import {
  useNotifications,
  useNotificationChannelStats,
  useSendEmailNotification,
  useSendInAppNotification,
  useProfilesBasic,
} from "@/lib/queries";

export const Route = createFileRoute("/admin/notifications")({
  component: NotificationCenter,
});

// ── Email HTML templates ──────────────────────────────────────────────────────

function baseEmailHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:Inter,Arial,sans-serif;background:#f3f4f6;margin:0;padding:32px 0">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
  <div style="background:#2563eb;padding:24px 32px">
    <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">HelloData</span>
  </div>
  <div style="padding:32px">
    <h2 style="font-size:20px;font-weight:600;margin:0 0 16px;color:#111827">${title}</h2>
    ${bodyHtml}
    <div style="margin-top:28px">
      <a href="#" style="display:inline-block;padding:10px 22px;background:#2563eb;color:#ffffff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">Open HelloData</a>
    </div>
  </div>
  <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">
    HelloData · AI financial document automation · You received this because you are a registered user.
  </div>
</div>
</body>
</html>`;
}

const EMAIL_TEMPLATES = [
  {
    id: "announce",
    label: "General Announcement",
    subject: "Important announcement from HelloData",
    html: baseEmailHtml(
      "Announcement",
      `<p style="color:#374151;line-height:1.7;margin:0 0 12px">We have an important update to share with you.</p>
<p style="color:#374151;line-height:1.7;margin:0">[Write your message here]</p>`,
    ),
  },
  {
    id: "maintenance",
    label: "Maintenance Notice",
    subject: "Scheduled maintenance — HelloData",
    html: baseEmailHtml(
      "Scheduled Maintenance",
      `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:14px 16px;margin-bottom:16px">
  <p style="color:#92400e;margin:0;font-size:14px;font-weight:500">Maintenance window: [DATE] · [START TIME] – [END TIME] IST</p>
</div>
<p style="color:#374151;line-height:1.7;margin:0 0 12px">HelloData will be temporarily unavailable during the window above for scheduled maintenance.</p>
<p style="color:#374151;line-height:1.7;margin:0">Your data is safe and no action is required from your side.</p>`,
    ),
  },
  {
    id: "feature",
    label: "New Feature",
    subject: "New features available on HelloData",
    html: baseEmailHtml(
      "What's New",
      `<p style="color:#374151;line-height:1.7;margin:0 0 16px">We've shipped new features to help you extract documents faster.</p>
<ul style="color:#374151;line-height:1.8;padding-left:20px;margin:0 0 16px">
  <li>[Feature 1]</li>
  <li>[Feature 2]</li>
  <li>[Feature 3]</li>
</ul>
<p style="color:#374151;line-height:1.7;margin:0">Log in to explore everything that's new.</p>`,
    ),
  },
  {
    id: "custom",
    label: "Custom HTML",
    subject: "",
    html: "",
  },
] as const;

type TemplateId = (typeof EMAIL_TEMPLATES)[number]["id"];

// ── Main component ────────────────────────────────────────────────────────────

function NotificationCenter() {
  const { data: dbNotifications = [] } = useNotifications(50);
  const notifications = useMemo(() => dbNotifications.map(adaptNotification), [dbNotifications]);
  const { data: stats } = useNotificationChannelStats();

  const [channelFilter, setChannelFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState<"email" | "in_app">("email");

  // Email form
  const [emailAudience, setEmailAudience] = useState<"all" | "select">("all");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [subject, setSubject] = useState<string>(EMAIL_TEMPLATES[0].subject);
  const [templateId, setTemplateId] = useState<TemplateId>("announce");
  const [htmlBody, setHtmlBody] = useState(EMAIL_TEMPLATES[0].html);
  const [showPreview, setShowPreview] = useState(false);

  // In-App form
  const [inAppTitle, setInAppTitle] = useState("");
  const [inAppBody, setInAppBody] = useState("");

  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: profiles = [] } = useProfilesBasic({ search: userSearch, limit: 100 });
  const sendEmail = useSendEmailNotification();
  const sendInApp = useSendInAppNotification();

  const filtered = useMemo(
    () =>
      channelFilter === "all"
        ? notifications.filter((n) => n.channel === "email" || n.channel === "in_app")
        : notifications.filter((n) => n.channel === channelFilter),
    [notifications, channelFilter],
  );

  function openDialog() {
    setDialogOpen(true);
    setTab("email");
    setEmailAudience("all");
    setSelectedUsers([]);
    setUserSearch("");
    setSubject(EMAIL_TEMPLATES[0].subject);
    setTemplateId("announce");
    setHtmlBody(EMAIL_TEMPLATES[0].html);
    setShowPreview(false);
    setInAppTitle("");
    setInAppBody("");
    setSendResult(null);
    sendEmail.reset();
    sendInApp.reset();
  }

  function handleTemplateChange(id: TemplateId) {
    setTemplateId(id);
    const tmpl = EMAIL_TEMPLATES.find((t) => t.id === id);
    if (tmpl && tmpl.id !== "custom") {
      setHtmlBody(tmpl.html);
      if (tmpl.subject) setSubject(tmpl.subject);
    }
  }

  function toggleUser(id: string) {
    setSelectedUsers((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id],
    );
  }

  async function handleSend() {
    setSendResult(null);

    if (tab === "email") {
      const userIds = emailAudience === "all" ? "all" : selectedUsers;
      if (Array.isArray(userIds) && userIds.length === 0) {
        setSendResult({ ok: false, message: "Select at least one user" });
        return;
      }
      if (!subject.trim()) {
        setSendResult({ ok: false, message: "Subject is required" });
        return;
      }
      if (!htmlBody.trim()) {
        setSendResult({ ok: false, message: "Email body is required" });
        return;
      }
      try {
        const result = await sendEmail.mutateAsync({ userIds, subject, html: htmlBody });
        setSendResult({
          ok: true,
          message: `Sent to ${result.sent} recipient${result.sent !== 1 ? "s" : ""}${result.failed > 0 ? ` · ${result.failed} failed` : ""}`,
        });
        setTimeout(() => setDialogOpen(false), 1800);
      } catch (err) {
        setSendResult({ ok: false, message: err instanceof Error ? err.message : "Failed to send" });
      }
    } else {
      if (!inAppTitle.trim()) {
        setSendResult({ ok: false, message: "Title is required" });
        return;
      }
      if (!inAppBody.trim()) {
        setSendResult({ ok: false, message: "Message is required" });
        return;
      }
      try {
        await sendInApp.mutateAsync({ subject: inAppTitle, body: inAppBody });
        setSendResult({ ok: true, message: "In-app notification sent to all users" });
        setTimeout(() => setDialogOpen(false), 1800);
      } catch (err) {
        setSendResult({ ok: false, message: err instanceof Error ? err.message : "Failed to send" });
      }
    }
  }

  const isSending = sendEmail.isPending || sendInApp.isPending;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Notification Center</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            Email & in-app delivery · Audience targeting
          </p>
        </div>
        <button
          onClick={openDialog}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-blue-700"
        >
          <Send className="h-3 w-3" /> New Notification
        </button>
      </div>

      {/* Channel Stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: "email", label: "Email", icon: Mail, count: stats?.email ?? 0 },
          { key: "in_app", label: "In-App", icon: BellIcon, count: stats?.in_app ?? 0 },
        ].map(({ key, label, icon: Icon, count }) => (
          <div key={key} className="rounded-lg border border-border bg-surface px-4 py-4">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground/80" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {label}
              </span>
            </div>
            <div className="mt-2 font-mono text-xl font-semibold text-foreground">
              {count.toLocaleString()}
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">Total sent</div>
          </div>
        ))}
      </div>

      {/* Push — Coming Soon */}
      <div className="rounded-lg border border-dashed border-border bg-surface/50 px-5 py-4 flex items-start gap-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Smartphone className="h-4 w-4 text-muted-foreground/50" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground/80">Push Notifications</span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-amber-400">
              Coming Soon
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/60 leading-relaxed">
            Push notifications require a mobile app. HelloData does not currently have a mobile app —
            this channel will be activated when the mobile app launches.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {[
          { id: "all", label: "All" },
          { id: "email", label: "Email" },
          { id: "in_app", label: "In-App" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setChannelFilter(f.id)}
            className={`rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${
              channelFilter === f.id
                ? "bg-blue-600/10 text-blue-400 border border-blue-600/20"
                : "text-muted-foreground/80 hover:text-foreground/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notification Log */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                {["Channel", "Subject", "Audience", "Recipients", "Status", "Sent At"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center font-mono text-[11px] text-muted-foreground/50"
                  >
                    No notifications sent yet
                  </td>
                </tr>
              )}
              {filtered.map((n) => {
                const Icon = n.channel === "email" ? Mail : BellIcon;
                return (
                  <tr key={n.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground/80" />
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {n.channel === "in_app" ? "In-App" : n.channel}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground/90 max-w-xs truncate">
                      {n.subject}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-border/80 bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground/80">
                        {n.audience}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-foreground/80">
                      {n.recipients.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <AutoStatusBadge status={n.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80">
                      {new Date(n.sentAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Compose Dialog ────────────────────────────────────────────────── */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !isSending && setDialogOpen(false)}
          />

          {/* panel */}
          <div className="relative z-10 mx-4 flex w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-2xl max-h-[90vh]">
            {/* dialog header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
              <span className="text-sm font-semibold">New Notification</span>
              <button
                onClick={() => !isSending && setDialogOpen(false)}
                className="rounded-md p-1 text-muted-foreground/80 hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* tab bar */}
            <div className="flex shrink-0 border-b border-border px-5">
              {(
                [
                  { id: "email", label: "Email", icon: Mail },
                  { id: "in_app", label: "In-App", icon: BellIcon },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    setSendResult(null);
                  }}
                  className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-mono text-[11px] transition-colors ${
                    tab === t.id
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-muted-foreground/80 hover:text-foreground/80"
                  }`}
                >
                  <t.icon className="h-3 w-3" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {tab === "email" ? (
                <>
                  {/* Audience */}
                  <div>
                    <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      Audience
                    </label>
                    <div className="flex gap-2">
                      {(
                        [
                          { value: "all", label: "All Users" },
                          { value: "select", label: "Select Users" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setEmailAudience(opt.value)}
                          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                            emailAudience === opt.value
                              ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                              : "border-border text-muted-foreground/80 hover:text-foreground/80"
                          }`}
                        >
                          {emailAudience === opt.value && <Check className="h-3 w-3" />}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* User multi-select */}
                  {emailAudience === "select" && (
                    <div>
                      <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                        Select Users{" "}
                        <span className="text-blue-400">({selectedUsers.length} selected)</span>
                      </label>
                      <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5">
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        <input
                          type="text"
                          placeholder="Search by name or email..."
                          value={userSearch}
                          onChange={(e) => setUserSearch(e.target.value)}
                          className="flex-1 bg-transparent font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 outline-none"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-surface">
                        {profiles.filter((p) => !!p.email).length === 0 && (
                          <div className="px-3 py-4 text-center font-mono text-[11px] text-muted-foreground/50">
                            No users found
                          </div>
                        )}
                        {profiles
                          .filter((p) => !!p.email)
                          .map((p) => {
                            const name =
                              [p.first_name, p.last_name].filter(Boolean).join(" ") ||
                              p.email ||
                              p.id;
                            const checked = selectedUsers.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                onClick={() => toggleUser(p.id)}
                                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 ${checked ? "bg-blue-500/5" : ""}`}
                              >
                                <div
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${checked ? "border-blue-500 bg-blue-600" : "border-border"}`}
                                >
                                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-[12px] text-foreground/90">{name}</div>
                                  <div className="truncate font-mono text-[10px] text-muted-foreground/60">
                                    {p.email}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Template picker */}
                  <div>
                    <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      Template
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {EMAIL_TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => handleTemplateChange(t.id)}
                          className={`rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${
                            templateId === t.id
                              ? "border border-blue-600/20 bg-blue-600/10 text-blue-400"
                              : "border border-border text-muted-foreground/80 hover:text-foreground/80"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Email subject..."
                      className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-500/50"
                    />
                  </div>

                  {/* HTML body + preview */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                        HTML Body
                      </label>
                      <button
                        onClick={() => setShowPreview((p) => !p)}
                        className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/80 hover:text-foreground/80"
                      >
                        {showPreview ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                        {showPreview ? "Edit" : "Preview"}
                      </button>
                    </div>
                    {showPreview ? (
                      <iframe
                        srcDoc={htmlBody}
                        title="Email preview"
                        sandbox="allow-same-origin"
                        className="h-80 w-full rounded-md border border-border bg-white"
                      />
                    ) : (
                      <textarea
                        value={htmlBody}
                        onChange={(e) => setHtmlBody(e.target.value)}
                        rows={10}
                        placeholder="HTML email content..."
                        className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-500/50"
                      />
                    )}
                  </div>
                </>
              ) : (
                /* In-App tab */
                <>
                  <div className="flex items-center gap-2 rounded-md border border-border/80 bg-muted/30 px-3 py-2.5">
                    <BellIcon className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                    <span className="font-mono text-[11px] text-foreground/70">
                      Appears in the dashboard bell for all users immediately.
                    </span>
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      Title
                    </label>
                    <input
                      type="text"
                      value={inAppTitle}
                      onChange={(e) => setInAppTitle(e.target.value)}
                      placeholder="Notification title..."
                      className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-500/50"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      Message
                    </label>
                    <textarea
                      value={inAppBody}
                      onChange={(e) => setInAppBody(e.target.value)}
                      rows={5}
                      placeholder="Notification message..."
                      className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-500/50"
                    />
                  </div>
                </>
              )}

              {/* Send result */}
              {sendResult && (
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2.5 font-mono text-[11px] ${
                    sendResult.ok
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-red-500/30 bg-red-500/10 text-red-400"
                  }`}
                >
                  {sendResult.ok ? (
                    <Check className="h-3 w-3 shrink-0" />
                  ) : (
                    <X className="h-3 w-3 shrink-0" />
                  )}
                  {sendResult.message}
                </div>
              )}
            </div>

            {/* dialog footer */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <button
                onClick={() => !isSending && setDialogOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground/80 hover:bg-muted hover:text-foreground/80 disabled:opacity-50"
                disabled={isSending}
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={isSending || !!sendResult?.ok}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-3 w-3" />
                {isSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
