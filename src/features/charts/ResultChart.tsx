/**
 * Chart a SQL result as it is (#500). A cut result is drawn as "based on the N rows
 * returned" — never as the top N, and never as a representative sample.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { QueryResponse } from "@/shared/lib/builderApi";
import { encodingsOf } from "@/shared/lib/cellValue";
import { Button } from "@/shared/ui";

import { toPoints } from "./chartData";
import { scopeOfQueryResult } from "./chartScope";
import { SimpleChart } from "./SimpleChart";

const field =
  "mt-1 h-8 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ResultChart({ result }: { result: QueryResponse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"bar" | "line">("bar");
  const [xColumn, setX] = useState(result.columns[0] ?? "");
  const [yColumn, setY] = useState(
    result.columns[1] ?? result.columns[0] ?? "",
  );
  if (result.columns.length === 0) return null;
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
        {t("charts.showChart")}
      </Button>
    );
  }
  const encodings = encodingsOf(result.column_meta);
  const xMeta = result.column_meta?.find((column) => column.name === xColumn);
  const { points } = toPoints(
    result.rows,
    xColumn,
    yColumn,
    encodings,
    xMeta?.logical_type,
  );
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap gap-3 text-xs font-semibold text-muted-foreground">
        <label>
          {t("charts.xAxis")}{" "}
          <select
            className={field}
            onChange={(event) => setX(event.target.value)}
            value={xColumn}
          >
            {result.columns.map((column) => (
              <option key={column}>{column}</option>
            ))}
          </select>
        </label>
        <label>
          {t("charts.yAxis")}{" "}
          <select
            className={field}
            onChange={(event) => setY(event.target.value)}
            value={yColumn}
          >
            {result.columns.map((column) => (
              <option key={column}>{column}</option>
            ))}
          </select>
        </label>
        <label>
          {t("charts.kind")}{" "}
          <select
            className={field}
            onChange={(event) => setKind(event.target.value as "bar" | "line")}
            value={kind}
          >
            <option value="bar">{t("charts.bar")}</option>
            <option value="line">{t("charts.line")}</option>
          </select>
        </label>
      </div>
      <SimpleChart
        kind={kind}
        points={points}
        scope={scopeOfQueryResult(result)}
        xLabel={xColumn}
        yLabel={yColumn}
      />
    </div>
  );
}
