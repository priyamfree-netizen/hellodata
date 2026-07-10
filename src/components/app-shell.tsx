import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  LayoutDashboard,
  FileStack,
  Sparkles,
  Workflow,
  Table2,
  Settings,
  ChevronsLeftRight,
  Search,
  Bell,
  Upload,
  History,
  LogOut,
  Headphones,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { RequireWorkspace } from "./require-workspace";
import { useAuth } from "@/lib/auth/context";
import {
  useDocuments,
  useExtractions,
  useOrgMembers,
  useProcessingJobs,
  useTemplates,
  useUserNotifications,
  useMarkNotificationRead,
} from "@/lib/queries";
import { resolveSectionAccess } from "@/lib/permissions";
import type { Section } from "@/lib/supabase/types";

const navGroups = [
  [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: null },
    { to: "/upload", label: "Upload", icon: Upload, section: "process" },
    { to: "/output", label: "Data Entries", icon: Table2, section: "data_entries" },
  ],
  [
    { to: "/configure", label: "Configure", icon: Sparkles, section: "process" },
    { to: "/templates", label: "Templates", icon: FileStack, section: "templates" },
  ],
  [
    { to: "/processing", label: "Processing", icon: Workflow, section: "process" },
    { to: "/history", label: "History", icon: History, section: "history" },
  ],
  [
    { to: "/settings", label: "Settings", icon: Settings, section: null },
    { to: "/support", label: "Support", icon: Headphones, section: "support" },
  ],
] as const satisfies readonly (readonly {
  to: string;
  label: string;
  icon: LucideIcon;
  section: Section | null;
}[])[];

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  // Gate every shell-wrapped page on workspace status. The inner shell only
  // mounts once status === 'ready', so its hooks/queries don't run while we're
  // still loading auth, redirecting to onboarding, or showing a backend error.
  return (
    <RequireWorkspace>
      <AppShellInner title={title}>{children}</AppShellInner>
    </RequireWorkspace>
  );
}

