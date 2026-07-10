import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guards";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  GripVertical,
  Save,
  Sparkles,
  FileText,
  Plus,
  Loader2,
  X,
  Check,
  Pencil,
  Trash2,
  Info,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NoSectionAccess, ReadOnlyBanner } from "@/components/section-gate";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import {
  useTemplates,
  useTemplate,
  useUpsertTemplateField,
  useUpdateTemplate,
  useDocuments,
  useDocumentPreviewBlob,
  useCreateTemplate,
  useCloneTemplateForUser,
  useDeleteTemplateField,
  getTemplateFieldByKey,
} from "@/lib/queries";
import type { TemplateField } from "@/lib/supabase/types";

type ConfigureSearch = {
  templateId?: string;
};

export const Route = createFileRoute("/configure")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): ConfigureSearch => ({
    templateId: typeof search.templateId === "string" ? search.templateId : undefined,
  }),
  head: () => ({ meta: [{ title: "Configure fields — HelloData" }] }),
  component: Configure,
});

// Shared fixed-size trigger for the template & document dropdowns.
const dropdownTriggerClass =
  "inline-flex w-48 items-center justify-between gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground hover:bg-surface-2";

function Configure() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { currentOrg, user } = useAuth();
  const sectionLevel = useSectionAccess("process");
  const canEdit = sectionLevel === "edit";
  const { data: templates = [], isLoading: tplLoading } = useTemplates({
    orgId: currentOrg?.id ?? null,
    authorId: user?.id ?? null,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [tplMenuOpen, setTplMenuOpen] = useState(false);
  const [docMenuOpen, setDocMenuOpen] = useState(false);

  // ── New template dialog ────────────────────────────────────────────────────
  const [showNewTpl, setShowNewTpl] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  const createTemplate = useCreateTemplate();
  const cloneTemplate = useCloneTemplateForUser();

  const handleCreateTemplate = async () => {
    if (!newTplName.trim() || !currentOrg?.id || !user?.id) return;
    const tpl = await createTemplate.mutateAsync({
      name: newTplName.trim(),
      organization_id: currentOrg.id,
      author_id: user.id,
    });
    setSelectedId(tpl.id);
    setShowNewTpl(false);
    setNewTplName("");
  };

  // ── Save template (update name) ────────────────────────────────────────────
  const updateTemplate = useUpdateTemplate();
  const [savedFlash, setSavedFlash] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const handleSaveTemplate = async () => {
    if (!canEdit) return;
    const editableId = await ensureEditableTemplate();
    if (!editableId) return;
    await updateTemplate.mutateAsync({
      id: editableId,
      name: templateName.trim() || tpl?.template?.name || "Untitled template",
      updated_at: new Date().toISOString(),
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  // ── Add custom field dialog ────────────────────────────────────────────────
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldGroup, setNewFieldGroup] = useState("Custom");
  const [newFieldType, setNewFieldType] = useState("string");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldEnabled, setNewFieldEnabled] = useState(true);
  const [newFieldConfidence, setNewFieldConfidence] = useState("0.80");
  const [editingField, setEditingField] = useState<TemplateField | null>(null);
  const upsertField = useUpsertTemplateField();
  const deleteField = useDeleteTemplateField();

  useEffect(() => {
    if (search.templateId && search.templateId !== selectedId) {
      setSelectedId(search.templateId);
    }
  }, [search.templateId, selectedId]);

  useEffect(() => {
    if (!selectedId && templates.length > 0) {
      const firstEditable = templates.find(
        (t) => !(t.scope === "public" && t.organization_id === null),
      );
      setSelectedId(search.templateId ?? firstEditable?.id ?? templates[0].id);
    }
  }, [templates, selectedId, search.templateId]);

  const { data: tpl, isLoading: tplOneLoading } = useTemplate(selectedId);
  const { data: docs = [] } = useDocuments(currentOrg?.id, 10);
  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? docs[0] ?? null;
  const {
    data: previewBlob,
    isLoading: previewLoading,
    error: previewError,
  } = useDocumentPreviewBlob(selectedDoc?.id);

  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(100);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const selectedTemplate = tpl?.template ?? templates.find((t) => t.id === selectedId) ?? null;
  const isSelectedPrebuilt =
    selectedTemplate?.scope === "public" && selectedTemplate.organization_id === null;

  useEffect(() => {
    setTemplateName(tpl?.template?.name ?? "");
  }, [tpl?.template?.id, tpl?.template?.name]);

  function selectTemplate(templateId: string | null) {
    setSelectedId(templateId);
    void navigate({
      to: "/configure",
      search: templateId ? { templateId } : {},
      replace: true,
    });
  }

  async function ensureEditableTemplate(): Promise<string | null> {
    if (!selectedId) return null;
    if (!isSelectedPrebuilt) return selectedId;
    if (!user?.id) return null;

    const editable = await cloneTemplate.mutateAsync({ templateId: selectedId, authorId: user.id });
    selectTemplate(editable.id);
    return editable.id;
  }

  async function resolveEditableField(field: TemplateField): Promise<TemplateField | null> {
    const editableTemplateId = await ensureEditableTemplate();
    if (!editableTemplateId) return null;
    if (editableTemplateId === field.template_id) return field;
    const copiedField = await getTemplateFieldByKey(editableTemplateId, field.key);
    if (!copiedField) throw new Error("Copied field not found");
    return copiedField;
  }

  function sanitizeFieldKey(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }

  function resetFieldDraft() {
    setNewFieldKey("");
    setNewFieldLabel("");
    setNewFieldGroup("Custom");
    setNewFieldType("string");
    setNewFieldRequired(false);
    setNewFieldEnabled(true);
    setNewFieldConfidence("0.80");
    setEditingField(null);
  }

  function closeFieldDialog() {
    setShowAddField(false);
    resetFieldDraft();
  }

  function openAddFieldDialog() {
    resetFieldDraft();
    setShowAddField(true);
  }

  function openEditFieldDialog(field: TemplateField) {
    setEditingField(field);
    setNewFieldKey(field.key);
    setNewFieldLabel(field.label);
    setNewFieldGroup(field.field_group);
    setNewFieldType(field.data_type);
    setNewFieldRequired(field.is_required);
    setNewFieldEnabled(field.is_enabled);
    setNewFieldConfidence(String(Number(field.default_confidence)));
    setShowAddField(true);
  }

  async function handleSaveField() {
    if (!canEdit) return;
    const editableTemplateId = await ensureEditableTemplate();
    if (!newFieldKey.trim() || !newFieldLabel.trim() || !editableTemplateId) return;
    const editableField = editingField ? await resolveEditableField(editingField) : null;
    const existingFields = tpl?.fields ?? [];

    await upsertField.mutateAsync({
      ...(editableField ? { id: editableField.id } : {}),
      template_id: editableTemplateId,
      key: sanitizeFieldKey(newFieldKey),
      label: newFieldLabel.trim(),
      field_group: newFieldGroup.trim() || "Custom",
      data_type: newFieldType,
      is_enabled: newFieldEnabled,
      is_required: newFieldRequired,
      default_confidence: Math.min(1, Math.max(0, Number(newFieldConfidence) || 0)),
      sort_order: editableField?.sort_order ?? existingFields.length + 1,
      config: editableField?.config ?? {},
    });
    closeFieldDialog();
  }

  async function handleToggleField(field: TemplateField) {
    if (!canEdit) return;
    const editableField = await resolveEditableField(field);
    if (!editableField) return;
    await upsertField.mutateAsync({
      id: editableField.id,
      template_id: editableField.template_id,
      is_enabled: !editableField.is_enabled,
    });
  }

  async function handleDeleteField(field: TemplateField) {
    if (!canEdit) return;
    if (!window.confirm(`Delete "${field.label}" from this template?`)) return;
    const editableField = await resolveEditableField(field);
    if (!editableField) return;
    await deleteField.mutateAsync({ id: editableField.id, template_id: editableField.template_id });
  }

  useEffect(() => {
    if (!previewBlob) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewBlob]);

  const fields = useMemo(() => tpl?.fields ?? [], [tpl?.fields]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter((f) => {
      const config =
        f.config && typeof f.config === "object" && !Array.isArray(f.config)
          ? (f.config as Record<string, unknown>)
          : {};
      return [
        f.label,
        f.key,
        f.field_group,
        f.data_type,
        typeof config.description === "string" ? config.description : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [fields, query]);
  const groups = useMemo(() => Array.from(new Set(filtered.map((f) => f.field_group))), [filtered]);
  const activeCount = fields.filter((f) => f.is_enabled).length;

  const loading = tplLoading || tplOneLoading;

  if (sectionLevel === "none") {
    return (
      <AppShell title="Configure extraction">
        <NoSectionAccess section="process" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Configure extraction">
      {sectionLevel === "view" && (
        <div className="p-4 pb-0">
          <ReadOnlyBanner section="process" />
        </div>
      )}
      <div className="grid h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Popover open={tplMenuOpen} onOpenChange={setTplMenuOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className={dropdownTriggerClass}>
                    <span className="truncate">{selectedTemplate?.name ?? "Select template"}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-1">
                  {/* ~10 rows visible; the rest scroll */}
                  <div className="max-h-[280px] overflow-y-auto">
                    {templates.length === 0 ? (
                      <div className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                        No templates yet
                      </div>
                    ) : (
                      templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            selectTemplate(t.id);
                            setTplMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] hover:bg-surface-2 ${
                            t.id === selectedId
                              ? "bg-surface-2 text-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="truncate">{t.name}</span>
                          {t.id === selectedId && (
                            <Check className="h-3 w-3 shrink-0 text-brand-lime" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="mt-1 border-t border-border pt-1">
                    <button
                      onClick={() => {
                        setTplMenuOpen(false);
                        setShowNewTpl(true);
                      }}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-foreground hover:bg-surface-2"
                    >
                      <Plus className="h-3 w-3" /> New template
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
              {tpl?.template && (
                <span className="rounded-full border border-brand-lime/30 bg-brand-lime/10 px-2 py-0.5 font-mono text-[10px] text-brand-lime">
                  v{tpl.template.version}
                </span>
              )}
              {docs.length > 0 && (
                <>
                  <span className="text-muted-foreground/40">|</span>
                  <Popover open={docMenuOpen} onOpenChange={setDocMenuOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className={dropdownTriggerClass}>
                        <span className="truncate">
                          {docs.find((d) => d.id === selectedDocId)?.file_name ?? "Sample document"}
                        </span>
                        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-1">
                      <div className="max-h-[280px] overflow-y-auto">
                        <button
                          onClick={() => {
                            setSelectedDocId(null);
                            setDocMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] hover:bg-surface-2 ${
                            selectedDocId === null
                              ? "bg-surface-2 text-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="truncate">Sample document</span>
                          {selectedDocId === null && (
                            <Check className="h-3 w-3 shrink-0 text-brand-lime" />
                          )}
                        </button>
                        {docs.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => {
                              setSelectedDocId(d.id);
                              setDocMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] hover:bg-surface-2 ${
                              d.id === selectedDocId
                                ? "bg-surface-2 text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            <span className="truncate">{d.file_name}</span>
                            {d.id === selectedDocId && (
                              <Check className="h-3 w-3 shrink-0 text-brand-lime" />
                            )}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconBtn onClick={() => setZoom((z) => Math.max(60, z - 10))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </IconBtn>
              <span className="px-2 font-mono text-[10px] text-muted-foreground">{zoom}%</span>
              <IconBtn onClick={() => setZoom((z) => Math.min(160, z + 10))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-8">
            <div
              className="mx-auto rounded-lg border border-border bg-background shadow-sm transition-transform overflow-hidden"
              style={{
                width: 640,
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
              }}
            >
              {selectedDoc && previewLoading ? (
                <div className="flex h-[520px] items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : previewUrl ? (
                selectedDoc?.mime_type?.startsWith("image/") ? (
                  <img src={previewUrl} alt={selectedDoc.file_name} className="w-full h-auto" />
                ) : (
                  <object
                    data={previewUrl}
                    type={selectedDoc?.mime_type ?? "application/pdf"}
                    title={selectedDoc?.file_name ?? "Document preview"}
                    className="w-full"
                    style={{ height: 800 }}
                  >
                    <div className="flex h-[520px] flex-col items-center justify-center gap-2 p-8 text-center">
                      <FileText className="h-8 w-8 text-muted-foreground" />
                      <div className="text-sm font-medium text-foreground">
                        Preview not supported
                      </div>
                      <div className="max-w-sm text-xs text-muted-foreground">
                        Your browser cannot display this file type inline.
                      </div>
                    </div>
                  </object>
                )
              ) : selectedDoc && previewError ? (
                <div className="flex h-[520px] flex-col items-center justify-center gap-2 p-8 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm font-medium text-foreground">Preview unavailable</div>
                  <div className="max-w-sm text-xs text-muted-foreground">
                    The document exists, but HelloData could not create a temporary preview URL.
                  </div>
                </div>
              ) : (
                <DocumentMock />
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="border-b border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name"
                  disabled={!selectedId}
                  className="min-w-0 flex-1 bg-transparent text-base font-medium tracking-tight text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="About this template"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-72 space-y-2 text-xs text-muted-foreground"
                  >
                    {isSelectedPrebuilt && (
                      <p>Editing will create a private copy for your account.</p>
                    )}
                    <p>Toggle fields to include in extractions. AI confidence shown per field.</p>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold tabular-nums text-foreground">
                  {activeCount} / {fields.length} active
                </span>
                <button
                  onClick={openAddFieldDialog}
                  disabled={!selectedId || !canEdit}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> Add custom field
                </button>
              </div>
            </div>
            <div className="mt-4 flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fields…"
                className="w-full bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto px-5 pb-32 pt-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center">
                <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No templates yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create a template to define which fields to extract from your documents.
                </p>
                <button
                  onClick={() => setShowNewTpl(true)}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
                >
                  <Plus className="h-3 w-3" /> Create a template
                </button>
              </div>
            ) : fields.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center text-sm text-muted-foreground">
                No fields in this template yet.
              </div>
            ) : (
              groups.map((g) => (
                <div key={g} className="mb-6">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {g}
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border bg-surface">
                    {filtered
                      .filter((f) => f.field_group === g)
                      .map((f, i, arr) => (
                        <FieldRow
                          key={f.id}
                          keyName={f.key}
                          label={f.label}
                          confidence={Number(f.default_confidence)}
                          enabled={f.is_enabled}
                          isLast={i === arr.length - 1}
                          onToggle={() => void handleToggleField(f)}
                          onEdit={() => openEditFieldDialog(f)}
                          onDelete={() => void handleDeleteField(f)}
                        />
                      ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border bg-background p-5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleSaveTemplate()}
                disabled={
                  !selectedId || updateTemplate.isPending || cloneTemplate.isPending || !canEdit
                }
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                {updateTemplate.isPending || cloneTemplate.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : savedFlash ? (
                  <Check className="h-3.5 w-3.5 text-brand-lime" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {savedFlash ? "Saved" : "Save template"}
              </button>
              <Link
                to="/processing"
                className="ml-auto inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-foreground px-5 text-sm font-medium text-background hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" /> Start processing
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* New template modal */}
      {showNewTpl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-medium">New template</h3>
              <button
                onClick={() => {
                  setShowNewTpl(false);
                  setNewTplName("");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Give your template a name. It will be pre-loaded with standard invoice fields you can
              toggle on/off.
            </p>
            <input
              autoFocus
              value={newTplName}
              onChange={(e) => setNewTplName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateTemplate();
              }}
              placeholder="e.g. Tax Invoice, Bank Statement…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-lime"
            />
            {createTemplate.error && (
              <p className="mt-2 text-xs text-red-500">
                {createTemplate.error instanceof Error
                  ? createTemplate.error.message
                  : "Failed to create template"}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewTpl(false);
                  setNewTplName("");
                }}
                className="h-9 rounded-lg border border-border px-4 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateTemplate()}
                disabled={!newTplName.trim() || createTemplate.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {createTemplate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Add custom field modal */}
      {showAddField && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-medium">
                {editingField ? "Edit field" : "Add custom field"}
              </h3>
              <button
                onClick={closeFieldDialog}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Field label</label>
                <input
                  autoFocus
                  value={newFieldLabel}
                  onChange={(e) => {
                    setNewFieldLabel(e.target.value);
                    if (!newFieldKey) {
                      setNewFieldKey(sanitizeFieldKey(e.target.value));
                    }
                  }}
                  placeholder="e.g. Payment Terms"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-lime"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Field key <span className="text-muted-foreground/60">(used in exports)</span>
                </label>
                <input
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(sanitizeFieldKey(e.target.value))}
                  placeholder="e.g. payment_terms"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-lime"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Group</label>
                <input
                  value={newFieldGroup}
                  onChange={(e) => setNewFieldGroup(e.target.value)}
                  placeholder="e.g. Header, Amounts, Custom"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-lime"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Data type</label>
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="boolean">Boolean</option>
                    <option value="currency">Currency</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Confidence</label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={newFieldConfidence}
                    onChange={(e) => setNewFieldConfidence(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  />
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={newFieldEnabled}
                    onChange={(e) => setNewFieldEnabled(e.target.checked)}
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={newFieldRequired}
                    onChange={(e) => setNewFieldRequired(e.target.checked)}
                  />
                  Required
                </label>
              </div>
            </div>
            {upsertField.error && (
              <p className="mt-2 text-xs text-red-500">
                {upsertField.error instanceof Error
                  ? upsertField.error.message
                  : "Failed to save field"}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={closeFieldDialog}
                className="h-9 rounded-lg border border-border px-4 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSaveField()}
                disabled={
                  !newFieldKey.trim() ||
                  !newFieldLabel.trim() ||
                  upsertField.isPending ||
                  cloneTemplate.isPending
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {(upsertField.isPending || cloneTemplate.isPending) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {editingField ? "Save field" : "Add field"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function IconBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}

function FieldRow({
  keyName,
  label,
  confidence,
  enabled,
  isLast,
  onToggle,
  onEdit,
  onDelete,
}: {
  keyName: string;
  label: string;
  confidence: number;
  enabled: boolean;
  isLast: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const conf = Math.round(confidence * 100);
  const confColor =
    conf >= 95
      ? "text-brand-lime border-brand-lime/30 bg-brand-lime/10"
      : conf >= 90
        ? "text-brand-blue border-brand-blue/30 bg-brand-blue/10"
        : "text-muted-foreground border-border bg-surface-2";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${isLast ? "" : "border-b border-border"}`}>
      <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{keyName}</div>
      </div>
      <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${confColor}`}>
        {conf}%
      </span>
      <button
        onClick={onEdit}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
        title="Edit field"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-red-500"
        title="Delete field"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onToggle}
        className={`relative h-5 w-9 rounded-full border transition-colors ${
          enabled ? "border-brand-lime/40 bg-brand-lime/20" : "border-border bg-background"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
            enabled ? "left-[18px] bg-brand-lime" : "left-0.5 bg-muted-foreground"
          }`}
        />
      </button>
    </div>
  );
}

function DocumentMock() {
  return (
    <div className="space-y-6 p-10 font-mono text-[11px] text-foreground/80">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold text-foreground">SAMPLE VENDOR</div>
          <div className="text-muted-foreground">Sample address</div>
          <div className="text-muted-foreground">GSTIN —</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-foreground">TAX INVOICE</div>
          <div className="mt-1">
            No. <span className="text-brand-blue">SAMPLE-001</span>
          </div>
          <div>Date: —</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 border-y border-border py-4">
        <div>
          <div className="text-muted-foreground">Bill to</div>
          <div className="mt-1 text-foreground">Sample Buyer</div>
        </div>
        <div>
          <div className="text-muted-foreground">PO ref</div>
          <div className="mt-1">—</div>
        </div>
      </div>
      <div className="ml-auto w-64 space-y-1.5">
        <Row l="Subtotal" v="—" />
        <Row l="Tax" v="—" />
        <div className="border-t border-border pt-2">
          <Row l="Total" v="—" bold />
        </div>
      </div>
    </div>
  );
}

function Row({ l, v, bold }: { l: string; v: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{l}</span>
      <span className={bold ? "text-foreground font-semibold" : "text-foreground"}>{v}</span>
    </div>
  );
}
