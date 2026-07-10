import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guards";
import { useMemo, useState } from "react";
import {
  Search, Filter, Download, CheckCircle2, Loader2, XCircle,
  MoreHorizontal, Eye,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NoSectionAccess } from "@/components/section-gate";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import { useExtractions } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import type { DocumentCategory, DocumentRow } from "@/lib/supabase/types";

type DocWithCategory = DocumentRow & { category?: DocumentCategory | null };

export const Route = createFileRoute("/history")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Extraction history — HelloData" }] }),
  component: History,
});

const filters = ["All", "Done", "Processing", "Failed"];
const dateFilters = [
  { id: "all", label: "All dates" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
] as const;

type DateFilter = (typeof dateFilters)[number]["id"];

function statusConfig(s: string) {
  if (s === "done")
    return { label: "Done",       color: "text-brand-lime border-brand-lime/30 bg-brand-lime/10", icon: CheckCircle2 };
  if (s === "processing")
    return { label: "Processing", color: "text-amber-400 border-amber-400/30 bg-amber-400/10",     icon: Loader2     };
  if (s === "failed")
    return { label: "Failed",     color: "text-red-400 border-red-400/30 bg-red-400/10",           icon: XCircle     };
  return { label: s, color: "text-muted-foreground border-border bg-surface-2", icon: CheckCircle2 };
}

function withinDateFilter(date: string, filter: DateFilter) {
  if (filter === "all") return true;
  const created = new Date(date).getTime();
  if (!Number.isFinite(created)) return true;
  const now = new Date();
  if (filter === "today") return new Date(date).toDateString() === now.toDateString();
  const days = filter === "7d" ? 7 : 30;
  return created >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function rowsToCsv(headers: string[], data: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers, ...data].map((row) => row.map(escape).join(",")).join("\r\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function History() {
  const { currentOrg } = useAuth();
  const sectionLevel = useSectionAccess("history");
  const { data: rows = [], isLoading } = useExtractions(currentOrg?.id, 100);
  const [active, setActive] = useState("All");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const s = r.status === "done" ? "done" : r.status === "processing" || r.status === "queued" ? "processing" : r.status === "failed" ? "failed" : "other";
        if (active !== "All" && s !== active.toLowerCase()) return false;
        if (!withinDateFilter(r.created_at, dateFilter)) return false;
        const q = query.trim().toLowerCase();
        if (q) {
          const data = r.data && typeof r.data === "object" && !Array.isArray(r.data)
            ? JSON.stringify(r.data)
            : "";
          const haystack = [
            r.id,
            r.status,
            r.document?.file_name ?? "",
            (r.document as DocWithCategory | null)?.category?.name ?? "",
            data,
          ].join(" ").toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      }),
    [rows, active, query, dateFilter],
  );

  function exportHistory() {
    const csv = rowsToCsv(
      ["ID", "File", "Category", "Fields", "Status", "Date", "Duration"],
      filtered.map((r) => [
        `EXT-${r.id.slice(0, 6).toUpperCase()}`,
        r.document?.file_name ?? "",
        (r.document as DocWithCategory | null)?.category?.name ?? "",
        String(r.field_count ?? ""),
        r.status,
        formatDateTime(r.created_at),
        r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "",
      ]),
    );
    downloadCsv(`billsos-history-${Date.now()}.csv`, csv);
  }

  const counts = useMemo(
    () => ({
      All: rows.length,
      Done: rows.filter((r) => r.status === "done").length,
      Processing: rows.filter((r) => r.status === "processing" || r.status === "queued").length,
      Failed: rows.filter((r) => r.status === "failed").length,
    }),
    [rows],
  );

  if (sectionLevel === "none") {
    return (
      <AppShell title="Extraction history">
        <NoSectionAccess section="history" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Extraction history">
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-1.5">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setActive(f)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  active === f ? "bg-surface text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"
                }`}
              >
                {f}
                <span className="font-mono text-[10px] text-muted-foreground">
                  {counts[f as keyof typeof counts]}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files…"
                className="w-40 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors ${
                showFilters || dateFilter !== "all"
                  ? "border-brand-blue/40 bg-brand-blue/10 text-brand-blue"
                  : "border-border bg-surface hover:bg-surface-2"
              }`}
            >
              <Filter className="h-3.5 w-3.5" /> Filter
            </button>
            <button
              onClick={exportHistory}
              disabled={filtered.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Export all
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Date</span>
              {dateFilters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setDateFilter(f.id)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                    dateFilter === f.id
                      ? "border-brand-blue/40 bg-brand-blue/10 text-brand-blue"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setActive("All");
                setDateFilter("all");
                setQuery("");
              }}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-20 text-center text-sm text-muted-foreground">No extractions yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border">
                  {["ID","File","Category","Fields","Status","Date","Duration",""].map((h, i) => (
                    <th
                      key={h + i}
                      className={`whitespace-nowrap px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${
                        h === "Fields" || h === "Duration" ? "text-right" : "text-left"
                      } ${i === 0 ? "pl-6" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const sc = statusConfig(r.status);
                  const Icon = sc.icon;
                  return (
                    <tr key={r.id} className="group border-b border-border transition-colors hover:bg-surface">
                      <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-muted-foreground">
                        EXT-{r.id.slice(0, 6).toUpperCase()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background">
                            <FileIcon />
                          </div>
                          <span className="font-mono text-xs">{r.document?.file_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {(r.document as DocWithCategory | null)?.category?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs">{r.field_count}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${sc.color}`}>
                          <Icon className={`h-3 w-3 ${r.status === "processing" || r.status === "queued" ? "animate-spin" : ""}`} />
                          {sc.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(r.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Link
                            to="/configure"
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Eye className="h-3 w-3" /> View
                          </Link>
                          <button className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-3 text-xs">
          <div className="font-mono text-muted-foreground">
            Showing {filtered.length} of {rows.length}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-muted-foreground">
      <path d="M2 1h5l3 3v7H2V1z" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M7 1v3h3" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}
