import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guards";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Download,
  Search,
  ChevronDown,
  MoreHorizontal,
  Loader2,
  FileText,
  Table2,
  Trash2,
  GripVertical,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NoSectionAccess, ReadOnlyBanner } from "@/components/section-gate";
import { useAuth } from "@/lib/auth/context";
import { useSectionAccess } from "@/lib/use-section-access";
import {
  useDeleteExtractions,
  useExtractions,
  useTemplates,
  useTemplate,
  useUpdateExtractionData,
} from "@/lib/queries";
import { formatDateShort } from "@/lib/format";
import type { Json } from "@/lib/supabase/types";

export const Route = createFileRoute("/output")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Data Entries — HelloData" }] }),
  component: Output,
});

// ── helpers ──────────────────────────────────────────────────────────────────

function pickString(d: Json | null | undefined, key: string): string {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "";
  const v = (d as Record<string, Json>)[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v == null) return "";
  return JSON.stringify(v);
}

function rowsToCsv(headers: string[], data: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers, ...data].map((row) => row.map(escape).join(",")).join("\r\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const META_COLUMN_WIDTHS = {
  document: 200,
  extracted: 128,
  confidence: 96,
};

const MIN_COLUMN_WIDTH = 28;
const MAX_COLUMN_WIDTH = 520;

function defaultFieldWidth(label: string) {
  return Math.max(140, Math.min(280, label.length * 10 + 72));
}

function clampColumnWidth(width: number) {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width));
}

