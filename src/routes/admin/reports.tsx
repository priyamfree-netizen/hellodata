import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  FileText, Download, Calendar, Filter, X, Loader2,
  CheckCircle2, XCircle, Clock, History,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { getTokenPayload } from "@/lib/auth/client";
import {
  useReportStats,
  useReportRuns,
  useReportTemplates,
  useInsertReportRun,
} from "@/lib/queries";

export const Route = createFileRoute("/admin/reports")({
  component: EnterpriseReports,
});

// ── Excel-compatible CSV helpers ──────────────────────────────────────────────

function rowsToExcelCsv(headers: string[], data: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers, ...data].map((row) => row.map(escape).join(",")).join("\r\n");
  // BOM makes Excel open UTF-8 CSV correctly (handles ₹, Indian names, etc.)
  return "﻿" + lines;
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return blob.size;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exp).toFixed(1)} ${units[exp]}`;
}

function monthStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Report generators (keyed by template key) ─────────────────────────────────

type Row = Record<string, unknown>;
interface ReportResult { headers: string[]; rows: string[][] }

const GENERATORS: Record<string, (from: string, to: string) => Promise<ReportResult>> = {
  async revenue(from, to) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, created_at, organization_id, amount_inr, status, type")
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw error;
    return {
      headers: ["Transaction ID", "Date", "Org ID", "Amount (INR)", "Status", "Type"],
      rows: (data ?? []).map((r: Row) => [
        String(r.id ?? ""),
        String(r.created_at ?? "").slice(0, 10),
        String(r.organization_id ?? ""),
        String(r.amount_inr ?? "0"),
        String(r.status ?? ""),
        String(r.type ?? ""),
      ]),
    };
  },

  async sla(from, to) {
    const { data, error } = await supabase
      .from("processing_jobs")
      .select("id, stage, organization_id, created_at, started_at, completed_at, error_message")
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw error;
    return {
      headers: ["Job ID", "Stage", "Org ID", "Created", "Started", "Completed", "Duration (s)", "Error"],
      rows: (data ?? []).map((r: Row) => {
        const s = r.started_at ? new Date(r.started_at as string).getTime() : null;
        const e = r.completed_at ? new Date(r.completed_at as string).getTime() : null;
        return [
          String(r.id ?? ""),
          String(r.stage ?? ""),
          String(r.organization_id ?? ""),
          String(r.created_at ?? "").slice(0, 16).replace("T", " "),
          r.started_at ? String(r.started_at).slice(0, 16).replace("T", " ") : "—",
          r.completed_at ? String(r.completed_at).slice(0, 16).replace("T", " ") : "—",
          s && e ? String(((e - s) / 1000).toFixed(1)) : "—",
          String(r.error_message ?? ""),
        ];
      }),
    };
  },

  async usage(from, to) {
    const { data, error } = await supabase
      .from("usage_records")
      .select("date, organization_id, metric, value, unit")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
      .limit(10000);
    if (error) throw error;
    return {
      headers: ["Date", "Org ID", "Metric", "Value", "Unit"],
      rows: (data ?? []).map((r: Row) => [
        String(r.date ?? ""),
        String(r.organization_id ?? ""),
        String(r.metric ?? ""),
        String(r.value ?? ""),
        String(r.unit ?? ""),
      ]),
    };
  },

  async churn(from, to) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id, organization_id, plan_id, status, started_at, ended_at, cancelled_at")
      .in("status", ["cancelled", "expired"])
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw error;
    return {
      headers: ["Subscription ID", "Org ID", "Plan ID", "Status", "Started", "Cancelled", "Ended"],
      rows: (data ?? []).map((r: Row) => [
        String(r.id ?? ""),
        String(r.organization_id ?? ""),
        String(r.plan_id ?? ""),
        String(r.status ?? ""),
        String(r.started_at ?? "").slice(0, 10),
        r.cancelled_at ? String(r.cancelled_at).slice(0, 10) : "—",
        r.ended_at ? String(r.ended_at).slice(0, 10) : "—",
      ]),
    };
  },

  async accuracy(from, to) {
    const { data, error } = await supabase
      .from("extractions")
      .select("id, organization_id, document_id, status, confidence_score, field_count, created_at")
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw error;
    return {
      headers: ["Extraction ID", "Org ID", "Document ID", "Status", "Confidence %", "Fields", "Date"],
      rows: (data ?? []).map((r: Row) => [
        String(r.id ?? ""),
        String(r.organization_id ?? ""),
        String(r.document_id ?? ""),
        String(r.status ?? ""),
        r.confidence_score != null
          ? `${(Number(r.confidence_score) * 100).toFixed(1)}%`
          : "—",
        String(r.field_count ?? ""),
        String(r.created_at ?? "").slice(0, 10),
      ]),
    };
  },

  async retention(from, to) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, action, actor_id, organization_id, resource_type, resource_id, created_at")
      .ilike("action", "%delete%")
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw error;
    return {
      headers: ["Log ID", "Action", "Actor ID", "Org ID", "Resource Type", "Resource ID", "Date"],
      rows: (data ?? []).map((r: Row) => [
        String(r.id ?? ""),
        String(r.action ?? ""),
        String(r.actor_id ?? ""),
        String(r.organization_id ?? ""),
        String(r.resource_type ?? ""),
        String(r.resource_id ?? ""),
        String(r.created_at ?? "").slice(0, 16).replace("T", " "),
      ]),
    };
  },
};

// Fallback generator: queries the table generically from DB template columns config
async function genericGenerate(
  sourceTable: string,
  columns: { key: string; label: string }[],
  dateField: string,
  from: string,
  to: string,
): Promise<ReportResult> {
  const colStr = columns.map((c) => c.key).join(",");
  const isDateOnly = dateField === "date";
  const fromVal = isDateOnly ? from : `${from}T00:00:00`;
  const toVal = isDateOnly ? to : `${to}T23:59:59`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from(sourceTable)
    .select(colStr)
    .gte(dateField, fromVal)
    .lte(dateField, toVal)
    .order(dateField, { ascending: false })
    .limit(10000);
  if (error) throw error;
  return {
    headers: columns.map((c) => c.label),
    rows: (data ?? []).map((r: Row) => columns.map((c) => String(r[c.key] ?? ""))),
  };
}

// ── Custom report sources ─────────────────────────────────────────────────────

const CUSTOM_SOURCES = [
  { id: "transactions", label: "Transactions (Financial)", table: "transactions", dateField: "created_at", columns: [{ key: "id", label: "ID" }, { key: "created_at", label: "Date" }, { key: "organization_id", label: "Org ID" }, { key: "amount_inr", label: "Amount (INR)" }, { key: "status", label: "Status" }, { key: "type", label: "Type" }] },
  { id: "users", label: "Users & Signups", table: "profiles", dateField: "created_at", columns: [{ key: "id", label: "User ID" }, { key: "email", label: "Email" }, { key: "first_name", label: "First Name" }, { key: "last_name", label: "Last Name" }, { key: "status", label: "Status" }, { key: "created_at", label: "Signup Date" }] },
  { id: "processing_jobs", label: "Processing Jobs", table: "processing_jobs", dateField: "created_at", columns: [{ key: "id", label: "Job ID" }, { key: "stage", label: "Stage" }, { key: "organization_id", label: "Org ID" }, { key: "created_at", label: "Created" }, { key: "completed_at", label: "Completed" }, { key: "error_message", label: "Error" }] },
  { id: "extractions", label: "ExDoc Extractions", table: "extractions", dateField: "created_at", columns: [{ key: "id", label: "ID" }, { key: "organization_id", label: "Org ID" }, { key: "document_id", label: "Document ID" }, { key: "status", label: "Status" }, { key: "confidence_score", label: "Confidence" }, { key: "field_count", label: "Fields" }, { key: "created_at", label: "Date" }] },
  { id: "organizations", label: "Organizations", table: "organizations", dateField: "created_at", columns: [{ key: "id", label: "Org ID" }, { key: "name", label: "Name" }, { key: "slug", label: "Slug" }, { key: "status", label: "Status" }, { key: "plan_id", label: "Plan ID" }, { key: "created_at", label: "Created" }] },
  { id: "subscriptions", label: "Subscriptions", table: "subscriptions", dateField: "created_at", columns: [{ key: "id", label: "ID" }, { key: "organization_id", label: "Org ID" }, { key: "plan_id", label: "Plan ID" }, { key: "status", label: "Status" }, { key: "started_at", label: "Started" }, { key: "ended_at", label: "Ended" }] },
  { id: "audit_logs", label: "Audit Logs", table: "audit_logs", dateField: "created_at", columns: [{ key: "id", label: "ID" }, { key: "action", label: "Action" }, { key: "actor_id", label: "Actor ID" }, { key: "organization_id", label: "Org ID" }, { key: "resource_type", label: "Resource" }, { key: "created_at", label: "Date" }] },
];

// ── Component ─────────────────────────────────────────────────────────────────

function EnterpriseReports() {
  const { data: statsData } = useReportStats();
  const { data: templates = [] } = useReportTemplates();
  const { data: runs = [] } = useReportRuns(50);
  const insertRun = useInsertReportRun();

  // Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCat, setFilterCat] = useState("All");
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(todayStr());

  // Per-report loading
  const [runningKey, setRunningKey] = useState<string | null>(null);

  // Custom report dialog
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customSourceId, setCustomSourceId] = useState("transactions");
  const [customFrom, setCustomFrom] = useState(monthStart());
  const [customTo, setCustomTo] = useState(todayStr());
  const [customRunning, setCustomRunning] = useState(false);
  const [customError, setCustomError] = useState("");

  // Derive last-run info from DB runs
  const lastRunByKey = runs.reduce<Record<string, (typeof runs)[0]>>((acc, r) => {
    if (!acc[r.report_key]) acc[r.report_key] = r;
    return acc;
  }, {});

  const categories = ["All", ...Array.from(new Set(templates.map((t) => t.category)))];
  const visibleTemplates =
    filterCat === "All" ? templates : templates.filter((t) => t.category === filterCat);

  async function handleDownload(templateKey: string, templateName: string) {
    const generator = GENERATORS[templateKey];
    if (!generator) return;
    setRunningKey(templateKey);

    const payload = getTokenPayload();
    const generatedBy = payload?.sub ?? null;
    let rowCount = 0;
    let fileSizeBytes = 0;
    let fileName = "";

    try {
      const { headers, rows } = await generator(dateFrom, dateTo);
      rowCount = rows.length;
      const csv = rowsToExcelCsv(headers, rows);
      fileName = `billsos-${templateKey}-${dateFrom}_to_${dateTo}.csv`;
      fileSizeBytes = downloadCsv(fileName, csv);

      await insertRun.mutateAsync({
        report_key: templateKey,
        report_name: templateName,
        generated_by: generatedBy,
        date_from: dateFrom,
        date_to: dateTo,
        row_count: rowCount,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
        status: "completed",
        error_message: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate report";
      await insertRun.mutateAsync({
        report_key: templateKey,
        report_name: templateName,
        generated_by: generatedBy,
        date_from: dateFrom,
        date_to: dateTo,
        row_count: 0,
        file_name: null,
        file_size_bytes: 0,
        status: "failed",
        error_message: msg,
      }).catch(() => {});
    } finally {
      setRunningKey(null);
    }
  }

  async function handleCustomGenerate() {
    if (!customName.trim()) { setCustomError("Report name is required"); return; }
    setCustomRunning(true);
    setCustomError("");
    const payload = getTokenPayload();
    try {
      const src = CUSTOM_SOURCES.find((s) => s.id === customSourceId)!;
      const { headers, rows } = await genericGenerate(
        src.table, src.columns, src.dateField, customFrom, customTo,
      );
      const csv = rowsToExcelCsv(headers, rows);
      const fileName = `billsos-custom-${customSourceId}-${customFrom}_to_${customTo}.csv`;
      const fileSizeBytes = downloadCsv(fileName, csv);

      await insertRun.mutateAsync({
        report_key: `custom_${customSourceId}`,
        report_name: customName,
        generated_by: payload?.sub ?? null,
        date_from: customFrom,
        date_to: customTo,
        row_count: rows.length,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
        status: "completed",
        error_message: null,
      });
      setCustomOpen(false);
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setCustomRunning(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Enterprise Reports</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            Automated reporting, compliance audits & Excel exports
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilterOpen((o) => !o)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
              filterOpen || filterCat !== "All"
                ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                : "border-border/80 bg-muted text-foreground/80 hover:text-foreground"
            }`}
          >
            <Filter className="h-3 w-3" /> Filters
            {filterCat !== "All" && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-400" />}
          </button>
          <button
            onClick={() => { setCustomOpen(true); setCustomName(""); setCustomError(""); setCustomFrom(monthStart()); setCustomTo(todayStr()); setCustomSourceId("transactions"); }}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-blue-700"
          >
            <FileText className="h-3 w-3" /> New Custom Report
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Scheduled Reports", value: String(templates.length || 6) },
          { label: "Generated This Month", value: statsData ? String(statsData.generatedThisMonth) : "—" },
          { label: "Storage Used (Reports)", value: statsData ? formatBytes(statsData.storageBytes) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-surface p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">{label}</div>
            <div className="mt-2 font-mono text-2xl font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium text-foreground/80">Filter reports</span>
            <button onClick={() => { setFilterCat("All"); setDateFrom(monthStart()); setDateTo(todayStr()); }}
              className="font-mono text-[10px] text-muted-foreground/70 hover:text-foreground/70 transition-colors">Reset</button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">Category</label>
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-blue-500/50">
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-blue-500/50" />
            </div>
          </div>
        </div>
      )}

      {/* Standard Reports table */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">Standard Reports</h3>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            Range: {dateFrom} → {dateTo}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/50">
                {["Report Name", "Category", "Schedule", "Last Generated", "Rows", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {visibleTemplates.map((tmpl) => {
                const isRunning = runningKey === tmpl.key;
                const lastRun = lastRunByKey[tmpl.key];
                const generator = GENERATORS[tmpl.key];

                return (
                  <tr key={tmpl.key} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-medium text-foreground/90">{tmpl.name}</div>
                      {tmpl.description && (
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/50 max-w-xs truncate">
                          {tmpl.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-border/80 bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground/80">
                        {tmpl.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 shrink-0" /> {tmpl.schedule}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {lastRun ? fmtDate(lastRun.created_at) : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {lastRun ? lastRun.row_count.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {isRunning ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-blue-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" /> running
                        </span>
                      ) : !lastRun ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground/50">
                          <Clock className="h-3 w-3" /> idle
                        </span>
                      ) : lastRun.status === "completed" ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-500">
                          <CheckCircle2 className="h-3 w-3" /> ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-red-400">
                          <XCircle className="h-3 w-3" /> failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!generator ? (
                        <span className="font-mono text-[10px] text-muted-foreground/40">unavailable</span>
                      ) : (
                        <button
                          onClick={() => handleDownload(tmpl.key, tmpl.name)}
                          disabled={!!runningKey}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted px-2.5 py-1.5 font-mono text-[10px] text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isRunning ? (
                            <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
                          ) : (
                            <><Download className="h-3 w-3" /> Excel / CSV</>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {visibleTemplates.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center font-mono text-[11px] text-muted-foreground/50">
                    {templates.length === 0
                      ? "Run the migration to load report templates from the database."
                      : "No reports match the selected category."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generated Reports History */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <History className="h-4 w-4 text-muted-foreground/60" />
          <h3 className="text-sm font-medium">Generated Reports History</h3>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
            {runs.length} total
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/50">
                {["Report Name", "Date Range", "Rows", "File Size", "Status", "Generated At"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-muted-foreground/50">
                    No reports generated yet — click "Excel / CSV" on any report above to generate your first one.
                  </td>
                </tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-[13px] text-foreground/90">{run.report_name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground/50">{run.report_key}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                    {run.date_from} → {run.date_to}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-foreground/80">
                    {run.row_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                    {formatBytes(run.file_size_bytes)}
                  </td>
                  <td className="px-4 py-3">
                    {run.status === "completed" ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-500">
                        <CheckCircle2 className="h-3 w-3" /> completed
                      </span>
                    ) : (
                      <div>
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-red-400">
                          <XCircle className="h-3 w-3" /> failed
                        </span>
                        {run.error_message && (
                          <div className="mt-0.5 font-mono text-[9px] text-red-400/70 max-w-[200px] truncate" title={run.error_message}>
                            {run.error_message}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80">
                    {fmtDate(run.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Custom Report Dialog ───────────────────────────────────────────── */}
      {customOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !customRunning && setCustomOpen(false)} />
          <div className="relative z-10 mx-4 w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <span className="text-sm font-semibold">New Custom Report</span>
              <button onClick={() => !customRunning && setCustomOpen(false)} className="rounded-md p-1 text-muted-foreground/80 hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Report Name</label>
                <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Q1 Revenue Summary"
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-blue-500/50" />
              </div>

              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Data Source</label>
                <select value={customSourceId} onChange={(e) => setCustomSourceId(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground outline-none focus:border-blue-500/50">
                  {CUSTOM_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <div className="mt-2 flex flex-wrap gap-1">
                  {CUSTOM_SOURCES.find((s) => s.id === customSourceId)?.columns.map((c) => (
                    <span key={c.key} className="rounded border border-border/80 bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70">{c.label}</span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">From</label>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground outline-none focus:border-blue-500/50" />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">To</label>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground outline-none focus:border-blue-500/50" />
                </div>
              </div>

              {customError && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 font-mono text-[11px] text-red-400">
                  {customError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <button onClick={() => !customRunning && setCustomOpen(false)} disabled={customRunning}
                className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground/80 hover:bg-muted hover:text-foreground/80 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleCustomGenerate} disabled={customRunning}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                {customRunning
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                  : <><Download className="h-3 w-3" /> Generate & Download</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
