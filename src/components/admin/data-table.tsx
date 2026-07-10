import { type ReactNode } from "react";
import { ChevronDown, ChevronUp, Check } from "lucide-react";

// ── Data Table ───────────────────────────────────────────────────────────────
// Enterprise-grade data table with sorting, selection, and bulk actions.

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  render?: (row: T, index: number) => ReactNode;
  align?: "left" | "center" | "right";
  mono?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  selectedRows?: Set<string>;
  onSelectRow?: (id: string) => void;
  onSelectAll?: () => void;
  onRowClick?: (row: T) => void;
  sortField?: string;
  sortDir?: "asc" | "desc";
  onSort?: (field: string) => void;
  bulkActions?: { label: string; onClick: () => void; variant?: "danger" }[];
  emptyMessage?: string;
  compact?: boolean;
}

export function DataTable<T extends { id: string; [k: string]: unknown }>({
  columns,
  data,
  keyField,
  selectedRows,
  onSelectRow,
  onSelectAll,
  onRowClick,
  sortField,
  sortDir,
  onSort,
  bulkActions,
  emptyMessage = "No data available",
  compact = false,
}: DataTableProps<T>) {
  const allSelected = selectedRows && data.length > 0 && selectedRows.size === data.length;
  const someSelected = selectedRows && selectedRows.size > 0;
  const cellPadding = compact ? "px-3 py-2" : "px-4 py-3";

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Bulk action bar */}
      {someSelected && bulkActions && bulkActions.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2">
          <span className="font-mono text-[11px] text-foreground/80">
            {selectedRows.size} selected
          </span>
          <div className="mx-2 h-4 w-px bg-[#222]" />
          {bulkActions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                action.variant === "danger"
                  ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                  : "border-border/80 text-foreground/80 hover:bg-muted hover:text-foreground"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-surface">
              {onSelectRow && (
                <th className="w-10 px-3 py-2.5">
                  <button
                    onClick={onSelectAll}
                    className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                      allSelected
                        ? "border-blue-600 bg-blue-600"
                        : someSelected
                          ? "border-blue-600/50 bg-blue-600/20"
                          : "border-[#333] hover:border-[#555]"
                    }`}
                  >
                    {(allSelected || someSelected) && <Check className="h-2.5 w-2.5 text-foreground" />}
                  </button>
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={`${cellPadding} font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}
                >
                  {col.sortable ? (
                    <button
                      onClick={() => onSort?.(col.key)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-foreground/90"
                    >
                      {col.label}
                      {sortField === col.key ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronDown className="h-3 w-3 opacity-0 group-hover:opacity-30" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectRow ? 1 : 0)}
                  className="px-4 py-12 text-center font-mono text-sm text-muted-foreground/80"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => {
                const rowId = String(row[keyField]);
                const isSelected = selectedRows?.has(rowId);
                return (
                  <tr
                    key={rowId}
                    onClick={() => onRowClick?.(row)}
                    className={`transition-colors ${
                      isSelected ? "bg-blue-600/5" : "hover:bg-surface-2"
                    } ${onRowClick ? "cursor-pointer" : ""}`}
                  >
                    {onSelectRow && (
                      <td className="w-10 px-3 py-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRow(rowId);
                          }}
                          className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                            isSelected
                              ? "border-blue-600 bg-blue-600"
                              : "border-[#333] hover:border-[#555]"
                          }`}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5 text-foreground" />}
                        </button>
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${cellPadding} text-[13px] ${col.mono ? "font-mono" : ""} ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""} text-foreground/90`}
                      >
                        {col.render
                          ? col.render(row, idx)
                          : String(row[col.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
