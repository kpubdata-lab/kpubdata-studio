/**
 * A query result and a query error, shared by both SQL workspaces and saved analyses (#417).
 * The header always names what was read, so a number can be traced after a refresh.
 */
import { useTranslation } from "react-i18next";

import { ResultChart } from "@/features/charts/ResultChart";
import { DataTable } from "@/features/data-table/DataTable";
import type { QueryResponse } from "@/shared/lib/builderApi";
import { Card, DemoBadge } from "@/shared/ui";

export function QueryError({
  code,
  message,
}: {
  code: string;
  message: string;
}) {
  const { t } = useTranslation();
  return (
    <Card role="alert" variant="error">
      <p className="font-semibold">{t("sql.failed", { code })}</p>
      <p className="mt-1 text-sm">{message}</p>
    </Card>
  );
}

/**
 * A query result with a header naming what it read. Shared by both workspaces and saved
 * analyses, and drawn by the one data table (#499). A result that was not cut holds every
 * row, so its total is exact; a cut one does not say how many rows there were.
 */
export function ResultTable({
  result,
  target,
  demo = false,
}: {
  result: QueryResponse;
  target: string;
  demo?: boolean;
}) {
  return (
    <div className="space-y-2">
      <DataTable
        caption={
          <>
            {demo ? <DemoBadge /> : null}
            <span className="font-mono">{target}</span>
            <span>·</span>
            <span>{result.execution_ms} ms</span>
            <span>·</span>
          </>
        }
        columnMeta={result.column_meta}
        columns={result.columns}
        compact
        rowTotal={{
          returned: result.rows.length,
          total: result.truncated ? null : result.rows.length,
          status: result.truncated ? "unknown" : "exact",
        }}
        rows={result.rows}
        truncated={result.truncated}
      />
      <ResultChart result={result} />
    </div>
  );
}
