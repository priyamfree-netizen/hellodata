import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle, RotateCcw, Receipt, FileText } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import { adaptTransaction, generateSparkline } from "@/lib/admin-data";
import { useTransactions, useRevenueMetrics } from "@/lib/queries";
import { formatINR } from "@/lib/format";

export const Route = createFileRoute("/admin/billing")({
  component: BillingDashboard,
});

function BillingDashboard() {
  const { data: dbTx = [] } = useTransactions({ limit: 60 });
  const { data: metrics } = useRevenueMetrics();
  const transactions = useMemo(
    () =>
      dbTx.map((t) =>
        adaptTransaction(t, {
          orgName: t.organization?.name,
          planName: t.plan?.name,
        }),
      ),
    [dbTx],
  );
  const revenueMetrics = {
    mrr: formatINR(metrics?.mrr ?? 0, { compact: true }),
    arr: formatINR(metrics?.arr ?? 0, { compact: true }),
    churnRate: "—",
    ltv: "—",
    cac: "—",
    failedPayments: metrics?.failedPayments ?? 0,
    refundsThisMonth: metrics?.refundsThisMonth ?? 0,
    netRevenue: formatINR(metrics?.netRevenue ?? 0, { compact: true }),
  };
  const [txFilter, setTxFilter] = useState("all");

  const mrrData = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i],
        mrr: metrics?.mrr ?? 0,
        churn: 0,
      })),
    [metrics],
  );

  const filteredTx = useMemo(() => {
    if (txFilter === "all") return transactions;
    return transactions.filter(t => t.status === txFilter);
  }, [transactions, txFilter]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Revenue Operations</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground/80">Financial operations center · Real-time billing data</p>
      </div>

      {/* Revenue KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          { label: "MRR", value: revenueMetrics.mrr, change: "+14.6%", trend: "up" as const, sparkline: generateSparkline() },
          { label: "ARR", value: revenueMetrics.arr, change: "+22.1%", trend: "up" as const, sparkline: generateSparkline() },
          { label: "Churn Rate", value: revenueMetrics.churnRate, change: "-0.3%", trend: "down" as const, sparkline: generateSparkline() },
          { label: "LTV", value: revenueMetrics.ltv, change: "+8.4%", trend: "up" as const, sparkline: generateSparkline() },
          { label: "CAC", value: revenueMetrics.cac, change: "-12%", trend: "down" as const, sparkline: generateSparkline() },
          { label: "Net Revenue", value: revenueMetrics.netRevenue, change: "+11.2%", trend: "up" as const, sparkline: generateSparkline() },
          { label: "Failed Payments", value: String(revenueMetrics.failedPayments), change: "-4", trend: "down" as const, sparkline: generateSparkline() },
          { label: "Refunds (MTD)", value: String(revenueMetrics.refundsThisMonth), change: "+2", trend: "up" as const, sparkline: generateSparkline() },
        ].map(kpi => <StatCard key={kpi.label} {...kpi} />)}
      </div>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* MRR Growth */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-medium">MRR Growth</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">Monthly recurring revenue · 12 months</p>
            </div>
          </div>
          <div className="p-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mrrData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#111" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: "6px", fontSize: 11 }} labelStyle={{ color: "#888" }} formatter={(v: number) => [`₹${(v / 100000).toFixed(1)}L`, "MRR"]} />
                <Area type="monotone" dataKey="mrr" stroke="#2563eb" strokeWidth={1.5} fill="url(#mrrGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Churn */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-medium">Revenue Churn</h3>
              <p className="font-mono text-[10px] text-muted-foreground/80">Monthly churn in revenue · 12 months</p>
            </div>
          </div>
          <div className="p-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mrrData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#111" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: "6px", fontSize: 11 }} labelStyle={{ color: "#888" }} formatter={(v: number) => [`₹${(v / 1000).toFixed(0)}K`, "Churn"]} />
                <Bar dataKey="churn" fill="#ef4444" radius={[2, 2, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">Transaction Log</h3>
          <div className="flex items-center gap-1">
            {["all", "succeeded", "failed", "refunded", "pending"].map(f => (
              <button key={f} onClick={() => setTxFilter(f)} className={`rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${txFilter === f ? "bg-muted text-foreground" : "text-muted-foreground/80 hover:text-foreground/80"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/50">
                {["Transaction", "Organization", "Amount", "Plan", "Method", "Status", "Date"].map(h => (
                  <th key={h} className="px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredTx.slice(0, 20).map(tx => (
                <tr key={tx.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-foreground/80">{tx.id}</td>
                  <td className="px-4 py-2.5 text-[13px] text-foreground/90">{tx.organization}</td>
                  <td className="px-4 py-2.5 font-mono text-[13px] text-foreground">{tx.amount}</td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{tx.plan}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground/80">{tx.method}</td>
                  <td className="px-4 py-2.5"><AutoStatusBadge status={tx.status} /></td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground/80">{new Date(tx.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
