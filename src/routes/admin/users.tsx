import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState, type ComponentType } from "react";
import {
  CreditCard,
  Download,
  Eye,
  FlaskConical,
  Key,
  Lock,
  LogOut,
  RotateCcw,
  Search,
  Shield,
  UploadCloud,
  UserX,
} from "lucide-react";
import { DataTable, type Column } from "@/components/admin/data-table";
import { DetailPanel, DetailRow, DetailTabs } from "@/components/admin/detail-panel";
import { LazyMiniChart as MiniChart } from "@/components/admin/lazy-mini-chart";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import {
  type AdminUserDetail,
  type AdminUserListRow,
  useAdminUserAction,
  useAdminUserDetail,
  useAdminUsers,
  useCreateAdminUserNote,
} from "@/lib/queries";

export const Route = createFileRoute("/admin/users")({
  component: UserManagement,
});

const FILTERS = [
  "All Users",
  "Enterprise",
  "Inactive 30d",
  "High API Usage",
  "Suspicious",
  "Storage Heavy",
  "Trial",
  "Restricted",
];

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "billing", label: "Billing" },
  { id: "usage", label: "Usage" },
  { id: "activity", label: "Activity" },
  { id: "security", label: "Security" },
  { id: "api", label: "API" },
  { id: "notes", label: "Notes" },
];

