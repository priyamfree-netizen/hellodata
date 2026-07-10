import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileText,
  Server,
  WifiOff,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LazyMiniChart as MiniChart } from "@/components/admin/lazy-mini-chart";
import { StatCard } from "@/components/admin/stat-card";
import { adaptWorker, snapshotsToSparkline } from "@/lib/admin-data";
import {
  useAllProcessingJobs,
  useDashboardKpis,
  useExDocHealth,
  useMetricSnapshots,
  useQueueStageCounts,
  useWorkers,
} from "@/lib/queries";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/admin/analytics")({
  component: ExDocHealthDashboard,
});

const ACTIVE_STAGES = new Set(["pending", "queued", "ocr", "ai_extraction", "validation", "export", "retry"]);

function valuesFromSnapshots(rows: { value: number }[]) {
  return rows.length > 0 ? snapshotsToSparkline(rows) : [];
}

function statusTone(status: "live" | "degraded" | "down" | undefined) {
  if (status === "live") return "text-emerald-500";
  if (status === "degraded") return "text-amber-500";
  return "text-red-400";
}

function ExDocHealthDashboard() {
  const { data: health } = useExDocHealth();
  const { data: dbWorkers = [] } = useWorkers();
  const { data: jobs = [] } = useAllProcessingJobs({ limit: 200 });
  const { data: kpis } = useDashboardKpis();
  const { data: queueStageCounts = {} } = useQueueStageCounts();
  const { data: latencySnapshots = [] } = useMetricSnapshots("exdoc_latency_ms", 24);
  const { data: successSnapshots = [] } = useMetricSnapshots("exdoc_success_rate", 24);
  const { data: throughputSnapshots = [] } = useMetricSnapshots("extraction_throughput", 24);

  const workers = useMemo(() => dbWorkers.map((w) => adaptWorker(w)), [dbWorkers]);
  const liveJobs = useMemo(() => jobs.filter((job) => ACTIVE_STAGES.has(job.stage)), [jobs]);
  const completedJobs = jobs.filter((job) => job.stage === "completed").length;
  const failedJobs = jobs.filter((job) => job.stage === "failed" || job.stage === "dead_letter").length;
  const successRate =
    completedJobs + failedJobs > 0 ? Math.round((completedJobs / (completedJobs + failedJobs)) * 1000) / 10 : null;
  const avgDurationMs = useMemo(() => {
    const durations = jobs.map((job) => job.duration_ms).filter((v): v is number => typeof v === "number" && v > 0);
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((sum, v) => sum + v, 0) / durations.length);
  }, [jobs]);

  const latencyLine = valuesFromSnapshots(latencySnapshots);
  const successLine = valuesFromSnapshots(successSnapshots);
  const throughputLine = valuesFromSnapshots(throughputSnapshots);
  const queueSeries = useMemo(
    () =>
      Object.entries(queueStageCounts).map(([stage, count]) => ({
        stage: stage.replace("_", " "),
        count,
      })),
    [queueStageCounts],
  );

  const statusLabel = health?.status === "live" ? "Live" : health?.status === "degraded" ? "Degraded" : "Down";
  const statusIcon =
    health?.status === "live" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : health?.status === "degraded" ? (
      <AlertTriangle className="h-4 w-4 text-amber-500" />
    ) : (
      <WifiOff className="h-4 w-4 text-red-400" />
    );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">ExDoc API Health</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            Live extraction provider status and processing pipeline health
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5">
          {statusIcon}
          <span className={`font-mono text-[11px] font-medium ${statusTone(health?.status)}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard
          label="ExDoc Status"
          value={statusLabel}
          change={health?.configured ? "configured" : "missing key"}
          trend={health?.status === "down" ? "down" : health?.status === "live" ? "up" : "flat"}
          icon={<Activity className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Provider Latency"
          value={health?.latencyMs == null ? "--" : `${health.latencyMs}ms`}
          change={health?.httpStatus ? `HTTP ${health.httpStatus}` : "no response"}
          trend={health?.status === "live" ? "up" : health?.status === "degraded" ? "flat" : "down"}
          sparkline={latencyLine}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Queue Active"
          value={(kpis?.queueActive ?? liveJobs.length).toLocaleString("en-IN")}
          change={`${jobs.length.toLocaleString("en-IN")} recent jobs`}
          trend="flat"
          sparkline={throughputLine}
          icon={<Server className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Success Rate"
          value={successRate == null ? "--" : `${successRate}%`}
          change={`${failedJobs} failed recent jobs`}
          trend={failedJobs > 0 ? "down" : "up"}
          sparkline={successLine}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Pages Today"
          value={(kpis?.pagesToday ?? 0).toLocaleString("en-IN")}
          change={`${kpis?.failedToday ?? failedJobs} failed today`}
          trend={(kpis?.failedToday ?? failedJobs) > 0 ? "down" : "flat"}
          icon={<FileText className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Workers Healthy"
          value={`${workers.filter((w) => w.status === "healthy").length}/${workers.length}`}
          change={workers.length ? "live heartbeats" : "no workers"}
          trend={workers.some((w) => w.status !== "healthy") ? "down" : "up"}
          icon={<Cpu className="h-3.5 w-3.5" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface xl:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">ExDoc Provider</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">
              {health?.baseUrl || "Waiting for provider configuration"}
            </p>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {[
              ["API key", health?.configured ? "Configured" : "Missing"],
              ["Reachability", health?.reachable ? "Reachable" : "Unreachable"],
              ["Health URL", health?.checkedUrl ?? "--"],
              ["Last check", health?.checkedAt ? formatRelativeTime(health.checkedAt) : "--"],
              ["HTTP status", health?.httpStatus ? String(health.httpStatus) : "--"],
              ["Average extraction", avgDurationMs == null ? "--" : `${(avgDurationMs / 1000).toFixed(1)}s`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border/60 bg-surface-2 p-3">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80">
                  {label}
                </div>
                <div className="mt-1 truncate font-mono text-[12px] text-foreground/90" title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">Queue Stages</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">Current processing distribution</p>
          </div>
          <div className="p-4 space-y-2">
            {queueSeries.length === 0 && (
              <div className="py-8 text-center text-[11px] text-muted-foreground/60">No queue activity.</div>
            )}
            {queueSeries.map((item) => {
              const max = Math.max(1, ...queueSeries.map((row) => row.count));
              return (
                <div key={item.stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                    {item.stage}
                  </span>
                  <div className="h-1.5 flex-1 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all"
                      style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-foreground/80">
                    {item.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">Metric Snapshots</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">
              Live rows from metric_snapshots when rollups are enabled
            </p>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-3">
            {[
              { label: "Latency", data: latencyLine, color: "#2563eb" },
              { label: "Success", data: successLine, color: "#22c55e" },
              { label: "Throughput", data: throughputLine, color: "#f59e0b" },
            ].map((metric) => (
              <div key={metric.label} className="rounded-md border border-border/60 bg-surface-2 p-3">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                  {metric.label}
                </div>
                {metric.data.length > 0 ? (
                  <MiniChart data={metric.data} color={metric.color} height={56} />
                ) : (
                  <div className="flex h-14 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground/60">
                    No snapshots
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">Recent ExDoc Jobs</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">Database-backed processing_jobs feed</p>
          </div>
          <div className="max-h-[260px] overflow-y-auto divide-y divide-border/50">
            {jobs.length === 0 && (
              <div className="px-4 py-8 text-center text-[11px] text-muted-foreground/60">
                No extraction jobs found.
              </div>
            )}
            {jobs.slice(0, 12).map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-foreground/90">{job.name}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                    JOB-{String(job.job_number).padStart(5, "0")} / {formatRelativeTime(job.created_at)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[10px] uppercase text-foreground/80">{job.stage}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                    {job.duration_ms ? `${(job.duration_ms / 1000).toFixed(1)}s` : "--"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">Worker Health</h3>
          <p className="font-mono text-[10px] text-muted-foreground/80">
            Current worker load from Supabase
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/50">
                {["Worker", "Status", "CPU", "Memory", "Jobs", "Uptime", "Region", "Type"].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {workers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[11px] text-muted-foreground/60">
                    No worker rows found.
                  </td>
                </tr>
              )}
              {workers.map((worker) => (
                <tr key={worker.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2 font-mono text-[12px] text-foreground/80">{worker.name}</td>
                  <td className="px-3 py-2">
                    <span className={`font-mono text-[10px] ${
                      worker.status === "healthy" ? "text-emerald-500" : worker.status === "degraded" ? "text-amber-500" : "text-red-400"
                    }`}>
                      {worker.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground/80">{worker.cpu}%</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground/80">{worker.memory}%</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground/80">{worker.jobsProcessed.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground/80">{worker.uptime}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground/80">{worker.region}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground/80">{worker.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
