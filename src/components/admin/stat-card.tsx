import { type ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "flat";
  sparkline?: number[];
  icon?: ReactNode;
}

export function StatCard({ label, value, change, trend, sparkline, icon }: StatCardProps) {
  const trendColor =
    trend === "up" ? "text-emerald-500" :
    trend === "down" ? "text-red-400" :
    "text-muted-foreground";

  const chartData = sparkline?.map((v, i) => ({ i, v }));

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-surface-2 p-4 transition-colors hover:border-border/80">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground">
            {value}
          </div>
          {change && (
            <div className={`mt-1 font-mono text-xs ${trendColor}`}>
              {change}
            </div>
          )}
        </div>

        {chartData && chartData.length > 0 && (
          <div className="h-10 w-20 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`sparkGrad-${label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={trend === "down" && label.includes("Failed") ? "#22c55e" : trend === "up" ? "#2563eb" : "#6b7280"} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={trend === "down" && label.includes("Failed") ? "#22c55e" : trend === "up" ? "#2563eb" : "#6b7280"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={trend === "down" && label.includes("Failed") ? "#22c55e" : trend === "up" ? "#2563eb" : "#6b7280"}
                  strokeWidth={1.5}
                  fill={`url(#sparkGrad-${label.replace(/\s/g, "")})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
