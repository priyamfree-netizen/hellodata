import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Star, Download, Eye, Check, X, Search } from "lucide-react";
import { AutoStatusBadge } from "@/components/admin/status-badge";
import { adaptTemplate } from "@/lib/admin-data";
import { useTemplates, useDocumentCategories, useApproveTemplate, useRejectTemplate } from "@/lib/queries";

export const Route = createFileRoute("/admin/templates")({
  component: TemplateMarketplace,
});

const CATEGORIES = ["All", "GST", "Payroll", "Invoice", "Logistics", "Retail", "CA Firms", "Manufacturing", "Healthcare", "Banking"];

function TemplateMarketplace() {
  const { data: dbTemplates = [] } = useTemplates();
  const { data: cats = [] } = useDocumentCategories();
  const approveTemplate = useApproveTemplate();
  const rejectTemplate = useRejectTemplate();
  const catMap = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);
  const templates = useMemo(
    () => dbTemplates.map((t) => adaptTemplate(t, { categoryName: t.category_id ? catMap.get(t.category_id) : undefined })),
    [dbTemplates, catMap],
  );
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    let t = templates;
    if (category !== "All") t = t.filter(tp => tp.category === category);
    if (statusFilter !== "all") t = t.filter(tp => tp.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      t = t.filter(tp => tp.name.toLowerCase().includes(q) || tp.author.toLowerCase().includes(q));
    }
    return t;
  }, [templates, category, search, statusFilter]);

  const reviewQueue = templates.filter(t => t.status === "review");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Template Marketplace</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">{templates.length} templates · Marketplace moderation & management</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 font-mono text-[10px] text-amber-400">
            {reviewQueue.length} pending review
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground/80" />
          <input type="text" placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} className="bg-transparent font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 outline-none w-48" />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)} className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors ${category === c ? "bg-blue-600/10 text-blue-400 border border-blue-600/20" : "text-muted-foreground/80 hover:text-foreground/80"}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {["all", "published", "review", "draft", "rejected"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${statusFilter === s ? "bg-muted text-foreground" : "text-muted-foreground/80 hover:text-foreground/80"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Template Table */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                {["Template", "Category", "Author", "Status", "Rating", "Downloads", "Fields", "Version", "Updated"].map(h => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{h}</th>
                ))}
                <th className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-[13px] text-foreground/90">{t.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground/60">{t.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border/80 bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground/80">
                      {t.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.author}</td>
                  <td className="px-4 py-3"><AutoStatusBadge status={t.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Star className="h-3 w-3 text-amber-400" />
                      <span className="font-mono text-[11px] text-foreground/80">{t.rating}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{t.downloads.toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{t.fields}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground/80">v{t.version}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/80">
                    {new Date(t.lastUpdated).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {t.status === "review" && (
                        <>
                          <button
                            onClick={() => approveTemplate.mutate(t.id)}
                            disabled={approveTemplate.isPending}
                            className="flex h-6 w-6 items-center justify-center rounded border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => rejectTemplate.mutate({ templateId: t.id })}
                            disabled={rejectTemplate.isPending}
                            className="flex h-6 w-6 items-center justify-center rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                      <button className="flex h-6 w-6 items-center justify-center rounded border border-border/80 text-muted-foreground/80 hover:text-foreground/80 hover:bg-muted">
                        <Eye className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
