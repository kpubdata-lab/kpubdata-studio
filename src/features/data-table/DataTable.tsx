/**
 * The one table for Builder values (#499).
 *
 * Every screen that shows rows from KPubData Builder — SQL results, stage samples, a
 * table's pages — renders them here, so precision, column metadata and the difference
 * between "rows shown" and "rows there are" are decided once:
 *
 * - A cell is always `cellValue(encoding, value)` (#484). Nothing here calls `Number()`
 *   or `parseFloat`, so a zero-led code, a 19-digit code, an unsafe integer or a Decimal
 *   arrives as the text the Builder sent.
 * - A header shows the column's name and, when the Builder described it (builder#813),
 *   its display label, logical type and unit. A hint with origin `engine_inferred` is an
 *   estimate and says so.
 * - The footer says how many rows are shown and how many there are, and *how* that total
 *   is known: counted, estimated, not computed or unknown. A total that was not computed
 *   is never written as 0.
 *
 * Paging is the caller's (see `useWarehouseRows`): this component only draws the page it
 * is given and the controls it is handed. Scrolling faster is not the same as buffering
 * less on the server, and this makes no claim to be.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnWireInfo } from "@/shared/lib/builderApi";
import { cellValue, encodingsOf, type WireEncoding } from "@/shared/lib/cellValue";
import { Button, Card } from "@/shared/ui";

export type TotalStatus = "exact" | "estimated" | "not_computed" | "unknown";

export interface RowTotal {
  /** Rows on this page / in this result. */
  returned: number;
  /** All rows there are, when known. Null for `not_computed` and `unknown`. */
  total: number | null;
  status: TotalStatus;
}

export interface DataTablePaging {
  offset: number;
  hasMore: boolean;
  loading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export interface DataTableProps {
  columns: readonly string[];
  /** Per-column wire encoding and hints. A column with none still shows its raw text. */
  columnMeta?: ReadonlyArray<Pick<ColumnWireInfo, "name"> & Partial<ColumnWireInfo> & { wire_encoding?: WireEncoding }>;
  rows: ReadonlyArray<Record<string, unknown>>;
  rowTotal: RowTotal;
  /** A result cut at a limit. It is not "the top N" unless the query ordered it. */
  truncated?: boolean;
  /** Left side of the header strip — what was read, timings, badges. */
  caption?: ReactNode;
  paging?: DataTablePaging;
  /** Narrow cells for dense screens. */
  compact?: boolean;
}

/** A Builder total status, with anything this Studio does not know kept as unknown. */
export function totalStatusOf(status: string | undefined): TotalStatus {
  return status === "exact" || status === "estimated" || status === "not_computed" ? status : "unknown";
}

export function DataTable({ columns, columnMeta, rows, rowTotal, truncated, caption, paging, compact }: DataTableProps) {
  const { t } = useTranslation();
  const encodings = encodingsOf(columnMeta);
  const meta = new Map((columnMeta ?? []).map((column) => [column.name, column]));
  const cell = compact ? "px-3 py-1.5" : "px-4 py-2";
  return (
    <Card className="min-w-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        {caption}
        <span data-testid="row-total">{totalText(t, rowTotal, paging?.offset)}</span>
        {truncated ? <span className="font-semibold text-status-warning">{t("dataTable.truncated")}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              {columns.map((column) => (
                <ColumnHeader className={cell} column={column} key={column} meta={meta.get(column)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr className="border-t border-border" key={index}>
                {columns.map((column) => (
                  <td className={`${cell} max-w-72 truncate font-mono text-xs`} key={column}>
                    {cellValue(encodings.get(column), row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paging ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
          <Button disabled={paging.loading || paging.offset === 0} onClick={paging.onPrevious} size="sm" variant="secondary">
            {t("dataTable.previous")}
          </Button>
          <Button disabled={paging.loading || !paging.hasMore} onClick={paging.onNext} size="sm" variant="secondary">
            {t("dataTable.next")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function ColumnHeader({ column, meta, className }: { column: string; meta?: Partial<ColumnWireInfo>; className: string }) {
  const { t } = useTranslation();
  const label = meta?.display?.label;
  const unit = meta?.unit;
  const estimated = [meta?.display, meta?.unit, meta?.semantic].some((hint) => hint?.origin === "engine_inferred");
  return (
    <th className={`${className} align-bottom`} scope="col">
      {label ? <span className="block text-xs font-semibold text-foreground">{label}</span> : null}
      <span className="block font-mono text-xs font-semibold text-muted-foreground">{column}</span>
      <span className="block text-[11px] font-normal text-muted-foreground">
        {[
          meta?.logical_type,
          unit ? t("dataTable.unit", { unit: unit.scale && unit.scale !== 1 ? `×${unit.scale} ${unit.name}` : unit.name }) : null,
          estimated ? t("dataTable.estimated") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </th>
  );
}

function totalText(t: (key: string, options?: Record<string, unknown>) => string, rowTotal: RowTotal, offset?: number): string {
  const shown =
    offset === undefined || rowTotal.returned === 0
      ? t("dataTable.shown", { count: rowTotal.returned })
      : t("dataTable.shownRange", { from: offset + 1, to: offset + rowTotal.returned });
  switch (rowTotal.status) {
    case "exact":
      return `${shown} · ${t("dataTable.totalExact", { count: rowTotal.total ?? 0 })}`;
    case "estimated":
      return rowTotal.total === null
        ? `${shown} · ${t("dataTable.totalUnknown")}`
        : `${shown} · ${t("dataTable.totalEstimated", { count: rowTotal.total })}`;
    case "not_computed":
      return `${shown} · ${t("dataTable.totalNotComputed")}`;
    default:
      return `${shown} · ${t("dataTable.totalUnknown")}`;
  }
}