function formatNumber(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-IN");
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return `${formatDate(iso)}, ${d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "--";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatInr(amount: number | null | undefined): string {
  return `INR ${Number(amount ?? 0).toLocaleString("en-IN")}`;
}

function isInactive30d(user: AdminUserListRow): boolean {
  const activity = user.lastActivity ?? user.lastLogin ?? user.createdAt;
  return Date.now() - new Date(activity).getTime() > 30 * 86400000;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportUsersCsv(rows: AdminUserListRow[]) {
  const headers = [
    "id",
    "name",
    "email",
    "status",
    "country",
    "organization",
    "plan",
    "pages_processed",
    "ai_tokens_30d",
    "api_calls_30d",
    "storage_used",
    "credits_remaining",
    "team_size",
    "active_sessions",
    "risk_score",
    "last_login",
    "last_activity",
  ];
  const body = rows.map((u) =>
    [
      u.id,
      u.name,
      u.email,
      u.status,
      u.country,
      u.primaryOrg?.name,
      u.plan,
      u.pagesProcessed,
      u.aiTokens30d,
      u.apiCalls30d,
      u.storageUsed,
      u.creditsRemaining,
      u.teamSize,
      u.activeSessions,
      u.riskScore,
      u.lastLogin,
      u.lastActivity,
    ]
      .map(csvCell)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `admin-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function UserManagement() {
  const [filter, setFilter] = useState("All Users");
  const [search, setSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [detailUser, setDetailUser] = useState<AdminUserListRow | null>(null);
  const [detailTab, setDetailTab] = useState("overview");
  const { data: usersData, isLoading } = useAdminUsers({ limit: 100, search });
  const adminAction = useAdminUserAction();

  const allUsers = usersData?.rows ?? [];

  const filteredUsers = useMemo(() => {
    let users = allUsers;
    if (filter === "Enterprise") {
      users = users.filter((u) => u.plan.toLowerCase().includes("enterprise"));
    }
    if (filter === "Inactive 30d") users = users.filter(isInactive30d);
    if (filter === "High API Usage") users = users.filter((u) => u.apiCalls30d > 10000);
    if (filter === "Suspicious") users = users.filter((u) => u.riskScore > 70);
    if (filter === "Trial") {
      users = users.filter(
        (u) => u.status === "trial" || u.plan.toLowerCase().includes("trial"),
      );
    }
    if (filter === "Storage Heavy") users = users.filter((u) => u.storageUsedBytes > 20 * 1024 ** 3);
    if (filter === "Restricted") {
      users = users.filter(
        (u) => u.restrictions.uploadsDisabled || u.restrictions.apiRestricted,
      );
    }

    const sorted = [...users];
    sorted.sort((a, b) => {
      const av = sortableValue(a, sortField);
      const bv = sortableValue(b, sortField);
      const result = av > bv ? 1 : av < bv ? -1 : 0;
      return sortDir === "asc" ? result : -result;
    });
    return sorted;
  }, [allUsers, filter, sortDir, sortField]);

  const handleSelectRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedRows((prev) =>
      prev.size === filteredUsers.length ? new Set() : new Set(filteredUsers.map((u) => u.id)),
    );
  }, [filteredUsers]);

  const handleSort = useCallback(
    (field: string) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField],
  );

  const columns: Column<AdminUserListRow>[] = useMemo(
    () => [
      {
        key: "name",
        label: "User",
        sortable: true,
        width: "230px",
        render: (u) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-foreground/80">
              {u.avatar}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">{u.name}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground/80">
                {u.email}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: "primaryOrg",
        label: "Organization",
        sortable: true,
        render: (u) => u.primaryOrg?.name ?? <span className="text-muted-foreground/70">No org</span>,
      },
      {
        key: "plan",
        label: "Plan",
        sortable: true,
        render: (u) => (
          <span className="rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-foreground/80">
            {u.plan}
          </span>
        ),
      },
      { key: "status", label: "Status", render: (u) => <AutoStatusBadge status={u.status} /> },
      { key: "country", label: "Country", render: (u) => u.country ?? "--" },
      {
        key: "pagesProcessed",
        label: "Pages",
        sortable: true,
        align: "right",
        mono: true,
        render: (u) => formatNumber(u.pagesProcessed),
      },
      { key: "storageUsed", label: "Storage", sortable: true, align: "right", mono: true },
      {
        key: "creditsRemaining",
        label: "Credits",
        sortable: true,
        align: "right",
        mono: true,
        render: (u) => formatNumber(u.creditsRemaining),
      },
      {
        key: "apiCalls30d",
        label: "API 30d",
        sortable: true,
        align: "right",
        mono: true,
        render: (u) => formatNumber(u.apiCalls30d),
      },
      {
        key: "activeSessions",
        label: "Sessions",
        sortable: true,
        align: "right",
        mono: true,
      },
      {
        key: "riskScore",
        label: "Risk",
        sortable: true,
        align: "right",
        render: (u) => (
          <span
            className={`font-mono text-[12px] ${
              u.riskScore > 70
                ? "text-red-400"
                : u.riskScore > 40
                  ? "text-amber-400"
                  : "text-emerald-400"
            }`}
          >
            {u.riskScore}
          </span>
        ),
      },
      {
        key: "lastLogin",
        label: "Last Login",
        sortable: true,
        mono: true,
        render: (u) => formatDate(u.lastLogin),
      },
    ],
    [],
  );

  const selected = [...selectedRows];
  const runBulk = (action: "suspend" | "unsuspend") => {
    selected.forEach((userId) => adminAction.mutate({ userId, action }));
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">User Management</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            {formatNumber(allUsers.length)} loaded / {formatNumber(filteredUsers.length)} shown
          </p>
        </div>
        <button
          onClick={() => exportUsersCsv(filteredUsers)}
          className="flex items-center gap-1.5 rounded-md border border-border/80 bg-muted px-3 py-1.5 font-mono text-[11px] text-foreground/80 transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          <Download className="h-3 w-3" />
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground/80" />
          <input
            type="text"
            placeholder="Search users, emails..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                filter === f
                  ? "border-blue-600/20 bg-blue-600/10 text-blue-400"
                  : "border-transparent text-muted-foreground/80 hover:border-border/80 hover:text-foreground/80"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredUsers}
        keyField="id"
        selectedRows={selectedRows}
        onSelectRow={handleSelectRow}
        onSelectAll={handleSelectAll}
        onRowClick={(user) => {
          setDetailUser(user);
          setDetailTab("overview");
        }}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
        emptyMessage={isLoading ? "Loading real users..." : "No users match the current filters"}
        bulkActions={[
          { label: "Suspend", onClick: () => runBulk("suspend") },
          { label: "Unsuspend", onClick: () => runBulk("unsuspend") },
          {
            label: "Add 100 Credits",
            onClick: () =>
              selected.forEach((userId) =>
                adminAction.mutate({ userId, action: "add_credits", credits: 100 }),
              ),
          },
          { label: "Export", onClick: () => exportUsersCsv(filteredUsers.filter((u) => selectedRows.has(u.id))) },
        ]}
      />

      <DetailPanel
        open={!!detailUser}
        onClose={() => setDetailUser(null)}
        title={detailUser?.name ?? ""}
        subtitle={detailUser?.email}
      >
        {detailUser && (
          <UserDetailContent
            userId={detailUser.id}
            fallback={detailUser}
            detailTab={detailTab}
            setDetailTab={setDetailTab}
          />
        )}
      </DetailPanel>
    </div>
  );
}

