import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guards";
import { useMemo, useState } from "react";
import {
  Search,
  Star,
  Plus,
  ArrowUpRight,
  Loader2,
  Receipt,
  FileText,
  ScrollText,
  FileCheck2,
  Landmark,
  Wallet,
  FileSpreadsheet,
  ClipboardList,
  Banknote,
  FileSignature,
  ReceiptText,
  Sparkles,
  Copy,
  CheckCircle2,
  ChevronRight,
  X,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NoSectionAccess, ReadOnlyBanner } from "@/components/section-gate";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import {
  useTemplates,
  useDocumentCategories,
  useTemplate,
  useCreateTemplate,
  useCloneTemplateForUser,
} from "@/lib/queries";
import type { Template } from "@/lib/supabase/types";

export const Route = createFileRoute("/templates")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Templates — HelloData" }] }),
  component: Templates,
});

const iconMap: Record<string, typeof FileText> = {
  Receipt,
  FileText,
  ScrollText,
  FileCheck2,
  Landmark,
  Wallet,
  FileSpreadsheet,
  ClipboardList,
  Banknote,
  FileSignature,
  ReceiptText,
};

// ── Main component ────────────────────────────────────────────────────────────

function Templates() {
  const navigate = useNavigate();
  const { currentOrg, user } = useAuth();
  const sectionLevel = useSectionAccess("templates");
  const canEdit = sectionLevel === "edit";
  const { data: templates = [], isLoading } = useTemplates({
    orgId: currentOrg?.id ?? null,
    authorId: user?.id ?? null,
  });
  const { data: categories = [] } = useDocumentCategories();
  const createTemplate = useCreateTemplate();

  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "prebuilt" | "mine">("all");
  const [selectedTpl, setSelectedTpl] = useState<Template | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Split into prebuilt masters and editable user/org templates.
  const prebuilt = useMemo(
    () => templates.filter((t) => t.scope === "public" && t.organization_id === null),
    [templates],
  );
  const mine = useMemo(
    () => templates.filter((t) => !(t.scope === "public" && t.organization_id === null)),
    [templates],
  );

  const filterFn = (list: Template[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => {
      const cat = t.category_id ? categoryMap.get(t.category_id) : null;
      return [t.name, t.description ?? "", cat?.name ?? "", cat?.industry ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  };

  const displayList =
    activeTab === "prebuilt"
      ? filterFn(prebuilt)
      : activeTab === "mine"
        ? filterFn(mine)
        : filterFn(templates);

  async function handleCreate() {
    if (!newName.trim() || !currentOrg?.id || !user?.id) return;
    const t = await createTemplate.mutateAsync({
      name: newName.trim(),
      organization_id: currentOrg.id,
      author_id: user.id,
    });
    setShowNewDialog(false);
    setNewName("");
    void navigate({ to: "/configure" });
    // Select the new template on configure page via URL param in a future iteration
    // For now just navigate — the configure page auto-selects the first template
    void t;
  }

  if (sectionLevel === "none") {
    return (
      <AppShell title="Templates">
        <NoSectionAccess section="templates" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Templates">
      <div className="flex h-[calc(100vh-4rem)]">
        {/* ── Left panel ──────────────────────────────────────────────── */}
        <div
          className={`flex min-h-0 flex-col overflow-hidden transition-all ${selectedTpl ? "w-[55%] border-r border-border" : "w-full"}`}
        >
          <div className="flex-1 overflow-auto">
            <div className="space-y-6 p-6">
              {sectionLevel === "view" && <ReadOnlyBanner section="templates" />}
              {/* Header */}
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Templates</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Prebuilt templates for every document type, plus your custom ones.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm md:w-64">
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search templates…"
                      className="w-full bg-transparent placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setShowNewDialog(true)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background hover:opacity-90"
                    >
                      <Plus className="h-3.5 w-3.5" /> New template
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-border">
                {(["all", "prebuilt", "mine"] as const).map((tab) => {
                  const label =
                    tab === "all"
                      ? `All (${templates.length})`
                      : tab === "prebuilt"
                        ? `Prebuilt (${prebuilt.length})`
                        : `My templates (${mine.length})`;
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`relative px-4 py-2 text-sm transition-colors ${
                        activeTab === tab
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                      {activeTab === tab && (
                        <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Grid */}
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : displayList.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center">
                  {activeTab === "mine" ? (
                    <>
                      <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                      <p className="text-sm font-medium">No custom templates yet</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Create a template to define your own extraction fields.
                      </p>
                      <button
                        onClick={() => setShowNewDialog(true)}
                        className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
                      >
                        <Plus className="h-3 w-3" /> Create template
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No templates match your search.</p>
                  )}
                </div>
              ) : (
                <div
                  className={`grid gap-3 ${selectedTpl ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"}`}
                >
                  {/* Prebuilt section header when viewing "all" */}
                  {activeTab === "all" && filterFn(prebuilt).length > 0 && (
                    <>
                      <div className="col-span-full">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Prebuilt · {filterFn(prebuilt).length} templates
                        </div>
                      </div>
                      {filterFn(prebuilt).map((t) => (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          category={categoryMap.get(t.category_id ?? "")?.name}
                          categoryIcon={categoryMap.get(t.category_id ?? "")?.icon}
                          isActive={selectedTpl?.id === t.id}
                          onClick={() => setSelectedTpl(selectedTpl?.id === t.id ? null : t)}
                        />
                      ))}
                    </>
                  )}

                  {/* My templates section header when viewing "all" */}
                  {activeTab === "all" && filterFn(mine).length > 0 && (
                    <>
                      <div className="col-span-full mt-2">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          My templates · {filterFn(mine).length}
                        </div>
                      </div>
                      {filterFn(mine).map((t) => (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          category={categoryMap.get(t.category_id ?? "")?.name}
                          categoryIcon={categoryMap.get(t.category_id ?? "")?.icon}
                          isActive={selectedTpl?.id === t.id}
                          onClick={() => setSelectedTpl(selectedTpl?.id === t.id ? null : t)}
                        />
                      ))}
                    </>
                  )}

                  {/* Single tab views */}
                  {activeTab !== "all" &&
                    displayList.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        category={categoryMap.get(t.category_id ?? "")?.name}
                        categoryIcon={categoryMap.get(t.category_id ?? "")?.icon}
                        isActive={selectedTpl?.id === t.id}
                        onClick={() => setSelectedTpl(selectedTpl?.id === t.id ? null : t)}
                      />
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: template detail panel ────────────────────────────── */}
        {selectedTpl && (
          <TemplateDetail
            template={selectedTpl}
            categoryName={categoryMap.get(selectedTpl.category_id ?? "")?.name}
            categoryIcon={categoryMap.get(selectedTpl.category_id ?? "")?.icon}
            onClose={() => setSelectedTpl(null)}
          />
        )}
      </div>

      {/* New template dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-medium">New template</h3>
              <button
                onClick={() => {
                  setShowNewDialog(false);
                  setNewName("");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Name your template. It will be pre-seeded with standard invoice fields you can
              customise.
            </p>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              placeholder="e.g. Tax Invoice, Bank Statement…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-lime"
            />
            {createTemplate.error && (
              <p className="mt-2 text-xs text-red-500">
                {createTemplate.error instanceof Error
                  ? createTemplate.error.message
                  : "Failed to create"}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewDialog(false);
                  setNewName("");
                }}
                className="h-9 rounded-lg border border-border px-4 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || createTemplate.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {createTemplate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create & configure
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  category,
  categoryIcon,
  isActive,
  onClick,
}: {
  template: Template;
  category?: string;
  categoryIcon?: string | null;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = iconMap[categoryIcon ?? "FileText"] ?? FileText;
  const isPrebuilt = template.scope === "public" && template.organization_id === null;
  const isPrivate = template.scope === "user";

  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full flex-col overflow-hidden rounded-2xl border p-5 text-left transition-colors ${
        isActive
          ? "border-brand-lime/40 bg-brand-lime/5"
          : "border-border bg-surface hover:bg-surface-2"
      }`}
    >
      {template.is_featured && <span className="absolute inset-x-0 top-0 h-[2px] bg-brand-lime" />}
      <div className="flex items-start justify-between">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
          {isPrebuilt ? (
            <Icon className="h-4 w-4 text-muted-foreground" />
          ) : isPrivate ? (
            <UserRound className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Star
              className={`h-4 w-4 ${template.is_featured ? "fill-brand-lime/30 text-brand-lime" : "text-muted-foreground"}`}
            />
          )}
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
            isPrebuilt
              ? "border-brand-blue/30 bg-brand-blue/10 text-brand-blue"
              : isPrivate
                ? "border-brand-lime/30 bg-brand-lime/10 text-brand-lime"
                : template.scope === "org"
                  ? "border-border bg-surface-2 text-muted-foreground"
                  : "border-brand-lime/30 bg-brand-lime/10 text-brand-lime"
          }`}
        >
          {isPrebuilt
            ? "Prebuilt"
            : isPrivate
              ? "Private"
              : template.scope === "org"
                ? "Org"
                : "Team"}
        </span>
      </div>
      <div className="mt-4 text-base font-medium tracking-tight">{template.name}</div>
      {category && <div className="mt-0.5 text-xs text-muted-foreground">{category}</div>}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{template.field_count} fields</span>
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${isActive ? "rotate-90 text-brand-lime" : "group-hover:translate-x-0.5"}`}
        />
      </div>
    </button>
  );
}

// ── Template detail panel ─────────────────────────────────────────────────────

function TemplateDetail({
  template,
  categoryName,
  categoryIcon,
  onClose,
}: {
  template: Template;
  categoryName?: string;
  categoryIcon?: string | null;
  onClose: () => void;
}) {
  const { data: tplData, isLoading } = useTemplate(template.id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const canEdit = useSectionAccess("templates") === "edit";
  const cloneTemplate = useCloneTemplateForUser();
  const Icon = iconMap[categoryIcon ?? "FileText"] ?? FileText;
  const isPrebuilt = template.scope === "public" && template.organization_id === null;
  const isPrivate = template.scope === "user";

  const fields = useMemo(() => tplData?.fields ?? [], [tplData?.fields]);
  const groups = useMemo(() => Array.from(new Set(fields.map((f) => f.field_group))), [fields]);
  const activeCount = fields.filter((f) => f.is_enabled).length;

  async function handleCustomize() {
    if (!user?.id) return;
    const editable = isPrebuilt
      ? await cloneTemplate.mutateAsync({ templateId: template.id, authorId: user.id })
      : template;
    void navigate({ to: "/configure", search: { templateId: editable.id } });
  }

  return (
    <div className="flex w-[45%] min-h-0 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface">
            {isPrebuilt ? (
              <Icon className="h-4 w-4 text-muted-foreground" />
            ) : isPrivate ? (
              <UserRound className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Star className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{template.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                v{template.version}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">{categoryName ?? "Custom"}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Stats */}
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs">
              <div className="flex-1 text-center">
                <div className="text-lg font-semibold">{fields.length}</div>
                <div className="text-muted-foreground">total fields</div>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex-1 text-center">
                <div className="text-lg font-semibold text-brand-lime">{activeCount}</div>
                <div className="text-muted-foreground">active</div>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex-1 text-center">
                <div className="text-lg font-semibold">{fields.length - activeCount}</div>
                <div className="text-muted-foreground">inactive</div>
              </div>
            </div>

            {/* All fields grouped */}
            {groups.map((group) => (
              <div key={group}>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {fields
                    .filter((f) => f.field_group === group)
                    .map((f, i, arr) => (
                      <div
                        key={f.id}
                        className={`flex items-center gap-3 px-4 py-2.5 ${
                          i < arr.length - 1 ? "border-b border-border" : ""
                        } ${!f.is_enabled ? "opacity-45" : ""}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{f.label}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{f.key}</div>
                        </div>
                        <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {f.data_type}
                        </span>
                        {f.is_enabled ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-lime" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border bg-surface-2" />
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}

            {fields.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No fields defined yet.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2">
          {isPrebuilt ? (
            <button
              type="button"
              onClick={() => void handleCustomize()}
              disabled={cloneTemplate.isPending || !canEdit}
              title={canEdit ? undefined : "View only — ask an owner or admin for edit access"}
              className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-sm hover:bg-surface-2 disabled:opacity-60"
            >
              {cloneTemplate.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Customize
            </button>
          ) : (
            canEdit && (
              <Link
                to="/configure"
                search={{ templateId: template.id }}
                className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-sm hover:bg-surface-2"
              >
                <ArrowUpRight className="h-3.5 w-3.5" /> Edit in Configure
              </Link>
            )
          )}
          <Link
            to="/upload"
            className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" /> Use this template
          </Link>
        </div>
        {isPrebuilt && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Customizing creates a private copy only you can edit.
          </p>
        )}
      </div>
    </div>
  );
}