function coerceCellValue(value: string, dataType: string): Json {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (dataType === "number" || dataType === "currency") {
    const normalized = Number(trimmed.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(normalized) ? normalized : value;
  }
  if (dataType === "boolean") {
    const lowered = trimmed.toLowerCase();
    if (["true", "yes", "1"].includes(lowered)) return true;
    if (["false", "no", "0"].includes(lowered)) return false;
  }
  return value;
}

function ResizableHeader({
  label,
  width,
  isMuted = false,
  align = "left",
  title,
  children,
  onResizeStart,
  onAutoFit,
}: {
  label: string;
  width: number;
  isMuted?: boolean;
  align?: "left" | "right";
  title?: string;
  children?: ReactNode;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAutoFit: () => void;
}) {
  const isCollapsed = width < 54;

  return (
    <th
      className={`relative whitespace-nowrap py-3 font-mono text-[10px] font-medium uppercase tracking-wider ${
        isCollapsed ? "px-1" : "px-4"
      } ${
        align === "right" ? "text-right" : "text-left"
      } ${isMuted ? "text-muted-foreground/40" : "text-muted-foreground"}`}
      style={{ width }}
      title={title}
    >
      <span
        className={`flex min-w-0 items-center gap-1 ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
      >
        {!isCollapsed && (
          <>
            <span className="truncate">{label}</span>
            {children}
          </>
        )}
      </span>
      <button
        type="button"
        aria-label={`Resize ${label} column`}
        onPointerDown={onResizeStart}
        onDoubleClick={onAutoFit}
        className="absolute right-0 top-0 flex h-full w-3 cursor-col-resize items-center justify-center text-muted-foreground/30 hover:bg-surface-2 hover:text-muted-foreground"
      >
        <GripVertical className="h-3 w-3" />
      </button>
    </th>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

function Output() {
  const { currentOrg, user } = useAuth();
  const sectionLevel = useSectionAccess("data_entries");
  const canEdit = sectionLevel === "edit";
  const { data: extractions = [], isLoading: extLoading } = useExtractions(currentOrg?.id, 200);
  const { data: templates = [], isLoading: tplLoading } = useTemplates({
    orgId: currentOrg?.id ?? null,
    authorId: user?.id ?? null,
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [editingCell, setEditingCell] = useState<{ rowId: string; fieldKey: string } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const skipNextBlurSave = useRef(false);
  const deleteExtractions = useDeleteExtractions();
  const updateExtractionData = useUpdateExtractionData();

  // Load all fields (active + inactive) for the selected template
  const { data: tplData, isLoading: tplFieldsLoading } = useTemplate(selectedTemplateId || null);

  // All fields in definition order — used as columns
  const columnDefs = useMemo(() => {
    if (!tplData?.fields?.length) return [];
    return tplData.fields.map((f) => ({
      key: f.key,
      label: f.label,
      isEnabled: f.is_enabled,
      dataType: f.data_type,
    }));
  }, [tplData]);

  // Filter extractions to only rows that used this template
  const templateRows = useMemo(() => {
    if (!selectedTemplateId) return [];
    return extractions.filter((e) => e.status === "done" && e.template_id === selectedTemplateId);
  }, [extractions, selectedTemplateId]);

  // Apply search across all field values
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templateRows;
    return templateRows.filter((e) => {
      const data = (e.data as Record<string, Json> | null) ?? {};
      const haystack = Object.values(data)
        .map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : ""))
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [templateRows, query]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => sel.includes(r.id));
  const selectedRows = useMemo(() => filtered.filter((r) => sel.includes(r.id)), [filtered, sel]);
  const selectedCount = selectedRows.length;
  const totalTableWidth = useMemo(
    () =>
      44 +
      (columnWidths.document ?? META_COLUMN_WIDTHS.document) +
      (columnWidths.extracted ?? META_COLUMN_WIDTHS.extracted) +
      columnDefs.reduce(
        (sum, col) => sum + (columnWidths[col.key] ?? defaultFieldWidth(col.label)),
        0,
      ) +
      (columnWidths.confidence ?? META_COLUMN_WIDTHS.confidence) +
      48,
    [columnDefs, columnWidths],
  );

  useEffect(() => {
    const visibleIds = new Set(templateRows.map((row) => row.id));
    setSel((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [templateRows]);

  function toggleAll(checked: boolean) {
    const ids = filtered.map((r) => r.id);
    setSel((prev) =>
      checked ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id)),
    );
  }

  function toggleRow(id: string) {
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function getColumnWidth(id: string, fallback: number) {
    return columnWidths[id] ?? fallback;
  }

  function beginResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    columnId: string,
    fallback: number,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getColumnWidth(columnId, fallback);
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampColumnWidth(startWidth + moveEvent.clientX - startX);
      setColumnWidths((prev) => ({ ...prev, [columnId]: nextWidth }));
    };

    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = previousUserSelect;
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  }

  function autoFitColumn(columnId: string, fallback: number) {
    const values =
      columnId === "document"
        ? filtered.map(
            (row) =>
              (row.document as { file_name?: string } | null)?.file_name ??
              row.id.slice(0, 8).toUpperCase(),
          )
        : columnId === "extracted"
          ? filtered.map((row) => formatDateShort(row.created_at))
          : columnId === "confidence"
            ? filtered.map((row) => `${Math.round(Number(row.confidence ?? 0))}%`)
            : filtered.map((row) => pickString(row.data, columnId));
    const label =
      columnId === "document"
        ? "Document"
        : columnId === "extracted"
          ? "Extracted"
          : columnId === "confidence"
            ? "Conf."
            : columnDefs.find((col) => col.key === columnId)?.label;
    const longest = [label ?? "", ...values].reduce((max, value) => Math.max(max, value.length), 0);
    const nextWidth = longest === 0 ? fallback : clampColumnWidth(longest * 8 + 44);
    setColumnWidths((prev) => ({ ...prev, [columnId]: nextWidth }));
  }

  function beginCellEdit(rowId: string, fieldKey: string, value: string) {
    if (!canEdit) return;
    skipNextBlurSave.current = false;
    setEditingCell({ rowId, fieldKey });
    setDraftValue(value);
  }

  function cancelCellEdit(skipBlurSave = false) {
    skipNextBlurSave.current = skipBlurSave;
    setEditingCell(null);
    setDraftValue("");
  }

  async function saveCellEdit(row: (typeof filtered)[number], col: (typeof columnDefs)[number]) {
    if (skipNextBlurSave.current) {
      skipNextBlurSave.current = false;
      return;
    }
    if (!currentOrg?.id || updateExtractionData.isPending) return;
    const currentValue = pickString(row.data, col.key);
    if (draftValue === currentValue) {
      cancelCellEdit();
      return;
    }

    const currentData = (row.data as Record<string, Json> | null) ?? {};
    await updateExtractionData.mutateAsync({
      orgId: currentOrg.id,
      extractionId: row.id,
      data: {
        ...currentData,
        [col.key]: coerceCellValue(draftValue, col.dataType),
      },
    });
    cancelCellEdit();
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    row: (typeof filtered)[number],
    col: (typeof columnDefs)[number],
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveCellEdit(row, col);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelCellEdit(true);
    }
  }

  async function deleteSelectedRows() {
    if (!canEdit || !currentOrg?.id || selectedCount === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedCount} selected data entr${selectedCount === 1 ? "y" : "ies"}?`,
    );
    if (!confirmed) return;

    await deleteExtractions.mutateAsync({
      orgId: currentOrg.id,
      ids: selectedRows.map((row) => row.id),
    });
    setSel([]);
  }

  function exportCsv(rows: typeof filtered) {
    const headers = ["Document", "Date", ...columnDefs.map((c) => c.label), "Confidence"];
    const data = rows.map((e) => {
      const d = (e.data as Record<string, Json> | null) ?? {};
      return [
        (e.document as { file_name?: string } | null)?.file_name ?? e.id.slice(0, 8),
        formatDateShort(e.created_at),
        ...columnDefs.map((c) => pickString(d, c.key)),
        `${Math.round(Number(e.confidence ?? 0))}%`,
      ];
    });
    downloadCsv(
      `billsos-${selectedTemplateId.slice(0, 8)}-${Date.now()}.csv`,
      rowsToCsv(headers, data),
    );
  }

  const isLoading = extLoading || tplLoading;

  if (sectionLevel === "none") {
    return (
      <AppShell title="Data Entries">
        <NoSectionAccess section="data_entries" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Data Entries">
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {sectionLevel === "view" && (
          <div className="px-6 pt-4">
            <ReadOnlyBanner section="data_entries" />
          </div>
        )}
        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-6 py-3">
          {/* Template picker */}
          <div className="relative">
            <select
              value={selectedTemplateId}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value);
                setSel([]);
              }}
              disabled={tplLoading}
              className="h-9 appearance-none rounded-lg border border-border bg-background pl-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-lime disabled:opacity-50"
            >
              <option value="">Select template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>

          {selectedTemplateId && (
            <>
              <span className="font-mono text-[10px] text-muted-foreground">
                {filtered.length} row{filtered.length !== 1 ? "s" : ""} · {columnDefs.length} column
                {columnDefs.length !== 1 ? "s" : ""}
              </span>

              {/* Search */}
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search rows…"
                  className="w-40 bg-transparent placeholder:text-muted-foreground focus:outline-none"
                />
              </div>

              <div className="ml-auto flex items-center gap-2">
                {canEdit && selectedCount > 0 && (
                  <button
                    onClick={deleteSelectedRows}
                    disabled={deleteExtractions.isPending}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 text-xs text-destructive hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {deleteExtractions.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Delete {selectedCount}
                  </button>
                )}
                <button
                  onClick={() => exportCsv(selectedCount ? selectedRows : filtered)}
                  disabled={filtered.length === 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  {selectedCount ? `Export ${selectedCount} selected` : "Export CSV"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !selectedTemplateId ? (
          /* No template selected */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface">
              <Table2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">Please select a template</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Choose a template from the dropdown above to view its extracted data entries as a
              table.
            </p>
          </div>
        ) : tplFieldsLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : columnDefs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-foreground">No fields in this template</p>
            <p className="text-xs text-muted-foreground">
              Add fields in Configure to see data here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No extractions yet for this template
            </p>
            <p className="text-xs text-muted-foreground">
              Upload documents and select this template to see extracted data here.
            </p>
          </div>
        ) : (
          /* Data table */
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="table-fixed text-sm" style={{ width: totalTableWidth }}>
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: getColumnWidth("document", META_COLUMN_WIDTHS.document) }} />
                <col style={{ width: getColumnWidth("extracted", META_COLUMN_WIDTHS.extracted) }} />
                {columnDefs.map((col) => (
                  <col
                    key={col.key}
                    style={{ width: getColumnWidth(col.key, defaultFieldWidth(col.label)) }}
                  />
                ))}
                <col
                  style={{ width: getColumnWidth("confidence", META_COLUMN_WIDTHS.confidence) }}
                />
                <col style={{ width: 48 }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border">
                  <th className="w-10 p-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      readOnly
                      onClick={() => toggleAll(!allVisibleSelected)}
                      className="h-3.5 w-3.5 accent-foreground"
                    />
                  </th>
                  {/* Fixed meta columns */}
                  <ResizableHeader
                    label="Document"
                    width={getColumnWidth("document", META_COLUMN_WIDTHS.document)}
                    onResizeStart={(event) =>
                      beginResize(event, "document", META_COLUMN_WIDTHS.document)
                    }
                    onAutoFit={() => autoFitColumn("document", META_COLUMN_WIDTHS.document)}
                  />
                  <ResizableHeader
                    label="Extracted"
                    width={getColumnWidth("extracted", META_COLUMN_WIDTHS.extracted)}
                    onResizeStart={(event) =>
                      beginResize(event, "extracted", META_COLUMN_WIDTHS.extracted)
                    }
                    onAutoFit={() => autoFitColumn("extracted", META_COLUMN_WIDTHS.extracted)}
                  />
                  {/* Dynamic template field columns — ALL fields regardless of is_enabled */}
                  {columnDefs.map((col) => (
                    <ResizableHeader
                      key={col.key}
                      label={col.label}
                      width={getColumnWidth(col.key, defaultFieldWidth(col.label))}
                      isMuted={!col.isEnabled}
                      title={col.isEnabled ? "Active field" : "Inactive field — not extracted"}
                      onResizeStart={(event) =>
                        beginResize(event, col.key, defaultFieldWidth(col.label))
                      }
                      onAutoFit={() => autoFitColumn(col.key, defaultFieldWidth(col.label))}
                    >
                      {!col.isEnabled && (
                        <span className="rounded border border-border px-1 text-[9px] normal-case text-muted-foreground/50">
                          off
                        </span>
                      )}
                    </ResizableHeader>
                  ))}
                  {/* Confidence */}
                  <ResizableHeader
                    align="right"
                    label="Conf."
                    width={getColumnWidth("confidence", META_COLUMN_WIDTHS.confidence)}
                    onResizeStart={(event) =>
                      beginResize(event, "confidence", META_COLUMN_WIDTHS.confidence)
                    }
                    onAutoFit={() => autoFitColumn("confidence", META_COLUMN_WIDTHS.confidence)}
                  />
                  <th className="w-10 p-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const checked = sel.includes(e.id);
                  const d = (e.data as Record<string, Json> | null) ?? {};
                  const conf = Math.round(Number(e.confidence ?? 0));
                  const docName =
                    (e.document as { file_name?: string } | null)?.file_name ??
                    e.id.slice(0, 8).toUpperCase();

                  return (
                    <tr
                      key={e.id}
                      className={`group border-b border-border transition-colors hover:bg-surface ${
                        checked ? "bg-surface" : ""
                      }`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          onClick={() => toggleRow(e.id)}
                          className="h-3.5 w-3.5 accent-foreground"
                        />
                      </td>
                      {/* Document name */}
                      <td className="max-w-[160px] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {docName}
                      </td>
                      {/* Extraction date */}
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                        {formatDateShort(e.created_at)}
                      </td>
                      {/* Dynamic field cells */}
                      {columnDefs.map((col) => {
                        const raw = pickString(d, col.key);
                        const isEmpty = !raw;
                        const isEditing =
                          editingCell?.rowId === e.id && editingCell.fieldKey === col.key;
                        const isNumeric = col.dataType === "number" || col.dataType === "currency";
                        return (
                          <td
                            key={col.key}
                            className={`whitespace-nowrap p-0 ${!col.isEnabled ? "opacity-40" : ""}`}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                value={draftValue}
                                onChange={(event) => setDraftValue(event.target.value)}
                                onBlur={() => void saveCellEdit(e, col)}
                                onKeyDown={(event) => handleCellKeyDown(event, e, col)}
                                disabled={updateExtractionData.isPending}
                                className={`h-9 w-full min-w-0 border border-brand-lime bg-background px-3 py-2 text-sm text-foreground outline-none ring-1 ring-brand-lime/40 disabled:opacity-60 ${
                                  isNumeric ? "text-right font-mono" : ""
                                }`}
                              />
                            ) : (
                              <button
                                type="button"
                                title={isEmpty ? "Empty" : raw}
                                onClick={() => beginCellEdit(e.id, col.key, raw)}
                                className={`block h-9 w-full min-w-0 truncate px-4 py-2.5 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-lime ${
                                  isNumeric ? "text-right font-mono" : ""
                                } ${isEmpty ? "text-muted-foreground/40" : ""}`}
                              >
                                {isEmpty ? "—" : raw}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      {/* Confidence badge */}
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <span
                          className={`rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${
                            conf >= 90
                              ? "border-brand-lime/30 bg-brand-lime/10 text-brand-lime"
                              : conf >= 70
                                ? "border-brand-blue/30 bg-brand-blue/10 text-brand-blue"
                                : "border-border bg-surface-2 text-muted-foreground"
                          }`}
                        >
                          {conf}%
                        </span>
                      </td>
                      <td className="p-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <button className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        {selectedTemplateId && !tplFieldsLoading && filtered.length > 0 && (
          <div className="border-t border-border bg-surface px-6 py-2.5">
            <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
              <span>
                {selectedCount > 0
                  ? `${selectedCount} of ${filtered.length} selected`
                  : `${filtered.length} row${filtered.length !== 1 ? "s" : ""}`}
              </span>
              <span>
                {columnDefs.filter((c) => c.isEnabled).length} active ·{" "}
                {columnDefs.filter((c) => !c.isEnabled).length} inactive columns
              </span>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
