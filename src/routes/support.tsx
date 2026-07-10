import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Headphones } from "lucide-react";
import { requireAuth } from "@/lib/auth-guards";
import { AppShell } from "@/components/app-shell";
import { NoSectionAccess, ReadOnlyBanner } from "@/components/section-gate";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import { supabase } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import { DetailPanel, DetailRow } from "@/components/admin/detail-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useMyTickets,
  useCreateTicket,
  useTicketReplies,
  useAddTicketReply,
  useUpdateTicket,
} from "@/lib/queries";
import type { TicketPriority } from "@/lib/supabase/types";

export const Route = createFileRoute("/support")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Support — HelloData" }] }),
  component: SupportPage,
});

const CATEGORIES = ["Billing", "Technical", "Account", "Other"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

function SupportPage() {
  const { profile, currentOrg } = useAuth();
  const sectionLevel = useSectionAccess("support");
  const canEdit = sectionLevel === "edit";
  const qc = useQueryClient();
  const { data: tickets = [], isLoading } = useMyTickets(profile?.id, 50);
  const createTicket = useCreateTicket();
  const addReply = useAddTicketReply();
  const updateTicket = useUpdateTicket();

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  );
  const { data: replies = [] } = useTicketReplies(selectedTicket?.id, false);

  useEffect(() => {
    if (!selectedTicket?.id) return;
    const channel = supabase
      .channel(`my-ticket-replies-${selectedTicket.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ticket_replies",
          filter: `ticket_id=eq.${selectedTicket.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["tickets"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedTicket?.id, qc]);

  function resetForm() {
    setSubject("");
    setCategory(CATEGORIES[0]);
    setPriority("normal");
    setBody("");
    setFormError(null);
  }

  function handleCreateTicket() {
    if (!currentOrg || !profile) return;
    if (!subject.trim() || !body.trim()) {
      setFormError("Subject and description are required.");
      return;
    }
    createTicket.mutate(
      {
        organizationId: currentOrg.id,
        requesterId: profile.id,
        subject: subject.trim(),
        body: body.trim(),
        category,
        priority,
      },
      {
        onSuccess: () => {
          setIsNewOpen(false);
          resetForm();
        },
        onError: (err) =>
          setFormError(err instanceof Error ? err.message : "Could not create ticket."),
      },
    );
  }

  function handleReply() {
    if (!selectedTicket || !profile || !replyText.trim()) return;
    addReply.mutate(
      {
        ticketId: selectedTicket.id,
        authorId: profile.id,
        body: replyText.trim(),
        isInternal: false,
      },
      { onSuccess: () => setReplyText("") },
    );
  }

  function handleCloseTicket() {
    if (!selectedTicket) return;
    updateTicket.mutate({ id: selectedTicket.id, patch: { status: "closed" } });
  }

  if (sectionLevel === "none") {
    return (
      <AppShell title="Support">
        <NoSectionAccess section="support" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Support">
      <div className="space-y-6 p-6">
        {sectionLevel === "view" && <ReadOnlyBanner section="support" />}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Support</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground/80">
              {tickets.length} tickets you've filed
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => setIsNewOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 font-mono text-[11px] text-foreground hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" /> New Ticket
            </button>
          )}
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
            <Headphones className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              You haven't filed any support tickets yet.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] text-foreground/90">{t.subject}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                  #{t.number.toString().padStart(5, "0")} · {t.category ?? "General"} · updated{" "}
                  {new Date(t.last_reply_at ?? t.updated_at).toLocaleDateString()}
                </div>
              </div>
              <AutoStatusBadge status={t.status} />
            </button>
          ))}
        </div>
      </div>

      {/* New ticket dialog */}
      <Dialog
        open={isNewOpen}
        onOpenChange={(open) => {
          setIsNewOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New support ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Subject
              </label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
                placeholder="What do you need help with?"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Description
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
                placeholder="Describe the issue…"
              />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <button
              onClick={handleCreateTicket}
              disabled={createTicket.isPending}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-foreground hover:bg-blue-700 disabled:opacity-50"
            >
              {createTicket.isPending ? "Submitting…" : "Submit ticket"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ticket detail */}
      <DetailPanel
        open={!!selectedTicket}
        onClose={() => {
          setSelectedId(null);
          setReplyText("");
        }}
        title={selectedTicket ? `#${selectedTicket.number.toString().padStart(5, "0")}` : ""}
        subtitle={selectedTicket?.subject}
      >
        {selectedTicket && (
          <div>
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
              <AutoStatusBadge status={selectedTicket.status} />
              {canEdit && !["closed", "resolved"].includes(selectedTicket.status) && (
                <button
                  onClick={handleCloseTicket}
                  className="rounded-md border border-border/80 px-3 py-1.5 font-mono text-[11px] text-foreground/80 hover:bg-muted"
                >
                  Mark as closed
                </button>
              )}
            </div>
            <DetailRow label="Category" value={selectedTicket.category ?? "General"} />
            <DetailRow label="Priority" value={selectedTicket.priority} />
            <DetailRow
              label="Created"
              value={new Date(selectedTicket.created_at).toLocaleString()}
              mono
            />

            <div className="border-t border-border/50 px-6 py-4 space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Conversation
              </div>
              <div className="rounded-md border border-border/60 bg-surface-2 px-3 py-2">
                <p className="text-[12px] text-foreground/90 whitespace-pre-wrap">
                  {selectedTicket.body}
                </p>
              </div>
              {replies.map((r) => (
                <div
                  key={r.id}
                  className="rounded-md border border-border/60 bg-surface-2 px-3 py-2"
                >
                  <div className="mb-1 font-mono text-[9px] text-muted-foreground/80">
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                  <p className="text-[12px] text-foreground/90 whitespace-pre-wrap">{r.body}</p>
                </div>
              ))}
            </div>

            {canEdit && !["closed"].includes(selectedTicket.status) && (
              <div className="border-t border-border/50 px-6 py-4">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                  Reply
                </div>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground/80 outline-none placeholder:text-muted-foreground/60"
                  placeholder="Type your reply…"
                />
                <button
                  onClick={handleReply}
                  disabled={addReply.isPending || !replyText.trim()}
                  className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 font-mono text-[11px] text-foreground hover:bg-blue-700 disabled:opacity-50"
                >
                  Send Reply
                </button>
              </div>
            )}
          </div>
        )}
      </DetailPanel>
    </AppShell>
  );
}