function AppShellInner({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { user, profile, currentOrg, orgs, setCurrentOrg, signOut } = useAuth();
  const { data: members = [] } = useOrgMembers(currentOrg?.id);
  const me = members.find((m) => m.user_id === user?.id && m.status === "active");
  const myRole = me?.role ?? null;
  const mySectionAccess = me?.section_access;
  const visibleNavGroups = useMemo(
    () =>
      navGroups
        .map((group) =>
          group.filter(
            (n) =>
              !n.section || resolveSectionAccess(myRole, mySectionAccess, n.section) !== "none",
          ),
        )
        .filter((group) => group.length > 0),
    [myRole, mySectionAccess],
  );
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: jobs } = useProcessingJobs(currentOrg?.id, 50);
  const { data: documents = [] } = useDocuments(currentOrg?.id, 50);
  const { data: templates = [] } = useTemplates({
    orgId: currentOrg?.id ?? null,
    authorId: profile?.id ?? null,
  });
  const { data: extractions = [] } = useExtractions(currentOrg?.id, 50);
  const { data: notifications = [] } = useUserNotifications();
  const markRead = useMarkNotificationRead();
  const readIds: string[] =
    typeof window !== "undefined"
      ? JSON.parse(localStorage.getItem("billsos_read_notifs") ?? "[]")
      : [];
  const unreadCount = notifications.filter((n) => !readIds.includes(n.id)).length;
  const activeJobs = (jobs ?? []).filter((j) =>
    ["pending", "queued", "ocr", "ai_extraction", "validation", "export", "retry"].includes(
      j.stage,
    ),
  ).length;

  const computedInitials =
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase();
  const initials =
    profile?.avatar_initials ?? (computedInitials || profile?.email?.[0]?.toUpperCase() || "?");

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login" });
  }

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const results: Array<{
      type: string;
      label: string;
      detail: string;
      to:
        | "/dashboard"
        | "/upload"
        | "/categories"
        | "/configure"
        | "/processing"
        | "/history"
        | "/output"
        | "/templates"
        | "/settings"
        | "/support";
    }> = [];
    const pages: {
      label: string;
      detail: string;
      to: (typeof results)[number]["to"];
      section: Section | null;
    }[] = [
      { label: "Dashboard", detail: "Overview", to: "/dashboard", section: null },
      { label: "Upload", detail: "Upload documents", to: "/upload", section: "process" },
      { label: "Templates", detail: "Template library", to: "/templates", section: "templates" },
      { label: "Configure", detail: "Extraction fields", to: "/configure", section: "process" },
      { label: "Processing", detail: "Jobs and queue", to: "/processing", section: "process" },
      { label: "History", detail: "Extraction history", to: "/history", section: "history" },
      {
        label: "Data Entries",
        detail: "Structured output",
        to: "/output",
        section: "data_entries",
      },
      { label: "Settings", detail: "Account and workspace", to: "/settings", section: null },
      { label: "Support", detail: "Help and tickets", to: "/support", section: "support" },
    ];

    for (const { section, ...page } of pages) {
      if (
        (!section || resolveSectionAccess(myRole, mySectionAccess, section) !== "none") &&
        `${page.label} ${page.detail}`.toLowerCase().includes(q)
      ) {
        results.push({ type: "Page", ...page });
      }
    }

    for (const doc of documents) {
      if (`${doc.file_name} ${doc.status} ${doc.mime_type ?? ""}`.toLowerCase().includes(q)) {
        results.push({
          type: "Document",
          label: doc.file_name,
          detail: doc.status,
          to: "/history",
        });
      }
    }

    for (const template of templates) {
      if (
        `${template.name} ${template.description ?? ""} ${template.scope}`.toLowerCase().includes(q)
      ) {
        results.push({
          type: "Template",
          label: template.name,
          detail: `${template.field_count} fields`,
          to: "/configure",
        });
      }
    }

    for (const extraction of extractions) {
      const data =
        extraction.data && typeof extraction.data === "object" && !Array.isArray(extraction.data)
          ? (extraction.data as Record<string, unknown>)
          : {};
      for (const [key, value] of Object.entries(data)) {
        const text =
          `${key} ${typeof value === "string" || typeof value === "number" ? value : JSON.stringify(value)}`.toLowerCase();
        if (text.includes(q)) {
          results.push({
            type: "Field",
            label: key,
            detail:
              typeof value === "string" || typeof value === "number"
                ? String(value)
                : "Structured value",
            to: "/output",
          });
          break;
        }
      }
    }

    return results.slice(0, 8);
  }, [documents, extractions, myRole, mySectionAccess, searchQuery, templates]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-border px-6">
          <Logo size="lg" />
        </div>

        <div className="relative px-3 pt-4">
          <button
            onClick={() => setOrgPickerOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg border border-sidebar-border bg-background/40 px-3 py-2 text-left transition-colors hover:bg-sidebar-accent"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-blue/15 text-[10px] font-semibold text-brand-blue">
                {(currentOrg?.name ?? "").slice(0, 2).toUpperCase() || "—"}
              </div>
              <div className="leading-tight">
                <div className="text-xs font-medium">{currentOrg?.name ?? "No workspace"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {currentOrg ? "Workspace" : "Create one →"}
                </div>
              </div>
            </div>
            <ChevronsLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {orgPickerOpen && orgs.length > 1 && (
            <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border border-sidebar-border bg-sidebar shadow-lg">
              {orgs.map((o) => (
                <button
                  key={o.id}
                  onClick={async () => {
                    await setCurrentOrg(o.id);
                    setOrgPickerOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-sidebar-accent ${o.id === currentOrg?.id ? "font-medium text-foreground" : "text-muted-foreground"}`}
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-brand-blue/15 text-[9px] font-semibold text-brand-blue">
                    {o.name.slice(0, 2).toUpperCase()}
                  </div>
                  {o.name}
                  {o.id === currentOrg?.id && (
                    <span className="ml-auto text-[10px] text-brand-blue">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Workspace
          </div>
          <div className="space-y-3">
            {visibleNavGroups.map((group, groupIndex) => (
              <div key={groupIndex} className="space-y-0.5">
                {groupIndex > 0 && (
                  <div className="px-2 py-2">
                    <div className="h-px bg-gradient-to-r from-transparent via-sidebar-border to-transparent opacity-80 blur-[0.2px]" />
                  </div>
                )}
                {group.map((n) => {
                  const active =
                    pathname === n.to || (n.to !== "/dashboard" && pathname.startsWith(n.to));
                  return (
                    <Link
                      key={n.to}
                      to={n.to}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-sidebar-accent text-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                      }`}
                    >
                      <n.icon className="h-4 w-4" />
                      {n.label}
                      {n.to === "/processing" && activeJobs > 0 && (
                        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand-lime/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-lime">
                          <span className="h-1 w-1 animate-pulse-dot rounded-full bg-brand-lime" />{" "}
                          {activeJobs}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-background/40 p-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background">
              {initials.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-medium">
                {profile?.full_name ?? profile?.email ?? "Guest"}
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {profile?.email ?? "Not signed in"}
              </div>
            </div>
            <ThemeToggle />
          </div>
          <button
            onClick={handleSignOut}
            className="mt-1.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-red-400"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-xl">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              Workspace / {currentOrg?.name ?? "—"}
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {title ?? "Dashboard"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative hidden md:block">
              <div className="flex h-9 w-80 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted-foreground">
                <Search className="h-3.5 w-3.5" />
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearchOpen(false);
                    if (e.key === "Enter" && searchResults[0]) {
                      void navigate({ to: searchResults[0].to });
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Search documents, fields, templates..."
                  className="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              {searchOpen && searchQuery.trim() && (
                <div className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-xl border border-border bg-background shadow-xl">
                  {searchResults.length === 0 ? (
                    <div className="px-4 py-5 text-center text-xs text-muted-foreground">
                      No matches found
                    </div>
                  ) : (
                    searchResults.map((result, index) => (
                      <button
                        key={`${result.type}-${result.label}-${index}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          void navigate({ to: result.to });
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                        className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface"
                      >
                        <span className="w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-center font-mono text-[10px] text-muted-foreground">
                          {result.type}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground">
                            {result.label}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {result.detail}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setBellOpen((o) => !o)}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-blue text-[9px] font-bold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-border bg-background shadow-xl">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <span className="text-sm font-medium">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markRead.mutate("all")}
                        className="text-[11px] text-brand-blue hover:underline"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                        No notifications
                      </p>
                    ) : (
                      notifications.slice(0, 15).map((n) => {
                        const isRead = readIds.includes(n.id);
                        return (
                          <button
                            key={n.id}
                            onClick={() => {
                              if (!isRead) markRead.mutate(n.id);
                            }}
                            className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-surface ${!isRead ? "bg-brand-blue/5" : ""}`}
                          >
                            <span className="text-xs font-medium">{n.subject}</span>
                            {n.body && (
                              <span className="text-[11px] text-muted-foreground line-clamp-2">
                                {n.body}
                              </span>
                            )}
                            <span className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                              {new Date(n.sent_at ?? n.created_at).toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <Link
              to="/upload"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
            >
              <Upload className="h-3.5 w-3.5" /> New job
            </Link>
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
