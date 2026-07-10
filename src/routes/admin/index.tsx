import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  BarChart,
} from "recharts";
import {
  Activity,
  Shield as ShieldIcon,
} from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import {
  generateSparkline,
  adaptWorker,
  adaptSecurityEvent,
  adaptQueueJob,
  adaptOrganization,
} from "@/lib/admin-data";
import {
  useWorkers,
  useSecurityEvents,
  useAllProcessingJobs,
  useDashboardKpis,
  useExDocHealth,
  useOrganizations,
  useQueueStageCounts,
  usePlans,
} from "@/lib/queries";
import { formatINR } from "@/lib/format";

export const Route = createFileRoute("/admin/")({
  component: OperationsDashboard,
});

function OperationsDashboard() {
  const [lastUpdated, setLastUpdated] = useState("syncing...");
  const { data: dbWorkers = [] } = useWorkers();
  const { data: dbSec = [] } = useSecurityEvents(5);
  const { data: dbFailed = [] } = useAllProcessingJobs({ stage: "failed", limit: 5 });
  const { data: kpis } = useDashboardKpis();
  const { data: exDocHealth } = useExDocHealth();
  const { data: dbOrgs = [] } = useOrganizations({ limit: 30 });
  const { data: queueStageCounts = {} } = useQueueStageCounts();
  const { data: plans = [] } = usePlans();

  const workers = useMemo(() => dbWorkers.map((w) => adaptWorker(w)), [dbWorkers]);
  const securityEvents = useMemo(() => dbSec.map((e) => adaptSecurityEvent(e, {})), [dbSec]);
  const failedJobs = useMemo(() => dbFailed.map((j) => adaptQueueJob(j, {})), [dbFailed]);

  // Top customers: orgs by recent transaction volume â€" fall back to org rows
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id, p.name])), [plans]);
  const topCustomers = useMemo(
    () =>
      dbOrgs
        .map((o) =>
          adaptOrganization(o, {
            plan: o.plan_id ? ({ name: planMap.get(o.plan_id) ?? "Free" } as never) : null,
          }),
        )
        .sort((a, b) => b.pagesProcessed - a.pagesProcessed)
        .slice(0, 6)
        .map((o) => ({
          name: o.name,
          plan: o.plan,
          mrr: formatINR(o.pagesProcessed * 5, { compact: true }), // proxy
          pages: o.pagesProcessed.toLocaleString("en-IN"),
          status: o.status,
        })),
    [dbOrgs, planMap],
  );

  // Throughput series from queue stage counts (replaces random data)
  const queueData = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        time: `${String(i).padStart(2, "0")}:00`,
        throughput: (queueStageCounts.completed ?? 0) / 24,
      })),
    [queueStageCounts],
  );

  // Revenue trend â€" empty until metric_snapshots backed
  const revenueData = useMemo(
    () => Array.from({ length: 30 }, (_, i) => ({ day: `${i + 1}`, revenue: 0, target: 0 })),
    [],
  );

  const dashboardKPIs = useMemo(
    () => [
      {
        label: "Total Users",
        value: (kpis?.users ?? 0).toLocaleString("en-IN"),
        change: "+",
        trend: "up" as const,
        sparkline: generateSparkline(),
      },
      {
        label: "Active Organizations",
        value: (kpis?.orgs ?? 0).toLocaleString("en-IN"),
        change: "+",
        trend: "up" as const,
        sparkline: generateSparkline(),
      },
      {
        label: "Enterprise Clients",
        value: String(kpis?.enterprises ?? 0),
        change: "+",
        trend: "up" as const,
        sparkline: generateSparkline(),
      },
      {
        label: "Pages Today",
        value: (kpis?.pagesToday ?? 0).toLocaleString("en-IN"),
        change: "+",
        trend: "up" as const,
        sparkline: generateSparkline(),
      },
      {
        label: "Queue Active",
        value: (kpis?.queueActive ?? 0).toLocaleString("en-IN"),
        change: "--",
        trend: "flat" as const,
        sparkline: generateSparkline(),
      },
      {
        label: "Failed Today",
        value: String(kpis?.failedToday ?? 0),
        change: "-",
        trend: "down" as const,
        sparkline: generateSparkline(),
      },
      {
        label: "Active Webhooks",
        value: String(kpis?.webhooksActive ?? 0),
        change: "+",
        trend: "up" as const,
        sparkline: generateSparkline(),
      },
      {
        label: "Workers Healthy",
        value: String(workers.filter((w) => w.status === "healthy").length),
        change: "--",
        trend: "flat" as const,
        sparkline: generateSparkline(),
      },
    ],
    [kpis, workers],
  );

  useEffect(() => {
    const formatTime = () =>
      new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    setLastUpdated(formatTime());
    const timer = window.setInterval(() => setLastUpdated(formatTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="p-6 space-y-6">
      {/* â"€â"€ Header â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Operations Dashboard</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            Live system overview Â· Last updated: {lastUpdated}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 font-mono text-[10px] text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            All systems operational
          </span>
        </div>
      </div>

      {/* â"€â"€ KPI Grid â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {dashboardKPIs.map((kpi) => (
          <StatCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* â"€â"€ Main Grid â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Queue Throughput Chart */}
        <div className="xl:col-span-2 rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-medium">Queue Throughput</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">
                Documents processed per hour Â· 24h
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <span className="text-muted-foreground">Peak:</span>
              <span className="text-foreground">4,200/hr</span>
            </div>
          </div>
          <div className="p-4">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={queueData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="queueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#111" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#555", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#111",
                      border: "1px solid #222",
                      borderRadius: "6px",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#888" }}
                    itemStyle={{ color: "#fff" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="throughput"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    fill="url(#queueGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Queue Stage Pipeline */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">Queue Pipeline</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">
              Current job distribution
            </p>
          </div>
          <div className="p-4 space-y-2">
            {Object.entries(queueStageCounts).map(([stage, count]) => {
              const maxCount = Math.max(1, ...Object.values(queueStageCounts));
              const pct = (count / maxCount) * 100;
              const color =
                stage === "completed"
                  ? "#22c55e"
                  : stage === "failed" || stage === "dead_letter"
                    ? "#ef4444"
                    : stage === "retry"
                      ? "#f59e0b"
                      : "#2563eb";
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                    {stage.replace("_", " ")}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-[11px] text-foreground/80">
                    {count.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* â"€â"€ Second Row â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* ExDoc API Health */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">ExDoc API Health</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">
              Live extraction provider endpoint
            </p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between rounded-md border border-border/60 bg-surface-2 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    exDocHealth?.status === "live"
                      ? "bg-emerald-400"
                      : exDocHealth?.status === "degraded"
                        ? "bg-amber-400 animate-pulse"
                        : "bg-red-400"
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">ExDoc API</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground/80">
                    {exDocHealth?.baseUrl || "Provider configuration pending"}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[11px] text-foreground/90">
                  {exDocHealth?.latencyMs == null ? "--" : `${exDocHealth.latencyMs}ms`}
                </div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground/80">
                  {exDocHealth?.status ?? "checking"}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Key", value: exDocHealth?.configured ? "Ready" : "Missing" },
                { label: "Reach", value: exDocHealth?.reachable ? "Online" : "Offline" },
                { label: "HTTP", value: exDocHealth?.httpStatus ? String(exDocHealth.httpStatus) : "--" },
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-border/60 bg-surface-2 px-3 py-2">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                    {item.label}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-foreground/90">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Webhook Gateways Grid */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">Webhook Gateways</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">
              {workers.filter((w) => w.status === "healthy").length}/{workers.length} active
              listeners
            </p>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-6 gap-1.5">
              {workers.map((w) => (
                <div
                  key={w.id}
                  className={`group relative flex h-8 items-center justify-center rounded border text-[9px] font-mono transition-colors ${
                    w.status === "healthy"
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
                      : w.status === "degraded"
                        ? "border-amber-500/20 bg-amber-500/5 text-amber-400"
                        : "border-border bg-surface-2 text-muted-foreground/60"
                  }`}
                  title={`${w.name.replace("wrk", "gw")} Â· ${w.status}`}
                >
                  {w.name.replace("wrk-", "GW-")}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 font-mono text-[10px] text-muted-foreground/80">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Healthy
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Degraded
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" /> Offline
              </span>
            </div>
          </div>
        </div>

        {/* Failed Jobs Alert */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-medium">Failed Jobs</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">Requires attention</p>
            </div>
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-400">
              {failedJobs.length} failures
            </span>
          </div>
          <div className="divide-y divide-border/50">
            {failedJobs.map((job) => (
              <div key={job.id} className="px-4 py-3 hover:bg-surface-2 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-foreground/90">{job.id}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/80">
                    {job.duration}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground truncate">
                  {job.errorMessage}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground/60">
                    {job.organization}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground/60">Â·</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60">
                    Attempt {job.attempts}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* â"€â"€ Third Row â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Revenue Chart */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-medium">Revenue Trend</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">
                Daily revenue vs target Â· 30d
              </p>
            </div>
            <div className="flex items-center gap-4 font-mono text-[10px]">
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-3 rounded-full bg-blue-500" /> Revenue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-3 rounded-full border border-zinc-600" /> Target
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#111" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "#555", fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: "#555", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#111",
                      border: "1px solid #222",
                      borderRadius: "6px",
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "#888" }}
                    formatter={(v: number) => [`â‚¹${(v / 1000).toFixed(0)}K`, ""]}
                  />
                  <Bar dataKey="revenue" fill="#2563eb" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Top Enterprise Customers */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">Top Enterprise Customers</h3>
            <p className="font-mono text-[10px] text-muted-foreground/80">By monthly revenue</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                    Organization
                  </th>
                  <th className="px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                    Plan
                  </th>
                  <th className="px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 text-right">
                    MRR
                  </th>
                  <th className="px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 text-right">
                    Pages
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {topCustomers.map((c) => (
                  <tr key={c.name} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-2.5 text-[13px] text-foreground/90">{c.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full border border-blue-500/20 bg-blue-500/5 px-2 py-0.5 font-mono text-[10px] text-blue-400">
                        {c.plan}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] text-foreground/90">
                      {c.mrr}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] text-muted-foreground">
                      {c.pages}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Fourth Row */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Live Job Feed */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Activity className="h-3.5 w-3.5 text-emerald-500" />
            <h3 className="text-sm font-medium">Live Job Feed</h3>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">ExDoc API pipeline</span>
          </div>
          <LiveExtractionFeed />
        </div>

        {/* Security Alerts */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <ShieldIcon className="h-3.5 w-3.5 text-amber-500" />
              <h3 className="text-sm font-medium">Security Alerts</h3>
            </div>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-400">
              {securityEvents.filter((e) => !e.resolved).length} active
            </span>
          </div>
          <div className="divide-y divide-border/50">
            {securityEvents.length === 0 && (
              <div className="px-4 py-8 text-center font-mono text-[11px] text-muted-foreground/50">
                No security events.
              </div>
            )}
            {securityEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 hover:bg-surface-2 transition-colors">
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                      event.severity === "critical"
                        ? "bg-red-500/10 text-red-400"
                        : event.severity === "high"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-zinc-500/10 text-foreground/80"
                    }`}
                  >
                    {event.severity}
                  </span>
                  {!event.resolved && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                </div>
                <div className="mt-1.5 text-[12px] text-foreground/80">{event.details}</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60">
                  <span>{event.user}</span>
                  <span>·</span>
                  <span>{event.ip}</span>
                  <span>·</span>
                  <span>{event.location}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveExtractionFeed() {
  const { data: jobs = [] } = useAllProcessingJobs({ limit: 10 });
  return (
    <div className="divide-y divide-border/50 max-h-[280px] overflow-y-auto">
      {jobs.length === 0 && (
        <div className="px-4 py-6 text-center text-[11px] text-muted-foreground/60">
          No active jobs.
        </div>
      )}
      {jobs.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                item.stage === "completed"
                  ? "bg-emerald-400"
                  : item.stage === "failed" || item.stage === "dead_letter"
                    ? "bg-red-400"
                    : "bg-blue-400 animate-pulse"
              }`}
            />
            <span className="font-mono text-[11px] text-foreground/80">
              JOB-{String(item.job_number).padStart(5, "0")}
            </span>
            <span className="text-[11px] text-muted-foreground/80 truncate">{item.name}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <AutoStatusBadge status={item.stage} />
            <span className="font-mono text-[9px] text-muted-foreground/60">
              {new Date(item.created_at).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
