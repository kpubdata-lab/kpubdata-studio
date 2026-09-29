/**
 * A query result and a query error, shared by both SQL workspaces and saved analyses (#417).
 * The header always names what was read, so a number can be traced after a refresh.
 */
import { useTranslation } from "react-i18next";

import type { QueryResponse } from "@/shared/lib/builderApi";
import { cellValue, encodingsOf } from "@/shared/lib/cellValue";
import { Card, DemoBadge } from "@/shared/ui";

export function QueryError({ code, message }: { code: string; message: string }) {
  const { t } = useTranslation();
  return (
    <Card role="alert" variant="error">
      <p className="font-semibold">{t("sql.failed", { code })}</p>
      <p className="mt-1 text-sm">{message}</p>
    </Card>
  );
}

/** A query result with a header naming what it read. Shared by both workspaces and saved analyses. */
export function ResultTable({ result, target, demo = false }: { result: QueryResponse; target: string; demo?: boolean }) {
  const { t } = useTranslation();
  const encodings = encodingsOf(result.column_meta);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        {demo ? <DemoBadge /> : null}
        <span className="font-mono">{target}</span>
        <span>·</span>
        <span>{t("sql.rows", { count: result.rows.length })}</span>
        <span>·</span>
        <span>{result.execution_ms} ms</span>
        {result.truncated ? <span className="font-semibold text-amber-700 dark:text-amber-300">{t("sql.truncated")}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              {result.columns.map((column) => (
                <th className="px-3 py-2 font-mono text-xs font-semibold text-muted-foreground" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr className="border-t border-border" key={index}>
                {result.columns.map((column) => (
                  <td className="px-3 py-1.5 font-mono text-xs" key={column}>
                    {cellValue(encodings.get(column), row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
