import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Building2, Users, Globe, ShieldCheck, Settings, ChevronRight } from "lucide-react";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import { DetailPanel, DetailRow } from "@/components/admin/detail-panel";
import { LazyMiniChart as MiniChart } from "@/components/admin/lazy-mini-chart";
import { adaptOrganization, type Organization, generateSparkline } from "@/lib/admin-data";
import { useOrganizations, usePlans } from "@/lib/queries";

export const Route = createFileRoute("/admin/organizations")({
  component: OrganizationManagement,
});

function OrganizationManagement() {
  const { data: dbOrgs = [] } = useOrganizations({ limit: 100 });
  const { data: plans = [] } = usePlans();
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const orgs = useMemo<Organization[]>(
    () => dbOrgs.map((o) => adaptOrganization(o, { plan: o.plan_id ? planMap.get(o.plan_id) ?? null : null })),
    [dbOrgs, planMap],
  );
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [view, setView] = useState<"grid" | "table">("table");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">{orgs.length} organizations Â· Enterprise workspace management</p>
        </div>
        <div className="flex items-center gap-2">
          {(["table", "grid"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${view === v ? "bg-muted text-foreground border border-border/80" : "text-muted-foreground/80 hover:text-foreground/80"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Organizations", value: "3,412", icon: Building2 },
          { label: "Enterprise Accounts", value: "147", icon: ShieldCheck },
          { label: "SSO Enabled", value: "89", icon: Globe },
          { label: "Total Members", value: "24,831", icon: Users },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <s.icon className="h-4 w-4 text-muted-foreground/80" />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">{s.label}</div>
              <div className="font-mono text-lg font-semibold text-foreground">{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table View */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-surface">
                {["Organization", "Plan", "Members", "Teams", "Status", "SSO", "Storage", "Pages", "Country", "Last Activity"].map(h => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {orgs.map(org => (
                <tr key={org.id} onClick={() => setSelectedOrg(org)} className="hover:bg-surface-2 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-foreground/80">
                        {org.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-foreground">{org.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground/60">{org.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${org.plan === "Enterprise" ? "border-blue-500/20 bg-blue-500/5 text-blue-400" : "border-zinc-600/20 text-muted-foreground"}`}>
                      {org.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-foreground/80">{org.members}</td>
                  <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">{org.teams}</td>
                  <td className="px-4 py-3"><AutoStatusBadge status={org.status} /></td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-[11px] ${org.ssoEnabled ? "text-emerald-400" : "text-muted-foreground/60"}`}>
                      {org.ssoEnabled ? "Enabled" : "â€”"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">{org.storageUsed}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-foreground/80">{org.pagesProcessed.toLocaleString()}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{org.country}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground/80">{new Date(org.lastActivity).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Panel */}
      <DetailPanel open={!!selectedOrg} onClose={() => setSelectedOrg(null)} title={selectedOrg?.name ?? ""} subtitle={selectedOrg?.id}>
        {selectedOrg && (
          <div>
            <div className="flex items-center gap-4 border-b border-border/50 px-6 py-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-lg font-semibold text-foreground/80">
                {selectedOrg.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
              </div>
              <div className="flex-1">
                <div className="text-base font-medium">{selectedOrg.name}</div>
                <div className="font-mono text-xs text-muted-foreground/80">{selectedOrg.plan} Â· {selectedOrg.country}</div>
              </div>
              <AutoStatusBadge status={selectedOrg.status} />
            </div>
            <div className="grid grid-cols-3 gap-px border-b border-border/50 bg-muted">
              {[
                { label: "Members", value: String(selectedOrg.members) },
                { label: "Teams", value: String(selectedOrg.teams) },
                { label: "Pages", value: selectedOrg.pagesProcessed.toLocaleString() },
              ].map(s => (
                <div key={s.label} className="bg-surface px-4 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">{s.label}</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-foreground">{s.value}</div>
                </div>
              ))}
            </div>
            <DetailRow label="Storage" value={`${selectedOrg.storageUsed} / ${selectedOrg.storageLimit}`} mono />
            <DetailRow label="SSO" value={selectedOrg.ssoEnabled ? "Enabled" : "Disabled"} />
            <DetailRow label="Created" value={new Date(selectedOrg.createdDate).toLocaleDateString()} mono />
            <DetailRow label="Departments" value={selectedOrg.departments.join(", ")} />
            <div className="border-t border-border/50 px-6 py-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-2">Processing Activity Â· 30d</div>
              <MiniChart data={generateSparkline(30, 0, 100)} color="#2563eb" height={48} />
            </div>
            <div className="border-t border-border/50 px-6 py-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-3">Team Hierarchy</div>
              {selectedOrg.departments.map(dept => (
                <div key={dept} className="flex items-center justify-between rounded-md border border-border/50 bg-surface-2 px-3 py-2 mb-1.5">
                  <span className="text-[12px] text-foreground/80">{dept}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/80">{Math.ceil(selectedOrg.members / selectedOrg.departments.length)} members</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DetailPanel>
    </div>
  );
}
