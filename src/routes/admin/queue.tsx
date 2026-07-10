import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  RotateCcw, X, ArrowUp, ChevronRight,
  Clock, Cpu, Zap, AlertTriangle, Server, CheckCircle2,
} from "lucide-react";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import { DetailPanel, DetailRow } from "@/components/admin/detail-panel";
import {
  adaptQueueJob, adaptWorker, type QueueJob,
} from "@/lib/admin-data";
import { useAllProcessingJobs, useWorkers, useQueueStageCounts } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/admin/queue")({
  component: QueueDashboard,
});

const STAGE_ORDER = ["pending", "queued", "ocr", "ai_extraction", "validation", "export", "completed", "failed", "retry", "dead_letter"] as const;
const STAGE_COLORS: Record<string, string> = {
  pending: "#6b7280", queued: "#6b7280", ocr: "#2563eb", ai_extraction: "#2563eb",
  validation: "#f59e0b", export: "#84cc16", completed: "#22c55e",
  failed: "#ef4444", retry: "#f59e0b", dead_letter: "#ef4444",
};
// Display names for stages — ExDoc API pipeline stages
const STAGE_LABELS: Record<string, string> = {
  pending: "pending", queued: "queued",
  ocr: "ExDoc OCR", ai_extraction: "ExDoc Extract",
  validation: "validation", export: "export",
  completed: "completed", failed: "failed",
  retry: "retry", dead_letter: "dead letter",
};

