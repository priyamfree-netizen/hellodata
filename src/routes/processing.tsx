import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guards";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader2, Pause, ArrowRight, Cpu } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NoSectionAccess } from "@/components/section-gate";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import { useProcessingJobs } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/processing")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Processing — HelloData" }] }),
  component: Processing,
});

function Processing() {
  const { currentOrg } = useAuth();
  const sectionLevel = useSectionAccess("process");
  const qc = useQueryClient();
  const { data: jobs = [], isLoading } = useProcessingJobs(currentOrg?.id, 50);

  useEffect(() => {
    if (!currentOrg?.id) return;
    const channel = supabase
      .channel(`processing-jobs-${currentOrg.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "processing_jobs",
          filter: `organization_id=eq.${currentOrg.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["processing-jobs", currentOrg.id] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentOrg?.id, qc]);

  const activeStages = [
    "pending",
    "queued",
    "ocr",
    "ai_extraction",
    "validation",
    "export",
    "retry",
  ];
  const activeJob = jobs.find((j) => activeStages.includes(j.stage));
  const recentJobs = jobs.slice(0, 14);
  const failed = jobs.filter((j) => j.stage === "failed").slice(0, 2);

  if (sectionLevel === "none") {
    return (
      <AppShell title="Processing">
        <NoSectionAccess section="process" />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell title="Processing">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!activeJob) {
    return (
      <AppShell title="Processing">
        <div className="space-y-6 p-6">
          <div className="rounded-2xl border border-border bg-surface p-10 text-center">
            <Cpu className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-medium">No active jobs</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload documents to start a processing job.
            </p>
            <Link
              to="/upload"
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
            >
              Upload documents
            </Link>
          </div>
          {recentJobs.length > 0 && <RecentJobsGrid jobs={recentJobs} />}
        </div>
      </AppShell>
    );
  }

  const totalDocs = activeJob.total_docs || 1;
  const progress = Math.round((activeJob.completed_docs / totalDocs) * 100);
  const stageOrder = ["queued", "ocr", "ai_extraction", "validation", "export"];
  const currentStageIdx = stageOrder.indexOf(activeJob.stage);
  const timeline = [
    { l: "Queued", v: `${totalDocs} documents` },
    { l: "Classified", v: `${activeJob.completed_docs + activeJob.failed_docs} / ${totalDocs}` },
    { l: "Extracting fields", v: `${activeJob.completed_docs} / ${totalDocs}` },
    { l: "Validating", v: "—" },
    { l: "Export ready", v: activeJob.stage === "completed" ? "Yes" : "—" },
  ].map((t, i) => ({
    ...t,
    state:
      activeJob.stage === "completed" || i < currentStageIdx
        ? "done"
        : i === currentStageIdx
          ? "active"
          : "pending",
  }));

  return (
    <AppShell title="Processing">
      <div className="space-y-6 p-6">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" />
                <span className="font-mono">
                  JOB-{String(activeJob.job_number).padStart(5, "0")}
                </span>
              </div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">{activeJob.name}</h2>
              <div className="mt-1 text-sm text-muted-foreground">
                {activeJob.completed_docs} of {totalDocs} processed
                {activeJob.started_at && ` · started ${formatRelativeTime(activeJob.started_at)}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm hover:bg-surface-2">
                <Pause className="h-3.5 w-3.5" /> Pause
              </button>
              <Link
                to="/output"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
              >
                Open dataset <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="mt-6">
            <div className="relative h-2 overflow-hidden rounded-full border border-border bg-background">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="relative h-full bg-brand-blue"
              >
                <div className="absolute inset-0 animate-shimmer" />
              </motion.div>
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{progress}% complete</span>
              <span>
                {activeJob.completed_docs} / {totalDocs}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-base font-medium tracking-tight">Pipeline timeline</h3>
            <div className="mt-5 space-y-5">
              {timeline.map((t, i) => (
                <div key={t.l} className="flex items-start gap-4">
                  <div className="relative">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                        t.state === "done"
                          ? "border-brand-lime/40 bg-brand-lime/15 text-brand-lime"
                          : t.state === "active"
                            ? "border-brand-blue/40 bg-brand-blue/15 text-brand-blue"
                            : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {t.state === "done" && <CheckCircle2 className="h-3 w-3" />}
                      {t.state === "active" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {t.state === "pending" && (
                        <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                      )}
                    </div>
                    {i < timeline.length - 1 && (
                      <div className="absolute left-1/2 top-6 h-8 w-px -translate-x-1/2 bg-border" />
                    )}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">{t.l}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{t.v}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.state === "done"
                        ? "Completed"
                        : t.state === "active"
                          ? "In progress"
                          : "Waiting"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { l: "Success", v: String(activeJob.completed_docs), c: "text-brand-lime" },
              { l: "Errors", v: String(activeJob.failed_docs), c: "text-destructive" },
              { l: "Pages", v: String(activeJob.total_pages), c: "text-brand-blue" },
              {
                l: "Avg confidence",
                v:
                  activeJob.confidence != null
                    ? `${Number(activeJob.confidence).toFixed(1)}%`
                    : "—",
                c: "text-muted-foreground",
              },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-border bg-surface p-5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.l}
                </div>
                <div className={`mt-3 text-3xl font-semibold tracking-tight ${s.c}`}>{s.v}</div>
              </div>
            ))}

            <div className="col-span-2 rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Errors needing attention</div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {failed.length} issues
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {failed.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No failed jobs.</div>
                ) : (
                  failed.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-center gap-3">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        <div>
                          <div className="font-mono text-xs">
                            JOB-{String(e.job_number).padStart(5, "0")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {e.error_message ?? "Unknown error"}
                          </div>
                        </div>
                      </div>
                      <Link
                        to="/configure"
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Fix →
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <RecentJobsGrid jobs={recentJobs} />
      </div>
    </AppShell>
  );
}

function RecentJobsGrid({
  jobs,
}: {
  jobs: NonNullable<ReturnType<typeof useProcessingJobs>["data"]>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="text-base font-medium tracking-tight">Recent jobs</h3>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand-lime" /> Auto-refresh
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 lg:grid-cols-7">
        {jobs.map((q) => {
          const status =
            q.stage === "completed"
              ? "done"
              : q.stage === "failed"
                ? "error"
                : q.stage === "queued" || q.stage === "pending"
                  ? "queued"
                  : "processing";
          return (
            <div key={q.id} className="bg-surface p-4">
              <div className="font-mono text-[10px] text-muted-foreground">
                JOB-{String(q.job_number).padStart(5, "0")}
              </div>
              <div className="mt-1 truncate text-sm">{q.name}</div>
              <div className="mt-3 flex items-center gap-1.5 text-[10px]">
                {status === "done" && (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-brand-lime" />
                    <span className="text-brand-lime">Done</span>
                  </>
                )}
                {status === "processing" && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-brand-blue" />
                    <span className="text-brand-blue">Extracting</span>
                  </>
                )}
                {status === "error" && (
                  <>
                    <AlertCircle className="h-3 w-3 text-destructive" />
                    <span className="text-destructive">Error</span>
                  </>
                )}
                {status === "queued" && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                    <span className="text-muted-foreground">Queued</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
