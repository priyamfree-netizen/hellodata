import { Link } from "@tanstack/react-router";

export function Logo({ className = "", size = "sm" }: { className?: string; size?: "sm" | "lg" }) {
  const big = size === "lg";
  return (
    <Link to="/" className={`group flex items-center ${big ? "gap-2.5" : "gap-2"} ${className}`}>
      <span
        className={`relative inline-flex ${big ? "h-10 w-10" : "h-7 w-7"} items-center justify-center overflow-hidden rounded-lg border border-border bg-surface`}
      >
        {/* Bill document lines */}
        <span className="absolute inset-1.5 flex flex-col justify-center gap-[3px] rounded-sm border border-foreground/30 bg-foreground/10 px-1">
          <span className="h-px w-full rounded-full bg-foreground/60" />
          <span className="h-px w-3/4 rounded-full bg-foreground/60" />
          <span className="h-px w-full rounded-full bg-foreground/60" />
        </span>
        {/* SOS alert dot */}
        <span
          className={`absolute right-0.5 top-0.5 ${big ? "h-2.5 w-2.5" : "h-2 w-2"} rounded-full bg-red-500 ring-1 ring-background`}
        />
      </span>
      <span className={`font-semibold tracking-tight ${big ? "text-xl" : ""}`}>
        Hello<span className="text-red-500">Data</span>
      </span>
    </Link>
  );
}
