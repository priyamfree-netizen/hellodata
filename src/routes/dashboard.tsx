import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guards";
import { motion } from "framer-motion";
import {
  Upload, Sparkles, CheckCircle2, AlertCircle, MoreHorizontal,
  ArrowUpRight, Download, Loader2,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth/context";
import {
  useProcessingJobs,
  useExports,
  useSubscription,
  useUsageRecords,
} from "@/lib/queries";
import { formatBytes, formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Dashboard — HelloData" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id;

  const { data: jobs = [], isLoading: jobsLoading } = useProcessingJobs(orgId, 8);
  const { data: exportsList = [] } = useExports(orgId, 3);
  const { data: sub } = useSubscription(orgId);
  const { data: usage = [] } = useUsageRecords(orgId, 30);

  const last30Pages = usage.reduce((s, r) => s + Number(r.pages_processed ?? 0), 0);
  const activeJobs = jobs.filter((j) =>
    ["pending", "queued", "ocr", "ai_extraction", "validation", "export", "retry"].includes(j.stage),
  );
  const completedJobs = jobs.filter((j) => j.stage === "completed");

  const avgConfidence =
    completedJobs.length > 0
      ? (completedJobs.reduce((s, j) => s + Number(j.confidence ?? 0), 0) / completedJobs.length).toFixed(1)
      : "—";

  const dailyLimit = sub?.plan?.page_limit ?? null;
  const todayPages = usage.find((u) => u.date === new Date().toISOString().slice(0, 10))?.pages_processed ?? 0;
  const concurrency = sub?.plan?.concurrency ?? 1;

  return (
    <AppShell title="Overview">
      <div className="space-y-6 p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            {
              l: "Documents processed",
              v: last30Pages.toLocaleString("en-IN"),
              d: "Last 30 days",
              c: "text-brand-lime",
            },
            {
              l: "In active queue",
              v: activeJobs.length.toString(),
              d: jobsLoading ? "loading" : "live",
              c: "text-brand-blue",
            },
            {
              l: "Avg accuracy",
              v: avgConfidence === "—" ? "—" : `${avgConfidence}%`,
              d: "Completed jobs",
              c: "text-muted-foreground",
            },
            {
              l: "Hours saved",
              v: Math.round(last30Pages * 0.1).toLocaleString("en-IN"),
              d: "Est. @ 6min/doc",
              c: "text-muted-foreground",
            },
          ].map((s) => (
            <div key={s.l} className="rounded-xl border border-border bg-surface p-5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">{s.v}</div>
              <div className={`mt-1 text-xs ${s.c}`}>{s.d}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* Upload */}
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-border bg-surface p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-medium tracking-tight">Upload documents</h3>
                <p className="text-xs text-muted-foreground">PDF, JPG, PNG, TIFF or ZIP — up to 100 MB per file.</p>
              </div>
            </div>

            <div className="relative mt-5 overflow-hidden rounded-xl border border-dashed border-border bg-background p-10 text-center">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px animate-scan bg-gradient-to-r from-transparent via-brand-blue to-transparent" />
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface">
                <Upload className="h-5 w-5" />
              </div>
              <div className="mt-4 text-sm font-medium">Drop documents here, or click to browse</div>
              <div className="mt-1 text-xs text-muted-foreground">AI will auto-detect document type · batched processing enabled</div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <Link to="/upload" className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-xs font-medium text-background hover:opacity-90">
                  <Sparkles className="h-3.5 w-3.5" /> Select files
                </Link>
                <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-xs hover:bg-surface-2">
                  Upload from URL
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
              {[
                {
                  l: "Daily quota",
                  v: dailyLimit
                    ? `${todayPages.toLocaleString("en-IN")} / ${dailyLimit.toLocaleString("en-IN")}`
                    : `${todayPages.toLocaleString("en-IN")} / ∞`,
                },
                { l: "Avg time / doc", v: completedJobs[0]?.duration_ms ? `${(completedJobs[0].duration_ms / 1000).toFixed(1)}s` : "—" },
                { l: "Concurrent workers", v: String(concurrency) },
              ].map((s) => (
                <div key={s.l} className="rounded-lg border border-border bg-background p-3">
                  <div className="text-muted-foreground">{s.l}</div>
                  <div className="mt-1 font-mono">{s.v}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* AI status */}
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-base font-medium tracking-tight">AI status</h3>
            <p className="text-xs text-muted-foreground">Live extraction pipeline</p>
            <div className="mt-5 space-y-4">
              {[
                { l: "Document classifier", v: "Healthy", c: "bg-brand-lime" },
                { l: "Field extractor v3.1", v: "Healthy", c: "bg-brand-lime" },
                { l: "Tax rules engine", v: "Healthy", c: "bg-brand-lime" },
                { l: "Vector store", v: "Indexing", c: "bg-brand-blue" },
              ].map((s) => (
                <div key={s.l} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-1.5 w-1.5 animate-pulse-dot rounded-full ${s.c}`} />
                    <span className="text-sm">{s.l}</span>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{s.v}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-border bg-background p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Last 16 days</div>
              <div className="mt-2 flex items-end gap-1.5">
                {(usage.slice(-16).length > 0 ? usage.slice(-16) : Array.from({ length: 16 }, () => ({ pages_processed: 0 }))).map(
                  (u, i, arr) => {
                    const max = Math.max(1, ...arr.map((x) => Number(x.pages_processed ?? 0)));
                    const h = (Number(u.pages_processed ?? 0) / max) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{ height: Math.max(2, h), background: i > 10 ? "var(--brand-blue)" : "var(--color-border)" }}
                      />
                    );
                  },
                )}
              </div>
              <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>-16d</span><span>-8d</span><span>today</span>
              </div>
            </div>
          </div>
        </div>

        {/* Jobs */}
        <div className="rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h3 className="text-base font-medium tracking-tight">Recent processing jobs</h3>
              <p className="text-xs text-muted-foreground">Last 24 hours</p>
            </div>
            <Link to="/output" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          {jobsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="text-sm text-muted-foreground">No jobs yet — upload some documents to get started.</div>
              <Link to="/upload" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-blue hover:underline">
                <Upload className="h-3 w-3" /> Upload documents
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              <div className="grid grid-cols-12 gap-4 px-6 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="col-span-1">Job</div>
                <div className="col-span-4">Name</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-1 text-right">Docs</div>
                <div className="col-span-3">Progress</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>
              {jobs.map((j) => {
                const progress =
                  j.total_docs > 0 ? Math.round((j.completed_docs / j.total_docs) * 100) : 0;
                const status = j.stage === "completed" ? "done" : j.stage === "failed" ? "error" : "processing";
                return (
                  <div
                    key={j.id}
                    className="grid grid-cols-12 items-center gap-4 px-6 py-4 text-sm transition-colors hover:bg-surface-2"
                  >
                    <div className="col-span-1 font-mono text-[11px] text-muted-foreground">
                      JOB-{String(j.job_number).padStart(4, "0")}
                    </div>
                    <div className="col-span-4 truncate font-medium">{j.name}</div>
                    <div className="col-span-2 text-muted-foreground">{j.stage}</div>
                    <div className="col-span-1 text-right font-mono text-xs">{j.total_docs}</div>
                    <div className="col-span-3">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                          <div
                            className={`h-full ${status === "error" ? "bg-destructive" : status === "done" ? "bg-brand-lime" : "bg-brand-blue"}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="w-12 font-mono text-[10px] text-muted-foreground">{progress}%</span>
                      </div>
                    </div>
                    <div className="col-span-1 flex items-center justify-end gap-1">
                      {status === "done" && <CheckCircle2 className="h-4 w-4 text-brand-lime" />}
                      {status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                      {status === "processing" && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand-blue" />}
                      <button className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Export history */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-base font-medium tracking-tight">Export history</h3>
            <div className="mt-4 space-y-3">
              {exportsList.length === 0 ? (
                <div className="text-xs text-muted-foreground">No exports yet.</div>
              ) : (
                exportsList.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border">
                        <Download className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="font-mono text-xs">{e.file_name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatBytes(e.size_bytes)} · {formatRelativeTime(e.created_at)}
                        </div>
                      </div>
                    </div>
                    <button className="text-xs text-muted-foreground hover:text-foreground">Re-download</button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-base font-medium tracking-tight">Quick start</h3>
            <div className="mt-4 space-y-2">
              {[
                { t: "Upload documents", to: "/upload" },
                { t: "Browse document categories", to: "/categories" },
                { t: "Watch live processing", to: "/processing" },
                { t: "View extraction history", to: "/history" },
              ].map((q) => (
                <Link key={q.to} to={q.to} className="group flex items-center justify-between rounded-lg border border-border bg-background p-3 text-sm transition-colors hover:bg-surface-2">
                  {q.t}
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
