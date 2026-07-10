import { type ReactNode } from "react";

type Variant = "success" | "warning" | "error" | "idle" | "processing" | "info";

const variants: Record<Variant, string> = {
  success:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
  error:      "bg-red-500/10 text-red-400 border-red-500/20",
  idle:       "bg-zinc-500/10 text-foreground/80 border-zinc-500/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  info:       "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const dotColors: Record<Variant, string> = {
  success:    "bg-emerald-400",
  warning:    "bg-amber-400",
  error:      "bg-red-400",
  idle:       "bg-zinc-500",
  processing: "bg-blue-400 animate-pulse",
  info:       "bg-blue-400",
};

interface StatusBadgeProps {
  variant: Variant;
  children: ReactNode;
  dot?: boolean;
}

export function StatusBadge({ variant, children, dot = true }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${variants[variant]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  );
}

// Map common status strings to badge variants
const statusMap: Record<string, Variant> = {
  active: "success",
  healthy: "success",
  connected: "success",
  completed: "success",
  succeeded: "success",
  delivered: "success",
  published: "published" as unknown as Variant,
  resolved: "success",
  closed: "idle",
  inactive: "idle",
  idle: "idle",
  offline: "idle",
  disconnected: "idle",
  archived: "idle",
  draft: "idle",
  suspended: "error",
  failed: "error",
  error: "error",
  rejected: "error",
  dead_letter: "error",
  churned: "error",
  trial: "info",
  beta: "info",
  pending: "warning",
  queued: "warning",
  scheduled: "warning",
  waiting: "warning",
  sending: "processing",
  processing: "processing",
  in_progress: "processing",
  ocr: "processing",
  ai_extraction: "processing",
  validation: "processing",
  export: "processing",
  retry: "warning",
  degraded: "warning",
  refunded: "warning",
};

export function AutoStatusBadge({ status }: { status: string }) {
  const variant = statusMap[status] || "idle";
  const label = status.replace(/_/g, " ");
  return (
    <StatusBadge variant={variant}>
      {label}
    </StatusBadge>
  );
}
