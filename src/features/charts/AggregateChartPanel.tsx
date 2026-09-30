/**
 * Chart a warehouse table through Builder's aggregate API (#500, builder#818).
 *
 * The person picks a group column, one measure and a chart type; the Builder computes the
 * aggregate over every filtered row of a pinned snapshot, and only then sorts and cuts to
 * `limit`. Studio draws what came back and says whether it is every group or the top N.
 * `sum` asks the person to state that the column may be added up, as the API requires.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DataTable } from "@/features/data-table/DataTable";
import {
  type WarehouseAggregateResponse,
} from "@/shared/lib/builderApi";
import { warehouseApi } from "@/features/sql/warehouseApi";
import { encodingsOf } from "@/shared/lib/cellValue";
import { Button, Card } from "@/shared/ui";

import { toPoints } from "./chartData";
import { scopeOfAggregate } from "./chartScope";
import type { ChartSpec } from "./chartSpec";
import { SimpleChart } from "./SimpleChart";

const MEASURE = "value";
const field =
  "mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The aggregate request a spec asks for. Bars sort by the value, lines by the group. */
export function aggregateRequest(spec: ChartSpec, snapshot: string) {
  return {
    table: spec.table,
    snapshot,
    group_by: [spec.groupBy],
    measures: [
      {
        fn: spec.measure.fn,
        column: spec.measure.column,
        additive: spec.measure.fn === "sum" ? true : undefined,
        as: MEASURE,
      },
    ],
    order_by:
      spec.kind === "bar"
        ? [{ key: MEASURE, direction: "desc" as const }]
        : [{ key: spec.groupBy }],
    limit: spec.limit,
  };
}

export function AggregateChartPanel({
  table,
  snapshot,
}: {
  table: string;
  snapshot: string;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"bar" | "line">("bar");
  const [groupBy, setGroupBy] = useState("");
  const [fn, setFn] = useState<ChartSpec["measure"]["fn"]>("count_rows");
  const [column, setColumn] = useState("");
  const [additive, setAdditive] = useState(false);
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    response: WarehouseAggregateResponse;
    spec: ChartSpec;
  } | null>(null);

  const needsColumn = fn !== "count_rows";
  const blocked =
    !groupBy.trim() ||
    (needsColumn && !column.trim()) ||
    (fn === "sum" && !additive);

  async function draw() {
    const spec: ChartSpec = {
      version: 1,
      table,
      kind,
      groupBy: groupBy.trim(),
      measure: {
        fn,
        column: needsColumn ? column.trim() : undefined,
        additive: fn === "sum" ? additive : undefined,
      },
      limit,
    };
    setBusy(true);
    setError(null);
    try {
      setResult({
        response: await warehouseApi().warehouseAggregate(
          aggregateRequest(spec, snapshot),
        ),
        spec,
      });
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const encodings = result
    ? encodingsOf(result.response.column_meta)
    : new Map();
  const groupMeta = result?.response.column_meta.find(
    (column) => column.name === result.spec.groupBy,
  );
  const series = result
    ? toPoints(
        result.response.rows,
        result.spec.groupBy,
        MEASURE,
        encodings,
        groupMeta?.logical_type,
      )
    : null;

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">{t("charts.title")}</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-semibold text-muted-foreground">
          {t("charts.groupBy")}
          <input
            className={field}
            onChange={(event) => setGroupBy(event.target.value)}
            value={groupBy}
          />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t("charts.measure")}
          <select
            className={field}
            onChange={(event) =>
              setFn(event.target.value as ChartSpec["measure"]["fn"])
            }
            value={fn}
          >
            {(["count_rows", "sum", "avg", "min", "max"] as const).map(
              (option) => (
                <option key={option} value={option}>
                  {t(`charts.fn.${option}`)}
                </option>
              ),
            )}
          </select>
        </label>
        {needsColumn ? (
          <label className="text-xs font-semibold text-muted-foreground">
            {t("charts.measureColumn")}
            <input
              className={field}
              onChange={(event) => setColumn(event.target.value)}
              value={column}
            />
          </label>
        ) : null}
        <label className="text-xs font-semibold text-muted-foreground">
          {t("charts.kind")}
          <select
            className={field}
            onChange={(event) => setKind(event.target.value as "bar" | "line")}
            value={kind}
          >
            <option value="bar">{t("charts.bar")}</option>
            <option value="line">{t("charts.line")}</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t("charts.limit")}
          <input
            className={field}
            max={1000}
            min={1}
            onChange={(event) =>
              setLimit(
                Math.min(
                  1000,
                  Math.max(1, Math.trunc(event.target.valueAsNumber) || 1),
                ),
              )
            }
            type="number"
            value={limit}
          />
        </label>
      </div>
      {fn === "sum" ? (
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={additive}
            onChange={(event) => setAdditive(event.target.checked)}
            type="checkbox"
          />
          {t("charts.additive")}
        </label>
      ) : null}
      <Button
        disabled={blocked || busy}
        loading={busy}
        onClick={() => void draw()}
        size="sm"
        variant="secondary"
      >
        {t("charts.draw")}
      </Button>
      {error ? (
        <p className="text-sm text-status-failure" role="alert">
          {t("charts.failed", { message: error })}
        </p>
      ) : null}
      {result && series ? (
        <>
          <SimpleChart
            kind={result.spec.kind}
            points={series.points}
            scope={scopeOfAggregate(result.response)}
            xLabel={result.spec.groupBy}
            yLabel={
              t(`charts.fn.${result.spec.measure.fn}`) +
              (result.spec.measure.column
                ? ` · ${result.spec.measure.column}`
                : "")
            }
          />
          <DataTable
            caption={
              <span className="font-mono">{`${result.response.snapshot.logical_name}@${result.response.snapshot.snapshot_id}`}</span>
            }
            columnMeta={result.response.column_meta}
            columns={result.response.columns}
            compact
            rowTotal={{
              returned: result.response.result.returned,
              total: result.response.result.group_count,
              status: "exact",
            }}
            rows={result.response.rows}
          />
        </>
      ) : null}
    </Card>
  );
}
