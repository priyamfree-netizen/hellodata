import { Link } from "@tanstack/react-router";
import { ArrowUpRight, LayoutDashboard } from "lucide-react";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { useState } from "react";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/context";

const nav = [
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact" },
] as const;

export function MarketingNav() {
  const { status } = useAuth();
  const isReady = status === "ready";

  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (latest) => setScrolled(latest > 80));

  return (
    <div className="pointer-events-none sticky top-0 z-40 w-full">
      <motion.header
        animate={{
          width: scrolled ? "70%" : "100%",
          y: scrolled ? 12 : 0,
          boxShadow: scrolled
            ? "0 12px 40px -12px rgba(0, 0, 0, 0.25)"
            : "0 0 0 0 rgba(0, 0, 0, 0)",
        }}
        transition={{ type: "spring", stiffness: 200, damping: 40 }}
        className={cn(
          "pointer-events-auto mx-auto flex h-16 max-w-7xl items-center justify-between px-6 backdrop-blur-xl",
          "transition-[background-color,border-radius,border-color] duration-300",
          scrolled
            ? "rounded-full border border-border/70 bg-background/80"
            : "border-b border-border/70 bg-background/70",
        )}
      >
        <div className="flex items-center gap-10">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {isReady ? (
            /* Logged-in state — single prominent CTA */
            <Link
              to="/dashboard"
              className="group inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          ) : (
            /* Logged-out / loading state */
            <>
              <Link
                to="/login"
                className="hidden h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground transition-colors hover:bg-surface sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                className="group inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Start free
                <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </>
          )}
        </div>
      </motion.header>
    </div>
  );
}