function sortableValue(user: AdminUserListRow, field: string): string | number {
  if (field === "primaryOrg") return user.primaryOrg?.name ?? "";
  if (field === "lastLogin") return user.lastLogin ? new Date(user.lastLogin).getTime() : 0;
  if (field === "storageUsed") return user.storageUsedBytes;
  const value = user[field];
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.toLowerCase();
  return "";
}

function UserDetailContent({
  userId,
  fallback,
  detailTab,
  setDetailTab,
}: {
  userId: string;
  fallback: AdminUserListRow;
  detailTab: string;
  setDetailTab: (tab: string) => void;
}) {
  const { data: detail, error, isLoading } = useAdminUserDetail(userId);

  return (
    <>
      <DetailTabs tabs={tabs} activeTab={detailTab} onTabChange={setDetailTab} />
      {isLoading && !detail ? (
        <div className="px-6 py-4 font-mono text-xs text-muted-foreground">Loading live user data...</div>
      ) : detail ? (
        <DetailTabBody detail={detail} detailTab={detailTab} />
      ) : (
        <div className="px-6 py-4 text-xs text-muted-foreground">
          {error instanceof Error ? error.message : `Could not load ${fallback.name}.`}
        </div>
      )}
    </>
  );
}

function DetailTabBody({ detail, detailTab }: { detail: AdminUserDetail; detailTab: string }) {
  const action = useAdminUserAction();
  const createNote = useCreateAdminUserNote();
  const [note, setNote] = useState("");
  const usagePages = detail.usage30d.map((r) => Number(r.pages_processed ?? 0));
  const usageTokens = detail.usage30d.map((r) => Number(r.ai_tokens_used ?? 0));
  const usageApi = detail.usage30d.map((r) => Number(r.api_calls ?? 0));
  const usageStorage = detail.usage30d.map((r) => Number(r.storage_bytes ?? 0));
  const hasUsage = detail.usage30d.length > 0;
  const uploadsDisabled = detail.restrictions.uploadsDisabled;
  const apiRestricted = detail.restrictions.apiRestricted;

  const saveNote = () => {
    const body = note.trim();
    if (!body) return;
    createNote.mutate(
      { userId: detail.id, body },
      {
        onSuccess: () => setNote(""),
      },
    );
  };

  if (detailTab === "overview") {
    return (
      <div>
        <div className="flex items-center gap-4 border-b border-border/50 px-6 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-lg font-semibold text-foreground/80">
            {detail.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium">{detail.name}</div>
            <div className="truncate font-mono text-xs text-muted-foreground/80">
              {detail.primaryOrg?.name ?? "No organization"} / {detail.plan}
            </div>
          </div>
          <AutoStatusBadge status={detail.status} />
        </div>

        <div className="grid grid-cols-3 gap-px border-b border-border/50 bg-muted">
          {[
            { label: "Pages", value: formatNumber(detail.pagesProcessed) },
            { label: "Credits", value: formatNumber(detail.creditsRemaining) },
            { label: "Risk", value: `${detail.riskScore}/100` },
          ].map((s) => (
            <div key={s.label} className="bg-surface px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {s.label}
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>

        <DetailRow label="Email" value={detail.email || "--"} mono />
        <DetailRow label="Phone" value={detail.phone ?? "--"} mono />
        <DetailRow label="Organization" value={detail.primaryOrg?.name ?? "No organization"} />
        <DetailRow label="Plan" value={detail.plan} />
        <DetailRow label="Country" value={detail.country ?? "--"} />
        <DetailRow label="Storage" value={detail.storageUsed} mono />
        <DetailRow label="AI Tokens 30d" value={formatNumber(detail.aiTokens30d)} mono />
        <DetailRow label="API Calls 30d" value={formatNumber(detail.apiCalls30d)} mono />
        <DetailRow label="Team Size" value={formatNumber(detail.teamSize)} mono />
        <DetailRow label="Active Sessions" value={formatNumber(detail.activeSessions)} mono />
        <DetailRow label="Created" value={formatDateTime(detail.createdAt)} mono />
        <DetailRow label="Last Login" value={formatDateTime(detail.lastLogin)} mono />

        <div className="border-t border-border/50 px-6 py-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
            Processing activity / 30d
          </div>
          {hasUsage ? (
            <MiniChart data={usagePages} color="#2563eb" height={48} />
          ) : (
            <EmptyState text="No usage records for this user organization." />
          )}
        </div>

        <div className="border-t border-border/50 px-6 py-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
            Safe Admin Actions
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              icon={UserX}
              label={detail.status === "suspended" ? "Unsuspend User" : "Suspend User"}
              onClick={() =>
                action.mutate({
                  userId: detail.id,
                  action: detail.status === "suspended" ? "unsuspend" : "suspend",
                })
              }
              disabled={action.isPending}
            />
            <ActionButton
              icon={CreditCard}
              label="Add 100 Credits"
              onClick={() => action.mutate({ userId: detail.id, action: "add_credits", credits: 100 })}
              disabled={action.isPending || !detail.primaryOrg}
              title={!detail.primaryOrg ? "User has no organization for credits" : undefined}
            />
            <ActionButton
              icon={UploadCloud}
              label={uploadsDisabled ? "Enable Uploads" : "Disable Uploads"}
              onClick={() =>
                action.mutate({
                  userId: detail.id,
                  action: "toggle_uploads",
                  disabled: !uploadsDisabled,
                  reason: !uploadsDisabled ? "Disabled from superadmin user page" : undefined,
                })
              }
              disabled={action.isPending}
            />
            <ActionButton
              icon={Shield}
              label={apiRestricted ? "Unrestrict API" : "Restrict API"}
              onClick={() =>
                action.mutate({
                  userId: detail.id,
                  action: "toggle_api",
                  restricted: !apiRestricted,
                  reason: !apiRestricted ? "Restricted from superadmin user page" : undefined,
                })
              }
              disabled={action.isPending}
            />
            <ActionButton icon={Eye} label="Impersonate" disabled title="Needs separate audited workflow" />
            <ActionButton icon={Key} label="Reset API Keys" disabled title="Needs key rotation workflow" />
            <ActionButton icon={LogOut} label="Force Logout" disabled title="Needs session revoke workflow" />
            <ActionButton icon={RotateCcw} label="Reset Password" disabled title="Needs password reset workflow" />
            <ActionButton icon={FlaskConical} label="Enable Enterprise" disabled title="Use billing workflow later" />
            <ActionButton icon={Lock} label="Change Limits" disabled title="Use plan limits workflow later" />
          </div>
        </div>
      </div>
    );
  }

  if (detailTab === "billing") {
    return (
      <div className="p-6">
        <SectionTitle>Billing History</SectionTitle>
        {detail.transactions.length === 0 ? (
          <EmptyState text="No transactions found." />
        ) : (
          <div className="space-y-2">
            {detail.transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-md border border-border/50 bg-surface-2 px-4 py-3"
              >
                <div>
                  <div className="text-[12px] text-foreground/80">{formatDate(tx.created_at)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground/80">
                    {tx.method ?? "--"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[13px] text-foreground/90">
                    {formatInr(tx.amount_inr)}
                  </div>
                  <div
                    className={`font-mono text-[10px] ${
                      tx.status === "succeeded"
                        ? "text-emerald-500"
                        : tx.status === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground/80"
                    }`}
                  >
                    {tx.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (detailTab === "usage") {
    return (
      <div className="space-y-6 p-6">
        {!hasUsage ? (
          <EmptyState text="No usage records in the last 30 days." />
        ) : (
          [
            { label: "Pages Processed", data: usagePages, color: "#2563eb" },
            { label: "AI Token Usage", data: usageTokens, color: "#16a34a" },
            { label: "API Calls", data: usageApi, color: "#f59e0b" },
            { label: "Storage Bytes", data: usageStorage, color: "#0891b2" },
          ].map((chart) => (
            <div key={chart.label}>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {chart.label}
              </div>
              <MiniChart data={chart.data} color={chart.color} height={42} />
            </div>
          ))
        )}
      </div>
    );
  }

  if (detailTab === "activity") {
    return (
      <div className="divide-y divide-border/50">
        {detail.auditLogs.length === 0 ? (
          <div className="px-6 py-4">
            <EmptyState text="No audit log entries." />
          </div>
        ) : (
          detail.auditLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between gap-4 px-6 py-3 transition-colors hover:bg-surface-2"
            >
              <span className="text-[12px] text-foreground/80">
                {log.action}
                {log.target_label ? ` / ${log.target_label}` : ""}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                {formatRelative(log.created_at)}
              </span>
            </div>
          ))
        )}
      </div>
    );
  }

  if (detailTab === "security") {
    return (
      <div className="space-y-4 p-6">
        <DetailRow
          label="2FA Status"
          value={
            detail.profile.two_factor_enabled ? (
              <span className="text-emerald-400">Enabled</span>
            ) : (
              <span className="text-muted-foreground">Disabled</span>
            )
          }
        />
        <DetailRow label="Last Password Change" value={formatDateTime(detail.profile.password_changed_at)} mono />
        <DetailRow label="Active Sessions" value={formatNumber(detail.activeSessions)} mono />
        <DetailRow
          label="Risk Score"
          value={
            <span
              className={
                detail.riskScore > 70
                  ? "text-red-400"
                  : detail.riskScore > 40
                    ? "text-amber-400"
                    : "text-emerald-400"
              }
            >
              {detail.riskScore}/100
            </span>
          }
        />
        <SectionTitle>Security Events</SectionTitle>
        {detail.securityEvents.length === 0 ? (
          <EmptyState text="No security events found." />
        ) : (
          <div className="space-y-2">
            {detail.securityEvents.map((event) => (
              <div key={event.id} className="rounded-md border border-border/50 bg-surface-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-foreground/80">{event.type}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {event.severity}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                  {event.details ?? "No details"} / {formatRelative(event.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
        <SectionTitle>Recent Sessions</SectionTitle>
        {detail.sessions.length === 0 ? (
          <EmptyState text="No sessions found." />
        ) : (
          <div className="space-y-2">
            {detail.sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-surface-2 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] text-foreground/80">
                    {session.device ?? "Unknown device"}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground/80">
                    {session.ip_address ?? "--"}
                    {session.location ? ` / ${session.location}` : ""}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                  {formatRelative(session.last_seen_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (detailTab === "api") {
    return (
      <div className="space-y-4 p-6">
        <DetailRow label="API Restriction" value={apiRestricted ? "Restricted" : "Allowed"} />
        <DetailRow label="Active API Keys" value={`${detail.apiKeys.length} active`} mono />
        <ActionButton
          icon={Shield}
          label={apiRestricted ? "Unrestrict API" : "Restrict API"}
          onClick={() =>
            action.mutate({
              userId: detail.id,
              action: "toggle_api",
              restricted: !apiRestricted,
              reason: !apiRestricted ? "Restricted from superadmin user page" : undefined,
            })
          }
          disabled={action.isPending}
        />
        <SectionTitle>Active Keys</SectionTitle>
        {detail.apiKeys.length === 0 ? (
          <EmptyState text="No active API keys." />
        ) : (
          <div className="space-y-2">
            {detail.apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-md border border-border/50 bg-surface-2 px-4 py-2.5"
              >
                <div>
                  <span className="font-mono text-[12px] text-foreground/80">{key.prefix}*****</span>
                  <div className="font-mono text-[10px] text-muted-foreground/60">{key.name}</div>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground/60">{key.scope}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <SectionTitle>Internal Notes</SectionTitle>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-foreground/80 outline-none placeholder:text-muted-foreground/60 focus:border-border/80"
        rows={4}
        placeholder="Add an internal note for this user..."
      />
      <button
        onClick={saveNote}
        disabled={createNote.isPending || !note.trim()}
        className="mt-2 rounded-md bg-muted px-3 py-1.5 font-mono text-[11px] text-foreground/80 transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save Note
      </button>
      <div className="mt-6 space-y-3">
        {detail.notes.length === 0 ? (
          <EmptyState text="No internal notes yet." />
        ) : (
          detail.notes.map((item) => (
            <div key={item.id} className="rounded-md border border-border/50 bg-surface-2 px-4 py-3">
              <div className="whitespace-pre-wrap text-[12px] text-foreground/80">{item.body}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                {item.author?.full_name ?? item.author?.email ?? "Superadmin"} / {formatRelative(item.created_at)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-xs text-muted-foreground">{text}</div>;
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
