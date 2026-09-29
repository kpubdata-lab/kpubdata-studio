/**
 * The chart a person set up, as Studio stores it (#500).
 *
 * Studio owns the spec; the Builder owns the numbers. A spec names a table, the aggregate
 * to request and how to draw it — never code. Anything loaded back (from a link today, from
 * storage later) is checked before use: its version, its size, its nesting depth, and that
 * the table it names is one the caller can read.
 */
import { z } from "zod";

export const CHART_SPEC_VERSION = 1;
/** A spec is a handful of names; anything bigger than this is not one. */
export const CHART_SPEC_MAX_BYTES = 4096;
const MAX_DEPTH = 4;

export const chartSpecSchema = z
  .object({
    version: z.literal(CHART_SPEC_VERSION),
    table: z.string().min(1).max(200),
    kind: z.enum(["bar", "line"]),
    groupBy: z.string().min(1).max(200),
    measure: z.object({
      fn: z.enum(["count_rows", "sum", "avg", "min", "max"]),
      column: z.string().min(1).max(200).optional(),
      additive: z.boolean().optional(),
    }),
    limit: z.number().int().min(1).max(1000),
  })
  .strict();

export type ChartSpec = z.infer<typeof chartSpecSchema>;

function depth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  return 1 + Math.max(0, ...Object.values(value as Record<string, unknown>).map(depth));
}

export type ChartSpecCheck = { ok: true; spec: ChartSpec } | { ok: false; reason: "size" | "depth" | "shape" | "version" | "table" };

/** Parse a stored spec; `readableTables` are the tables the caller may read. */
export function parseChartSpec(raw: string, readableTables: readonly string[]): ChartSpecCheck {
  if (new TextEncoder().encode(raw).length > CHART_SPEC_MAX_BYTES) return { ok: false, reason: "size" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "shape" };
  }
  if (depth(value) > MAX_DEPTH) return { ok: false, reason: "depth" };
  if (value && typeof value === "object" && (value as { version?: unknown }).version !== CHART_SPEC_VERSION) {
    return { ok: false, reason: "version" };
  }
  const parsed = chartSpecSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "shape" };
  if (!readableTables.includes(parsed.data.table)) return { ok: false, reason: "table" };
  if (parsed.data.measure.fn !== "count_rows" && !parsed.data.measure.column) return { ok: false, reason: "shape" };
  return { ok: true, spec: parsed.data };
}
