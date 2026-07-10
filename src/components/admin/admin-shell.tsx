import { type ReactNode, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Building2,
  CreditCard,
  Receipt,
  Layers3,
  Brain,
  Bell,
  Headphones,
  Settings,
  FileText,
  Search,
  ChevronRight,
  Activity,
  PanelLeft,
  Sun,
  Moon,
  ClipboardList,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { CommandPalette } from "./command-palette";
import { useTheme } from "@/lib/theme";
import { useOpenTicketCount } from "@/lib/queries";

// ── Navigation Structure ─────────────────────────────────────────────────────
interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { to: "/admin", label: "Overview", icon: LayoutDashboard },
      { to: "/admin/queue", label: "Queue", icon: Layers3 },
      { to: "/admin/analytics", label: "ExDoc Health", icon: Brain },
    ],
  },
  {
    title: "Business",
    items: [
      { to: "/admin/users", label: "Users", icon: Users },
      { to: "/admin/organizations", label: "Organizations", icon: Building2 },
      { to: "/admin/plans", label: "Plans", icon: CreditCard },
      { to: "/admin/billing", label: "Revenue", icon: Receipt },
    ],
  },
  {
    title: "Platform",
    items: [{ to: "/admin/notifications", label: "Notifications", icon: Bell, badge: "3" }],
  },
  {
    title: "Support",
    items: [
      { to: "/admin/reports", label: "Reports", icon: FileText },
      { to: "/admin/support", label: "Tickets", icon: Headphones },
      { to: "/admin/contact", label: "Contact", icon: Mail },
      { to: "/admin/audit", label: "Audit Log", icon: ClipboardList },
      { to: "/admin/admin-tools", label: "Admin Tools", icon: ShieldCheck },
      { to: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Page title map
const pageTitles: Record<string, string> = {
  "/admin": "Operations Dashboard",
  "/admin/users": "User Management",
  "/admin/organizations": "Organizations",
  "/admin/plans": "Plans & Subscriptions",
  "/admin/billing": "Revenue Operations",
  "/admin/queue": "Processing Queue",
  "/admin/analytics": "ExDoc Health",
  "/admin/notifications": "Notification Center",
  "/admin/support": "Support Center",
  "/admin/contact": "Contact Submissions",
  "/admin/settings": "Global Settings",
  "/admin/reports": "Enterprise Reports",
  "/admin/admin-tools": "Admin Tools",
};

// ── AdminShell Component ─────────────────────────────────────────────────────
export function AdminShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const { data: openTicketCount } = useOpenTicketCount();

  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const pageTitle = pageTitles[pathname] || "Admin";

  const isActive = (to: string) => {
    if (to === "/admin") return pathname === "/admin";
    return pathname.startsWith(to);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <CommandPalette />

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside
        className={`flex h-full shrink-0 flex-col border-r border-border bg-surface transition-all duration-200 ${
          collapsed ? "w-[52px]" : "w-[220px]"
        }`}
      >
        {/* Logo */}
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold text-foreground">
                H
              </div>
              <span className="text-xs font-semibold tracking-tight">HelloData</span>
              <span className="rounded border border-border/80 bg-muted px-1 py-0.5 font-mono text-[8px] font-medium uppercase tracking-wider text-muted-foreground">
                Admin
              </span>
            </div>
          )}
          {collapsed && (
            <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold text-foreground">
              H
            </div>
          )}
        </div>

        {/* Nav Groups */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-1">
              {!collapsed && (
                <div className="px-3 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/80">
                  {group.title}
                </div>
              )}
              {collapsed && <div className="my-1 mx-2 h-px bg-muted/80" />}
              {group.items.map((item) => {
                const active = isActive(item.to);
                const badge =
                  item.to === "/admin/support"
                    ? openTicketCount !== undefined
                      ? String(openTicketCount)
                      : undefined
                    : item.badge;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`group mx-1.5 mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-all duration-150 ${
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-surface-2 hover:text-foreground/90"
                    } ${collapsed ? "justify-center" : ""}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon
                      className={`h-3.5 w-3.5 shrink-0 ${active ? "text-blue-500" : ""}`}
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge && (
                          <span className="rounded-full bg-muted/80 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-border p-2">
          {!collapsed && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-surface-2 p-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-[9px] font-bold text-background">
                SA
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium">Super Admin</div>
                <div className="truncate font-mono text-[9px] text-muted-foreground/80">
                  admin@hellodata.ai
                </div>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-muted-foreground/80 transition-colors hover:bg-surface-2 hover:text-foreground/80"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <>
                <PanelLeft className="h-3 w-3" />
                <span className="font-mono text-[10px]">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main Content ───────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/80">
              <span>Admin</span>
              <span className="text-muted-foreground/60">/</span>
              <span className="text-foreground/80">{pageTitle}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Search trigger */}
            <button
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
              }}
              className="hidden h-7 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-muted-foreground/80 transition-colors hover:border-border/80 hover:text-foreground/80 md:flex"
            >
              <Search className="h-3 w-3" />
              <span className="font-mono text-[10px]">Search…</span>
              <kbd className="rounded border border-border/80 bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground/80">
                ⌘K
              </kbd>
            </button>
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="relative flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground/80 transition-colors hover:bg-surface-2 hover:text-foreground/80"
              title="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
            {/* Live indicator */}
            <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
              <Activity className="h-3 w-3 text-emerald-500" />
              <span className="font-mono text-[10px] text-emerald-500">Live</span>
            </div>
            {/* Notifications */}
            <button className="relative flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground/80 transition-colors hover:bg-surface-2 hover:text-foreground/80">
              <Bell className="h-3.5 w-3.5" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-background">{children}</main>
      </div>
    </div>
  );
}