function QueueDashboard() {
  const { data: dbJobs = [] } = useAllProcessingJobs({ limit: 80 });
  const { data: dbWorkers = [] } = useWorkers();
  const { data: queueStageCounts = {} } = useQueueStageCounts();
  const jobs = useMemo<QueueJob[]>(() => dbJobs.map((j) => adaptQueueJob(j, {})), [dbJobs]);
  const workers = useMemo(() => dbWorkers.map((w) => adaptWorker(w)), [dbWorkers]);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<QueueJob | null>(null);

  const filteredJobs = useMemo(() => {
    if (!stageFilter) return jobs;
    return jobs.filter(j => j.stage === stageFilter);
  }, [jobs, stageFilter]);

  const processingJobs = jobs.filter(j => ["ocr", "ai_extraction", "validation", "export"].includes(j.stage));
  const healthyWorkers = workers.filter(w => w.status === "healthy").length;
  const avgDurationMs = useMemo(() => {
    const dur = dbJobs.map(j => j.duration_ms).filter((v): v is number => typeof v === "number" && v > 0);
    if (!dur.length) return null;
    return Math.round(dur.reduce((s, v) => s + v, 0) / dur.length);
  }, [dbJobs]);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Processing Queue</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            ExDoc API pipeline · {jobs.length} jobs tracked
          </p>
        </div>
      </div>

      {/* Pipeline Visualization */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STAGE_ORDER.map((stage, i) => {
            const count = queueStageCounts[stage as keyof typeof queueStageCounts] || 0;
            const color = STAGE_COLORS[stage];
            const isActive = stageFilter === stage;
            return (
              <div key={stage} className="flex items-center">
                <button
                  onClick={() => setStageFilter(isActive ? null : stage)}
                  className={`group relative flex flex-col items-center rounded-lg border px-4 py-3 transition-all ${
                    isActive
                      ? "border-blue-600/30 bg-blue-600/5"
                      : "border-border bg-surface-2 hover:border-border/80"
                  }`}
                >
                  <span className="font-mono text-2xl font-bold" style={{ color }}>
                    {count.toLocaleString()}
                  </span>
                  <span className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80">
                    {STAGE_LABELS[stage] ?? stage.replace("_", " ")}
                  </span>
                  {(stage === "ocr" || stage === "ai_extraction") && count > 0 && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
                  )}
                </button>
                {i < STAGE_ORDER.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 mx-1 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "Processing Now", value: String(processingJobs.length), icon: Zap, color: "#2563eb" },
          { label: "Avg Process Time", value: avgDurationMs == null ? "—" : `${(avgDurationMs / 1000).toFixed(1)}s`, icon: Clock, color: "#84cc16" },
          { label: "Workers Active", value: `${healthyWorkers}/${workers.length}`, icon: Server, color: "#22c55e" },
          { label: "Completed", value: String(queueStageCounts.completed ?? 0), icon: CheckCircle2, color: "#22c55e" },
          { label: "Dead Letters", value: String(queueStageCounts.dead_letter ?? 0), icon: AlertTriangle, color: "#ef4444" },
        ].map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <stat.icon className="h-4 w-4 shrink-0" style={{ color: stat.color }} />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">{stat.label}</div>
              <div className="font-mono text-lg font-semibold text-foreground">{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Job List */}
        <div className="xl:col-span-2 rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Jobs</h3>
              {stageFilter && (
                <button
                  onClick={() => setStageFilter(null)}
                  className="flex items-center gap-1 rounded-full border border-blue-600/20 bg-blue-600/5 px-2 py-0.5 font-mono text-[10px] text-blue-400"
                >
                  {stageFilter.replace("_", " ")}
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground/80">{filteredJobs.length} jobs</span>
          </div>
          <div className="divide-y divide-border/50 max-h-[600px] overflow-y-auto">
            {filteredJobs.slice(0, 30).map((job) => (
              <div
                key={job.id}
                onClick={() => setSelectedJob(job)}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2 cursor-pointer"
              >
                {/* Stage Indicator */}
                <div
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    ["ocr", "ai_extraction", "validation", "export"].includes(job.stage) ? "animate-pulse" : ""
                  }`}
                  style={{ backgroundColor: STAGE_COLORS[job.stage] }}
                />

                {/* Job Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-foreground/90">{job.id}</span>
                    <span className="text-[11px] text-muted-foreground/80 truncate">{job.documentName}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60">
                    <span>{job.organization}</span>
                    <span>Â·</span>
                    <span>{job.template}</span>
                    <span>Â·</span>
                    <span>{job.pages}p</span>
                  </div>
                </div>

                {/* Status & Meta */}
                <div className="flex items-center gap-3 shrink-0">
                  {job.priority === "critical" && (
                    <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] text-red-400">CRIT</span>
                  )}
                  {job.priority === "high" && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-400">HIGH</span>
                  )}
                  <AutoStatusBadge status={job.stage} />
                  <span className="w-12 text-right font-mono text-[10px] text-muted-foreground/80">{job.duration}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {job.stage === "failed" && (
                    <button className="flex h-6 w-6 items-center justify-center rounded border border-border/80 text-muted-foreground/80 hover:text-foreground hover:bg-muted">
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Workers + Throughput */}
        <div className="space-y-4">
          {/* Stage breakdown */}
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">ExDoc API Stages</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">Current job distribution</p>
            </div>
            <div className="p-4 space-y-2">
              {Object.entries(queueStageCounts).length === 0 && (
                <div className="py-4 text-center font-mono text-[10px] text-muted-foreground/50">No queue data</div>
              )}
              {Object.entries(queueStageCounts).map(([stage, count]) => {
                const max = Math.max(1, ...Object.values(queueStageCounts));
                return (
                  <div key={stage} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 font-mono text-[9px] uppercase text-muted-foreground/70">
                      {STAGE_LABELS[stage] ?? stage.replace("_", " ")}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, (count / max) * 100)}%`, backgroundColor: STAGE_COLORS[stage] ?? "#6b7280" }} />
                    </div>
                    <span className="w-8 text-right font-mono text-[10px] text-foreground/80">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Worker Allocation */}
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">Worker Allocation</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">{healthyWorkers} active</p>
            </div>
            <div className="divide-y divide-border/50 max-h-[300px] overflow-y-auto">
              {workers.slice(0, 12).map((w) => (
                <div key={w.id} className="flex items-center justify-between px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      w.status === "healthy" ? "bg-emerald-400" :
                      w.status === "degraded" ? "bg-amber-400" :
                      "bg-zinc-700"
                    }`} />
                    <span className="font-mono text-[11px] text-foreground/80">{w.name}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[10px]">
                    <span className="text-muted-foreground/80">CPU {w.cpu}%</span>
                    <span className="text-muted-foreground/80">MEM {w.memory}%</span>
                    <span className={`w-12 text-right ${w.type === "dedicated" ? "text-blue-400" : "text-muted-foreground/80"}`}>
                      {w.type === "dedicated" ? "ded" : "shared"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Failure summary */}
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">Failure Summary</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">From recent {dbJobs.length} jobs</p>
            </div>
            <div className="p-4 space-y-2">
              {[
                { label: "Failed", count: queueStageCounts.failed ?? 0, color: "#ef4444" },
                { label: "Dead Letter", count: queueStageCounts.dead_letter ?? 0, color: "#dc2626" },
                { label: "Retry", count: queueStageCounts.retry ?? 0, color: "#f59e0b" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-muted-foreground/80">{item.label}</span>
                  <span style={{ color: item.count > 0 ? item.color : "#6b7280" }} className="font-semibold">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Job Detail Panel */}
      <DetailPanel
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title={selectedJob?.id ?? ""}
        subtitle={selectedJob?.documentName}
      >
        {selectedJob && (
          <div>
            {/* Status Header */}
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
              <AutoStatusBadge status={selectedJob.stage} />
              <div className="flex items-center gap-2">
                {selectedJob.stage === "failed" && (
                  <button className="flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 font-mono text-[11px] text-amber-400">
                    <RotateCcw className="h-3 w-3" /> Retry
                  </button>
                )}
                {["pending", "queued"].includes(selectedJob.stage) && (
                  <button className="flex items-center gap-1.5 rounded-md border border-border/80 px-3 py-1.5 font-mono text-[11px] text-foreground/80">
                    <ArrowUp className="h-3 w-3" /> Prioritize
                  </button>
                )}
                <button className="flex items-center gap-1.5 rounded-md border border-red-500/20 px-3 py-1.5 font-mono text-[11px] text-red-400">
                  <X className="h-3 w-3" /> Cancel
                </button>
              </div>
            </div>

            {/* Details */}
            <DetailRow label="Job ID" value={selectedJob.id} mono />
            <DetailRow label="Document" value={selectedJob.documentName} mono />
            <DetailRow label="Organization" value={selectedJob.organization} />
            <DetailRow label="Template" value={selectedJob.template} />
            <DetailRow label="Stage" value={selectedJob.stage.replace("_", " ")} />
            <DetailRow label="Priority" value={selectedJob.priority} />
            <DetailRow label="Worker" value={selectedJob.worker ?? "Unassigned"} mono />
            <DetailRow label="Pages" value={selectedJob.pages} mono />
            <DetailRow label="Duration" value={selectedJob.duration} mono />
            <DetailRow label="Attempts" value={selectedJob.attempts} mono />

            {/* Job timeline from DB timestamps */}
            <div className="border-t border-border/50 px-6 py-4">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Timeline</div>
              <div className="space-y-2">
                {[
                  { label: "Created", ts: selectedJob.startedAt, color: "text-muted-foreground/80" },
                  { label: "ExDoc Stage", ts: null, value: STAGE_LABELS[selectedJob.stage] ?? selectedJob.stage, color: "text-foreground/90" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-md border border-border/40 bg-surface-2 px-3 py-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">{item.label}</span>
                    <span className={`font-mono text-[11px] ${item.color}`}>
                      {item.ts ? formatRelativeTime(item.ts) : (item.value ?? "—")}
                    </span>
                  </div>
                ))}
                {selectedJob.confidence > 0 && (
                  <div className="flex items-center justify-between rounded-md border border-border/40 bg-surface-2 px-3 py-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">Confidence</span>
                    <span className={`font-mono text-[11px] ${selectedJob.confidence >= 90 ? "text-emerald-400" : selectedJob.confidence >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {selectedJob.confidence}%
                    </span>
                  </div>
                )}
              </div>
              {selectedJob.errorMessage && (
                <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-400">
                  <span className="text-red-400/60 text-[10px] uppercase tracking-wider block mb-1">Error</span>
                  {selectedJob.errorMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </DetailPanel>
    </div>
  );
}
