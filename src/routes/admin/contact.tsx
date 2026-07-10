import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { DetailPanel, DetailRow } from "@/components/admin/detail-panel";
import { useContactSubmissions, useUpdateContactSubmissionStatus } from "@/lib/queries";
import type { ContactSubmissionStatus } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/contact")({
  component: ContactSubmissions,
});

const STATUS_OPTIONS: ContactSubmissionStatus[] = ["new", "contacted", "archived"];

function StatusPill({ status }: { status: ContactSubmissionStatus }) {
  const style =
    status === "new"
      ? "border-blue-500/20 bg-blue-500/10 text-blue-400"
      : status === "contacted"
        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
        : "border-zinc-600/20 text-muted-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${style}`}>
      {status}
    </span>
  );
}

function ContactSubmissions() {
  const { data: submissions = [], isLoading } = useContactSubmissions();
  const updateStatus = useUpdateContactSubmissionStatus();
  const [statusFilter, setStatusFilter] = useState<"all" | ContactSubmissionStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered =
    statusFilter === "all" ? submissions : submissions.filter((s) => s.status === statusFilter);
  const selected = submissions.find((s) => s.id === selectedId) ?? null;
  const newCount = submissions.filter((s) => s.status === "new").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Contact Submissions</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            {submissions.length} messages from the public contact form
          </p>
        </div>
        {newCount > 0 && (
          <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 font-mono text-[10px] text-blue-400">
            {newCount} new
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {(["all", ...STATUS_OPTIONS] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${
              statusFilter === f
                ? "bg-blue-600/10 text-blue-400 border border-blue-600/20"
                : "text-muted-foreground/80 hover:text-foreground/80"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                {["Name", "Company", "Email", "Phone", "Status", "Received"].map((h) => (
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
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-[13px] text-foreground/90">{s.name}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {s.company ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-foreground/80">{s.email}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                    {s.phone}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80">
                    {new Date(s.created_at).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <MessageSquare className="h-6 w-6 text-muted-foreground/60" />
                      <p className="text-sm">No submissions here yet.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailPanel
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? ""}
        subtitle={selected?.email}
      >
        {selected && (
          <div>
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
              <StatusPill status={selected.status} />
              <a
                href={`mailto:${selected.email}`}
                className="flex items-center gap-1.5 rounded-md border border-border/80 px-3 py-1.5 font-mono text-[11px] text-foreground/80 hover:bg-muted"
              >
                <Mail className="h-3 w-3" /> Reply by email
              </a>
            </div>
            <DetailRow label="Name" value={selected.name} />
            <DetailRow label="Company" value={selected.company ?? "—"} />
            <DetailRow label="Email" value={selected.email} mono />
            <DetailRow label="Phone" value={selected.phone} mono />
            <DetailRow
              label="Status"
              value={
                <select
                  value={selected.status}
                  onChange={(e) =>
                    updateStatus.mutate({
                      id: selected.id,
                      status: e.target.value as ContactSubmissionStatus,
                    })
                  }
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-foreground/80 outline-none"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              }
            />
            <DetailRow
              label="Received"
              value={new Date(selected.created_at).toLocaleString()}
              mono
            />

            <div className="border-t border-border/50 px-6 py-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Message
              </div>
              <div className="rounded-md border border-border/60 bg-surface-2 px-3 py-2">
                <p className="text-[12px] text-foreground/90 whitespace-pre-wrap">
                  {selected.message}
                </p>
              </div>
            </div>
          </div>
        )}
      </DetailPanel>
    </div>
  );
}
