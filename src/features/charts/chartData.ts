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
 *
 * Two more columns are never a measure (#590). A code stored as a number keeps a numeric
 * `logical_type` but carries `semantic.kind: "code"` (contract 1.61.0) — a postcode is not
 * summed. And a column whose values travel as text (`wire_encoding: "string"`) is not
 * converted to a number implicitly — `"007"` is not drawn as 7. Only `number` and
 * `decimal_string` encode a numeric value (contract 1.30.0). A response without column
 * metadata keeps every column as a candidate, as before.
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

/** Builder's semantic kind for a column a kpubdata spec declares a code, whatever its storage type. */
export const CODE_SEMANTIC_KIND = "code";

/** The wire encodings that carry a numeric value (builder#735). */
const NUMERIC_ENCODINGS: ReadonlySet<string> = new Set(["number", "decimal_string"]);

/** A column's metadata as far as the measure axis needs it. */
export interface MeasureColumnMeta {
  name: string;
  logical_type?: string;
  wire_encoding?: WireEncoding;
  semantic?: { kind: string };
}

function isMeasure(meta: MeasureColumnMeta | undefined): boolean {
  // No metadata for this column: keep it, as before metadata existed.
  if (!meta) return true;
  if (isIdentifier(meta.logical_type)) return false;
  if (meta.semantic?.kind === CODE_SEMANTIC_KIND) return false;
  return meta.wire_encoding === undefined || NUMERIC_ENCODINGS.has(meta.wire_encoding);
}

/**
 * Columns that may be drawn as a measure (y): a column whose values travel as `number` or
 * `decimal_string`, and that is neither an identifier nor a declared code. A column with
 * no metadata (an older Builder) stays a candidate — its cells still show as the text
 * received, and only numeric text gets a coordinate.
 */
export function measureCandidates(
  columns: readonly string[],
  columnMeta: readonly MeasureColumnMeta[] | null | undefined,
): string[] {
  const metaByName = new Map((columnMeta ?? []).map((column) => [column.name, column]));
  return columns.filter((column) => isMeasure(metaByName.get(column)));
}

/**
 * The drawing coordinate of a value. Text that is not a finite number has none, and
 * neither has any value of an identifier column or of a column whose values travel as
 * text or anything other than a number — converting it is never implicit. With no
 * encoding known (an older Builder), numeric text still gets its coordinate.
 */
export function coordinate(value: unknown, logicalType?: string, encoding?: WireEncoding): number | null {
  if (isIdentifier(logicalType)) return null;
  if (encoding !== undefined && !NUMERIC_ENCODINGS.has(encoding)) return null;
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
    y: coordinate(row[yColumn], yLogicalType, encodings.get(yColumn)),
    exact: cellValue(encodings.get(yColumn), row[yColumn]),
  }));
  const temporal = isTemporal(xLogicalType, points.map((point) => point.x).filter((x) => x !== "—"));
  if (temporal) points.sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
  return { points, temporal };
}
