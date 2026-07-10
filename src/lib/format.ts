/**
 * Display formatters used across the app. These never invent data — they just
 * present rows from the database in the same shape the UI was built against.
 */

export function formatINR(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null) return "₹0";
  if (opts?.compact) {
    const abs = Math.abs(n);
    if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
    if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
    if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  }
  return "₹" + n.toLocaleString("en-IN");
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const e = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, e)).toFixed(e === 0 ? 0 : 1)} ${units[e]}`;
}

export function formatNumber(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null) return "0";
  if (opts?.compact) {
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  }
  return n.toLocaleString("en-IN");
}

export function formatPercent(n: number | null | undefined, fractionDigits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(fractionDigits)}%`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}, ${d
    .toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

export function planBadgeClass(planName: string | null | undefined): string {
  if (!planName) return "border-zinc-500/20 bg-zinc-500/5 text-muted-foreground";
  if (planName === "Enterprise" || planName === "Custom Enterprise")
    return "border-blue-500/20 bg-blue-500/5 text-blue-400";
  if (planName === "Free")
    return "border-zinc-500/20 bg-zinc-500/5 text-muted-foreground";
  return "border-zinc-600/20 bg-zinc-500/5 text-foreground/80";
}
