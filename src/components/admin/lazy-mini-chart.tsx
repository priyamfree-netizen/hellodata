import { lazy, Suspense } from "react";

const MiniChartImpl = lazy(() =>
  import("./mini-chart").then((m) => ({ default: m.MiniChart })),
);

interface LazyMiniChartProps {
  data: number[];
  color?: string;
  height?: number;
  showGradient?: boolean;
}

export function LazyMiniChart(props: LazyMiniChartProps) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 32 }} className="w-full" />}>
      <MiniChartImpl {...props} />
    </Suspense>
  );
}
