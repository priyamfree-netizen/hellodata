import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, ClipboardList } from "lucide-react";
import { useAuditLogs, useProfilesByIds } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({ meta: [{ title: "Audit Log — HelloData Admin" }] }),
  component: AuditLogPage,
});

// Actions are written as "<table>.<verb>" (e.g. "organizations.update"), plus a
// few custom verbs like "api_keys.revoked" — color by verb suffix, not table.
function actionColor(action: string): string {
  if (action.endsWith(".insert")) return "text-emerald-400 border-emerald-500/20 bg-emerald-500/10";
  if (action.endsWith(".delete")) return "text-red-400 border-red-500/20 bg-red-500/10";
  return "text-blue-400 border-blue-500/20 bg-blue-500/10";
}

function AuditLogPage() {
  const { data: logs = [], isLoading } = useAuditLogs({ limit: 200 });
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const actorIds = useMemo(
    () => [...new Set(logs.map((l) => l.actor_id).filter((v): v is string => !!v))],
    [logs],
  );
  const { data: actorNames } = useProfilesByIds(actorIds);

  const actions = useMemo(() => [...new Set(logs.map((l) => l.action))].sort(), [logs]);

  const filtered = logs.filter((log) => {
    if (actionFilter !== "all" && log.action !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        log.action.toLowerCase().includes(q) ||
        (log.target_label ?? "").toLowerCase().includes(q) ||
        (log.actor_label ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">
            {logs.length} entries · Full system change history
          </p>
        </div>
        <ClipboardList className="h-5 w-5 text-muted-foreground/60" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground/80" />
          <input
            type="text"
            placeholder="Search action, target, actor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 bg-transparent font-mono text-[12px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setActionFilter("all")}
            className={`rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${
              actionFilter === "all"
                ? "bg-blue-600/10 text-blue-400 border border-blue-600/20"
                : "text-muted-foreground/80 hover:text-foreground/80"
            }`}
          >
            all
          </button>
          {actions.map((a) => (
            <button
              key={a}
              onClick={() => setActionFilter(a)}
              className={`rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${
                actionFilter === a
                  ? "bg-blue-600/10 text-blue-400 border border-blue-600/20"
                  : "text-muted-foreground/80 hover:text-foreground/80"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                {["Action", "Table", "Target", "Actor", "Changed At"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center font-mono text-xs text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center font-mono text-xs text-muted-foreground"
                  >
                    No audit log entries found.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => {
                  const actorDisplay =
                    log.actor_label ||
                    (log.actor_id ? actorNames?.get(log.actor_id) : undefined) ||
                    "System";
                  return (
                    <tr key={log.id} className="hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${actionColor(log.action)}`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                        {log.target_type ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-foreground/90 max-w-xs truncate">
                        {log.target_label ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80 max-w-[160px] truncate">
                        {actorDisplay}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80">
                        {log.created_at ? formatRelativeTime(log.created_at) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
