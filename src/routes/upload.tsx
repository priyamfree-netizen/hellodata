import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guards";
import { useRef, useState } from "react";
import {
  Upload,
  FolderUp,
  FileText,
  X,
  Sparkles,
  CheckCircle2,
  Image,
  FileArchive,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NoSectionAccess, ReadOnlyBanner } from "@/components/section-gate";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import { useUploadDocument, useTemplates, useTemplate } from "@/lib/queries";
import { formatBytes } from "@/lib/format";
import { getAccessToken } from "@/lib/auth/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/upload")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Upload — HelloData" }] }),
  component: UploadPlayground,
});

type StagedFile = {
  file: File;
  path: string;
  status: "pending" | "uploading" | "extracting" | "done" | "error";
  docId?: string;
  extractionId?: string;
  error?: string;
};

const supportedFilePattern = /\.(pdf|jpe?g|png|tiff?|webp|zip)$/i;

function stagedFromFile(file: File): StagedFile | null {
  if (!supportedFilePattern.test(file.name)) return null;
  const withPath = file as File & { webkitRelativePath?: string };
  return {
    file,
    path: withPath.webkitRelativePath || file.name,
    status: "pending",
  };
}

function UploadPlayground() {
  const navigate = useNavigate();
  const { currentOrg, user } = useAuth();
  const sectionLevel = useSectionAccess("process");
  const canEdit = sectionLevel === "edit";
  const orgId = currentOrg?.id;
  const upload = useUploadDocument();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const { data: templates = [], isLoading: tplLoading } = useTemplates({
    orgId: currentOrg?.id ?? null,
    authorId: user?.id ?? null,
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Load the selected template's fields so we can show active-only count + preview
  const { data: selectedTplData, isLoading: tplFieldsLoading } = useTemplate(
    selectedTemplateId || null,
  );
  const activeFields = (selectedTplData?.fields ?? []).filter((f) => f.is_enabled);
  const allFields = selectedTplData?.fields ?? [];

  const [files, setFiles] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!canEdit) return;
    const dropped = Array.from(e.dataTransfer.files)
      .map(stagedFromFile)
      .filter((f): f is StagedFile => Boolean(f));
    setFiles((p) => [...p, ...dropped]);
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!canEdit) return;
    const picked = Array.from(e.target.files ?? [])
      .map(stagedFromFile)
      .filter((f): f is StagedFile => Boolean(f));
    setFiles((p) => [...p, ...picked]);
    e.target.value = "";
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }

  function fileIcon(type: string) {
    const t = type.toLowerCase();
    if (t.includes("pdf")) return FileText;
    if (t.includes("image")) return Image;
    if (t.includes("zip") || t.includes("rar")) return FileArchive;
    return FileText;
  }

  async function handleExtract() {
    if (!canEdit || !orgId) return;
    setProcessing(true);
    const token = getAccessToken();
    const updated = [...files];
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const sf = files[i];
      try {
        updated[i] = { ...sf, status: "uploading", error: undefined };
        setFiles([...updated]);

        const doc = await upload.mutateAsync({
          organization_id: orgId,
          file: sf.file,
          template_id: selectedTemplateId || null,
        });

        updated[i] = { ...sf, status: "extracting", docId: doc.id, error: undefined };
        setFiles([...updated]);

        const res = await fetch("/api/extract/document", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            document_id: doc.id,
            ...(selectedTemplateId ? { template_id: selectedTemplateId } : {}),
          }),
        });
        const data = (await res.json()) as { extraction_id?: string; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Extraction failed");

        successCount += 1;
        updated[i] = { ...sf, status: "done", docId: doc.id, extractionId: data.extraction_id };
      } catch (e) {
        updated[i] = {
          ...sf,
          status: "error",
          docId: updated[i]?.docId,
          error: (e as Error).message,
        };
      }
      setFiles([...updated]);
    }

    setProcessing(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["documents", orgId] }),
      qc.invalidateQueries({ queryKey: ["processing-jobs", orgId] }),
      qc.invalidateQueries({ queryKey: ["extractions", orgId] }),
    ]);
    navigate({ to: successCount > 0 ? "/output" : "/processing" });
  }

  const totalSize = files.reduce((s, f) => s + f.file.size, 0);

  if (sectionLevel === "none") {
    return (
      <AppShell title="Upload">
        <NoSectionAccess section="process" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Upload">
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <div className="flex-1 overflow-auto p-6 pb-32">
          {sectionLevel === "view" && <ReadOnlyBanner section="process" />}
          <div className="mx-auto max-w-2xl space-y-5">
            {/* ── Template selector ──────────────────────────────────────── */}
            <section>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Template
              </div>
              <div className="relative">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={tplLoading}
                  className="w-full appearance-none rounded-xl border border-border bg-surface px-4 py-3 pr-10 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-lime disabled:opacity-50"
                >
                  <option value="">No template — use default fields</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>

              {/* Active fields preview — shown when a template is selected */}
              {selectedTemplateId ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-xs font-medium text-foreground">Fields to extract</span>
                    {tplFieldsLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {activeFields.length} active · {allFields.length} total
                      </span>
                    )}
                  </div>
                  {tplFieldsLoading ? (
                    <div className="px-4 py-6 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : activeFields.length === 0 ? (
                    <p className="px-4 py-4 text-center text-xs text-muted-foreground">
                      No active fields — go to Configure to enable fields in this template.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 p-3">
                      {activeFields.map((f) => (
                        <span
                          key={f.id}
                          className="inline-flex items-center rounded-full border border-brand-lime/30 bg-brand-lime/10 px-2.5 py-0.5 font-mono text-[10px] text-brand-lime"
                        >
                          {f.label}
                        </span>
                      ))}
                      {allFields.filter((f) => !f.is_enabled).length > 0 && (
                        <span className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          +{allFields.filter((f) => !f.is_enabled).length} inactive
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Default fields will be used: invoice number, vendor, totals, dates, and more.
                </p>
              )}
            </section>

            {/* ── Drop zone ──────────────────────────────────────────────── */}
            <section>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Documents
              </div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`relative block overflow-hidden rounded-2xl border-2 border-dashed bg-background p-12 text-center transition-colors ${
                  dragging ? "border-brand-blue bg-brand-blue/[0.03]" : "border-border"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handlePick}
                  className="sr-only"
                  accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp,.zip"
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  onChange={handlePick}
                  className="sr-only"
                  accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp,.zip"
                  {...({
                    webkitdirectory: "",
                    directory: "",
                  } as React.InputHTMLAttributes<HTMLInputElement> & {
                    webkitdirectory: string;
                    directory: string;
                  })}
                />
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="mt-5 text-sm font-medium">
                  Drop files here, browse files, or upload a folder
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  PDF, JPG, PNG, TIFF or ZIP — up to 100 MB per file
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-xs font-medium text-background hover:opacity-90"
                  >
                    <FileText className="h-3.5 w-3.5" /> Browse files
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-xs hover:bg-surface-2"
                  >
                    <FolderUp className="h-3.5 w-3.5" /> Upload folder
                  </button>
                </div>
              </div>
            </section>

            {/* ── Staged file list ───────────────────────────────────────── */}
            {files.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
                    {formatBytes(totalSize)}
                  </div>
                  <button
                    onClick={() => setFiles([])}
                    className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear all
                  </button>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {files.map((f, i) => {
                    const Icon = fileIcon(f.file.type);
                    return (
                      <div
                        key={f.path + i}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 ${
                          i < files.length - 1 ? "border-b border-border" : ""
                        }`}
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-xs">{f.path}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {formatBytes(f.file.size)} · {f.file.type || "unknown"}
                          </div>
                        </div>
                        {(f.status === "uploading" || f.status === "extracting") && (
                          <div className="flex items-center gap-2 text-[10px] text-brand-blue">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {f.status === "extracting" ? "Extracting" : "Uploading"}
                          </div>
                        )}
                        {f.status === "done" && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-brand-lime" />
                        )}
                        {f.status === "error" && (
                          <span
                            className="max-w-[160px] truncate text-[10px] text-destructive"
                            title={f.error}
                          >
                            {f.error}
                          </span>
                        )}
                        <button
                          onClick={() => removeFile(f.path)}
                          disabled={processing}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* ── Bottom action bar ─────────────────────────────────────────── */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl md:left-64">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
            <div className="text-xs text-muted-foreground">
              <span className="font-mono">
                {files.length} {files.length === 1 ? "file" : "files"}
              </span>
              {files.length > 0 && <span className="ml-2 font-mono">{formatBytes(totalSize)}</span>}
              {selectedTemplateId && templates.find((t) => t.id === selectedTemplateId) && (
                <span className="ml-2 rounded-full border border-brand-lime/30 bg-brand-lime/10 px-2 py-0.5 font-mono text-[10px] text-brand-lime">
                  {templates.find((t) => t.id === selectedTemplateId)?.name}
                </span>
              )}
            </div>
            <button
              onClick={handleExtract}
              disabled={files.length === 0 || !orgId || processing || !canEdit}
              className={`inline-flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-medium transition-opacity ${
                files.length > 0 && orgId && !processing && canEdit
                  ? "bg-foreground text-background hover:opacity-90"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              }`}
            >
              {processing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Extract data
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
