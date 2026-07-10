import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
  showGradient?: boolean;
}

export function MiniChart({ data, color = "#2563eb", height = 32, showGradient = true }: MiniChartProps) {
  const uid = useId();
  const chartData = data.map((v, i) => ({ i, v }));
  const gradientId = `mini-${color.replace("#", "")}-${uid.replace(/:/g, "")}`;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          {showGradient && (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
          )}
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={showGradient ? `url(#${gradientId})` : "transparent"}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
