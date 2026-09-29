/**
 * What a chart covers, said every time (#500).
 *
 * The worst misreading a chart invites is a cut result taken for the whole. So every chart
 * carries a scope, derived from what the Builder said about the data, and the screen shows
 * it next to the chart:
 *
 * - `full`      — every row or every group.
 * - `top_n`     — the first N groups *after* the whole aggregate was sorted (builder#818).
 *                 Only this may be called "top N": an order was applied.
 * - `truncated` — rows cut at a limit, with no promise about which rows. It is "based on the
 *                 N rows returned", never "top N", and never offered as a sample.
 * - `sample`    — an explicit sample of n rows taken by a named method.
 */
import type { QueryResponse, WarehouseAggregateResponse } from "@/shared/lib/builderApi";

export type ChartScope =
  | { kind: "full"; count: number }
  | { kind: "top_n"; returned: number; total: number; orderedBy: string[] }
  | { kind: "truncated"; returned: number }
  | { kind: "sample"; size: number; method: string };

/** A Builder aggregate: full, or top N of how many. A sampled aggregate says so. */
export function scopeOfAggregate(response: WarehouseAggregateResponse): ChartScope {
  if (response.input.sampled) return { kind: "sample", size: response.input.row_count, method: "builder" };
  if (response.result.completeness === "full") return { kind: "full", count: response.result.returned };
  if (response.result.completeness === "top_n") {
    return {
      kind: "top_n",
      returned: response.result.returned,
      total: response.result.group_count,
      orderedBy: response.order.map((key) => `${key.key} ${key.direction}`),
    };
  }
  // A completeness this Studio does not know is treated as the least it could be.
  return { kind: "truncated", returned: response.result.returned };
}

/** A SQL result: whole when not cut, otherwise only the rows returned. */
export function scopeOfQueryResult(result: Pick<QueryResponse, "rows" | "truncated">): ChartScope {
  return result.truncated ? { kind: "truncated", returned: result.rows.length } : { kind: "full", count: result.rows.length };
}

/** Whether the chart may stand for the whole data. A cut result may not — not even as a "sample". */
export function representsWhole(scope: ChartScope): boolean {
  return scope.kind === "full" || scope.kind === "top_n";
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function scopeLabel(t: Translate, scope: ChartScope): string {
  switch (scope.kind) {
    case "full":
      return t("charts.scope.full", { count: scope.count });
    case "top_n":
      return t("charts.scope.topN", { returned: scope.returned, total: scope.total, order: scope.orderedBy.join(", ") });
    case "truncated":
      return t("charts.scope.truncated", { count: scope.returned });
    case "sample":
      return t("charts.scope.sample", { count: scope.size, method: scope.method });
  }
}
