/**
 * Rows into chart points without losing what the Builder sent (#500).
 *
 * A point has an approximate coordinate for drawing and the exact text for reading: a
 * Decimal or an unsafe integer is plotted at its nearest double, but the tooltip shows the
 * text that arrived. A missing value is a gap, not zero — a line breaks there and a bar is
 * not drawn — and a real 0 stays a point at 0. A time axis is sorted by time.
 *
 * An identifier (builder#702: a legal-dong code, a PNU, a postcode — a column the kpubdata
 * spec declares a code) is text, not a quantity (#582). It is never a measure: it is left
 * out of the y candidates and, if handed in as y anyway, has no coordinate — `"01234"` is
 * not drawn as 1234. As x it is the category label, as sent. Which columns are identifiers
 * is Builder's `logical_type`, never guessed from the values.
 */
import { cellValue, type WireEncoding } from "@/shared/lib/cellValue";

export interface ChartPoint {
  /** The category or time label, exactly as sent. */
  x: string;
  /** Drawing coordinate; null for a missing value. */
  y: number | null;
  /** The value as sent, for the tooltip. */
  exact: string;
}

const TEMPORAL = /^(date|datetime|timestamp|time)/i;
const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/;

export function isTemporal(logicalType: string | undefined, values: readonly string[]): boolean {
  if (isIdentifier(logicalType)) return false;
  if (logicalType && TEMPORAL.test(logicalType)) return true;
  return values.length > 0 && values.every((value) => ISO_DATE.test(value));
}

/** Builder's logical type for a code column (builder#702). Its values are exact text. */
export const IDENTIFIER_LOGICAL_TYPE = "identifier";

export function isIdentifier(logicalType: string | undefined): boolean {
  return logicalType === IDENTIFIER_LOGICAL_TYPE;
}

/**
 * Columns that may be drawn as a measure (y): every column except an identifier. A column
 * with no metadata, or a logical type this Studio does not know, stays a candidate — its
 * cells still show as the text received, and only numeric text gets a coordinate.
 */
export function measureCandidates(
  columns: readonly string[],
  columnMeta: ReadonlyArray<{ name: string; logical_type?: string }> | null | undefined,
): string[] {
  const identifiers = new Set((columnMeta ?? []).filter((column) => isIdentifier(column.logical_type)).map((column) => column.name));
  return columns.filter((column) => !identifiers.has(column));
}

/**
 * The drawing coordinate of a value. Text that is not a finite number has none, and
 * neither has any value of an identifier column — converting it is never implicit.
 */
export function coordinate(value: unknown, logicalType?: string): number | null {
  if (isIdentifier(logicalType)) return null;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

export function toPoints(
  rows: ReadonlyArray<Record<string, unknown>>,
  xColumn: string,
  yColumn: string,
  encodings: ReadonlyMap<string, WireEncoding>,
  xLogicalType?: string,
  yLogicalType?: string,
): { points: ChartPoint[]; temporal: boolean } {
  const points = rows.map((row) => ({
    x: cellValue(encodings.get(xColumn), row[xColumn]),
    y: coordinate(row[yColumn], yLogicalType),
    exact: cellValue(encodings.get(yColumn), row[yColumn]),
  }));
  const temporal = isTemporal(xLogicalType, points.map((point) => point.x).filter((x) => x !== "—"));
  if (temporal) points.sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
  return { points, temporal };
}
