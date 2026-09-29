/**
 * Rows into chart points without losing what the Builder sent (#500).
 *
 * A point has an approximate coordinate for drawing and the exact text for reading: a
 * Decimal or an unsafe integer is plotted at its nearest double, but the tooltip shows the
 * text that arrived. A missing value is a gap, not zero — a line breaks there and a bar is
 * not drawn — and a real 0 stays a point at 0. A time axis is sorted by time.
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
  if (logicalType && TEMPORAL.test(logicalType)) return true;
  return values.length > 0 && values.every((value) => ISO_DATE.test(value));
}

/** The drawing coordinate of a value. Text that is not a finite number has none. */
export function coordinate(value: unknown): number | null {
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
): { points: ChartPoint[]; temporal: boolean } {
  const points = rows.map((row) => ({
    x: cellValue(encodings.get(xColumn), row[xColumn]),
    y: coordinate(row[yColumn]),
    exact: cellValue(encodings.get(yColumn), row[yColumn]),
  }));
  const temporal = isTemporal(xLogicalType, points.map((point) => point.x).filter((x) => x !== "—"));
  if (temporal) points.sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
  return { points, temporal };
}
