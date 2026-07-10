import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Clock, MessageSquare, AlertCircle, User, ArrowUp } from "lucide-react";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import { DetailPanel, DetailRow } from "@/components/admin/detail-panel";
import { adaptTicket } from "@/lib/admin-data";
import {
  useAdminTickets,
  useAddTicketReply,
  useProfilesByIds,
  useSuperAdminProfiles,
  useTicketReplies,
  useUpdateTicket,
} from "@/lib/queries";
import { useAuth } from "@/lib/auth/context";
import { supabase } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import type { TicketPriority, TicketStatus } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/support")({
  component: SupportCenter,
});

const PRIORITY_ORDER: TicketPriority[] = ["low", "normal", "high", "urgent"];
const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "waiting", "resolved", "closed"];

function SupportCenter() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: dbTickets = [] } = useAdminTickets({ limit: 60 });
  const rows = useMemo(
    () =>
      dbTickets.map((t) => ({
        db: t,
        ui: adaptTicket(t, {
          orgName: t.orgName,
          requesterName: t.requesterName,
          assigneeName: t.assigneeName,
        }),
      })),
    [dbTickets],
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedDbId, setSelectedDbId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  const selected = rows.find((r) => r.db.id === selectedDbId) ?? null;
  const selectedTicket = selected?.ui ?? null;
  const selectedDbTicket = selected?.db ?? null;

  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.ui.status === statusFilter);
  const openCount = rows.filter((r) =>
    ["open", "in_progress", "waiting"].includes(r.ui.status),
  ).length;
  const urgentCount = rows.filter((r) => r.ui.priority === "urgent").length;

  const { data: replies = [] } = useTicketReplies(selectedDbTicket?.id, true);
  const { data: superAdmins = [] } = useSuperAdminProfiles();
  const authorIds = useMemo(
    () => replies.map((r) => r.author_id).filter((v): v is string => !!v),
    [replies],
  );
  const { data: authorNames } = useProfilesByIds(authorIds);
  const addReply = useAddTicketReply();
  const updateTicket = useUpdateTicket();

  useEffect(() => {
    if (!selectedDbTicket?.id) return;
    const channel = supabase
      .channel(`ticket-replies-${selectedDbTicket.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ticket_replies",
          filter: `ticket_id=eq.${selectedDbTicket.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["tickets"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedDbTicket?.id, qc]);

  useEffect(() => {
    const channel = supabase
      .channel("tickets-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
        void qc.invalidateQueries({ queryKey: ["tickets"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  function closeDetail() {
    setSelectedDbId(null);
    setReplyText("");
    setIsInternal(false);
  }

  function handleSendReply() {
    if (!selectedDbTicket || !profile || !replyText.trim()) return;
    addReply.mutate(
      { ticketId: selectedDbTicket.id, authorId: profile.id, body: replyText.trim(), isInternal },
      {
        onSuccess: () => {
          setReplyText("");
          if (!isInternal && ["resolved", "closed"].includes(selectedDbTicket.status)) {
            updateTicket.mutate({ id: selectedDbTicket.id, patch: { status: "open" } });
          }
        },
      },
    );
  }

  function handleEscalate() {
    if (!selectedDbTicket) return;
    const idx = PRIORITY_ORDER.indexOf(selectedDbTicket.priority);
    const next = PRIORITY_ORDER[Math.min(idx + 1, PRIORITY_ORDER.length - 1)];
    updateTicket.mutate({ id: selectedDbTicket.id, patch: { priority: next } });
  }

  function handleStatusChange(status: TicketStatus) {
    if (!selectedDbTicket) return;
    const patch: { status: TicketStatus; resolved_at?: string } = { status };
    if (status === "resolved") patch.resolved_at = new Date().toISOString();
    updateTicket.mutate({ id: selectedDbTicket.id, patch });
  }

  function handleAssigneeChange(assigneeId: string) {
    if (!selectedDbTicket) return;
    updateTicket.mutate({ id: selectedDbTicket.id, patch: { assignee_id: assigneeId || null } });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Support Center</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            {rows.length} tickets · Customer success & ticket management
          </p>
        </div>
        <div className="flex items-center gap-2">
          {urgentCount > 0 && (
            <span className="rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-1 font-mono text-[10px] text-red-400">
              {urgentCount} urgent
            </span>
          )}
          <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 font-mono text-[10px] text-amber-400">
            {openCount} open
          </span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Open Tickets", value: String(openCount), icon: MessageSquare },
          { label: "Avg Response", value: "2.4h", icon: Clock },
          { label: "SLA Compliance", value: "94.2%", icon: AlertCircle },
          { label: "CSAT Score", value: "4.6/5", icon: User },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <s.icon className="h-4 w-4 text-muted-foreground/80" />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {s.label}
              </div>
              <div className="font-mono text-lg font-semibold text-foreground">{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1">
        {["all", "open", "in_progress", "waiting", "resolved", "closed"].map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${statusFilter === f ? "bg-blue-600/10 text-blue-400 border border-blue-600/20" : "text-muted-foreground/80 hover:text-foreground/80"}`}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Ticket Table */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Ticket",
                  "Subject",
                  "Organization",
                  "Priority",
                  "Status",
                  "Category",
                  "Assignee",
                  "SLA",
                  "Created",
                ].map((h) => (
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
              {filtered.map(({ db, ui: t }) => (
                <tr
                  key={db.id}
                  onClick={() => setSelectedDbId(db.id)}
                  className="hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-[12px] text-foreground/80">{t.id}</td>
                  <td className="px-4 py-3 text-[13px] text-foreground/90 max-w-xs truncate">
                    {t.subject}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.organization}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                        t.priority === "urgent"
                          ? "border-red-500/20 bg-red-500/10 text-red-400"
                          : t.priority === "high"
                            ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                            : "border-zinc-600/20 text-muted-foreground"
                      }`}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <AutoStatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.category}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.assignee}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80">
                    {t.slaDeadline
                      ? new Date(t.slaDeadline).toLocaleString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80">
                    {new Date(t.createdDate).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ticket Detail */}
      <DetailPanel
        open={!!selectedTicket}
        onClose={closeDetail}
        title={selectedTicket?.id ?? ""}
        subtitle={selectedTicket?.subject}
      >
        {selectedTicket && selectedDbTicket && (
          <div>
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
              <AutoStatusBadge status={selectedTicket.status} />
              <button
                onClick={handleEscalate}
                className="flex items-center gap-1.5 rounded-md border border-border/80 px-3 py-1.5 font-mono text-[11px] text-foreground/80 hover:bg-muted"
              >
                <ArrowUp className="h-3 w-3" /> Escalate
              </button>
            </div>
            <DetailRow label="Subject" value={selectedTicket.subject} />
            <DetailRow label="Organization" value={selectedTicket.organization} />
            <DetailRow label="Requester" value={selectedTicket.requester} />
            <DetailRow label="Priority" value={selectedTicket.priority} />
            <DetailRow label="Category" value={selectedTicket.category} />
            <DetailRow
              label="Status"
              value={
                <select
                  value={selectedDbTicket.status}
                  onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-foreground/80 outline-none"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              }
            />
            <DetailRow
              label="Assignee"
              value={
                <select
                  value={selectedDbTicket.assignee_id ?? ""}
                  onChange={(e) => handleAssigneeChange(e.target.value)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-foreground/80 outline-none"
                >
                  <option value="">Unassigned</option>
                  {superAdmins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.first_name ? `${a.first_name} ${a.last_name ?? ""}`.trim() : a.email}
                    </option>
                  ))}
                </select>
              }
            />
            <DetailRow
              label="SLA Deadline"
              value={
                selectedTicket.slaDeadline
                  ? new Date(selectedTicket.slaDeadline).toLocaleString()
                  : "—"
              }
              mono
            />
            <DetailRow
              label="Created"
              value={new Date(selectedTicket.createdDate).toLocaleString()}
              mono
            />
            <DetailRow
              label="Last Reply"
              value={new Date(selectedTicket.lastReply).toLocaleString()}
              mono
            />

            {/* Reply thread */}
            <div className="border-t border-border/50 px-6 py-4 space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Conversation
              </div>
              {replies.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No replies yet.</p>
              )}
              {replies.map((r) => (
                <div
                  key={r.id}
                  className={`rounded-md border px-3 py-2 ${r.is_internal ? "border-amber-500/20 bg-amber-500/5" : "border-border/60 bg-surface-2"}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] text-foreground/80">
                      {r.author_id ? (authorNames?.get(r.author_id) ?? "—") : "—"}
                    </span>
                    <div className="flex items-center gap-2">
                      {r.is_internal && (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-400">
                          Internal
                        </span>
                      )}
                      <span className="font-mono text-[9px] text-muted-foreground/80">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <p className="text-[12px] text-foreground/90 whitespace-pre-wrap">{r.body}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-border/50 px-6 py-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-3">
                Reply
              </div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground/80 placeholder:text-muted-foreground/60 outline-none resize-none"
                rows={4}
                placeholder="Type your reply..."
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleSendReply}
                  disabled={addReply.isPending || !replyText.trim()}
                  className="rounded-md bg-blue-600 px-3 py-1.5 font-mono text-[11px] text-foreground hover:bg-blue-700 disabled:opacity-50"
                >
                  Send Reply
                </button>
                <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/80">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                  />
                  Internal note
                </label>
              </div>
            </div>
          </div>
        )}
      </DetailPanel>
    </div>
  );
}
