import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { User, Building2, CreditCard, ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-guards";
import { useSectionAccess } from "@/lib/use-section-access";

export const Route = createFileRoute("/settings")({
  beforeLoad: requireAuth,
  component: SettingsLayout,
});

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const billingAccess = useSectionAccess("billing");

  const nav = [
    { name: "Profile", path: "/settings", icon: User, exact: true },
    { name: "Organization", path: "/settings/organization", icon: Building2 },
    ...(billingAccess !== "none"
      ? [{ name: "Billing & Plans", path: "/settings/billing", icon: CreditCard, exact: false }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Settings Topbar */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 md:px-8">
          <Link to="/dashboard" className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 md:flex-row md:px-8">
        {/* Settings Sidebar */}
        <aside className="w-full shrink-0 md:w-64">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage your account and workspace.</p>
          </div>
          <nav className="flex flex-col gap-1">
            {nav.map((item) => {
              const isActive = item.exact ? pathname === item.path : pathname.startsWith(item.path);
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Settings Content */}
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
