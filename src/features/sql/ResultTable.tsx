/**
 * A query result and a query error, shared by both SQL workspaces and saved analyses (#417).
 * The header always names what was read, so a number can be traced after a refresh.
 */
import { useTranslation } from "react-i18next";

import { ResultChart } from "@/features/charts/ResultChart";
import { DataTable } from "@/features/data-table/DataTable";
import type { QueryResponse } from "@/shared/lib/builderApi";
import { Card, DemoBadge } from "@/shared/ui";

/**
 * The refusals that are a policy, not a failure (#640): the data is there, but Builder will
 * not let it out. Each says why and what the person can do instead, so it does not read
 * like a broken query to retry.
 */
export const READ_BLOCK_CODES = ["redistribution_forbidden", "declared_pii_withheld", "pii_declaration_unavailable"] as const;
export type ReadBlockCode = (typeof READ_BLOCK_CODES)[number];

export function isReadBlock(code: string): code is ReadBlockCode {
  return (READ_BLOCK_CODES as readonly string[]).includes(code);
}

function readBlockText(t: (key: string) => string, code: ReadBlockCode): { title: string; reason: string; next: string } {
  switch (code) {
    case "redistribution_forbidden":
      return {
        title: t("sql.blocked.redistribution_forbidden.title"),
        reason: t("sql.blocked.redistribution_forbidden.reason"),
        next: t("sql.blocked.redistribution_forbidden.next"),
      };
    case "declared_pii_withheld":
      return {
        title: t("sql.blocked.declared_pii_withheld.title"),
        reason: t("sql.blocked.declared_pii_withheld.reason"),
        next: t("sql.blocked.declared_pii_withheld.next"),
      };
    case "pii_declaration_unavailable":
      return {
        title: t("sql.blocked.pii_declaration_unavailable.title"),
        reason: t("sql.blocked.pii_declaration_unavailable.reason"),
        next: t("sql.blocked.pii_declaration_unavailable.next"),
      };
  }
}

export function QueryError({
  code,
  message,
}: {
  code: string;
  message: string;
}) {
  const { t } = useTranslation();
  if (isReadBlock(code)) {
    const text = readBlockText(t, code);
    return (
      // A policy notice, toned as a warning rather than a failure: nothing is broken.
      <div className="rounded-xl border border-status-warning-border bg-status-warning-subtle p-6" data-block={code} role="alert">
        <p className="font-semibold text-status-warning">{text.title}</p>
        <p className="mt-1 text-sm">{text.reason}</p>
        <p className="mt-1 text-sm font-medium">{text.next}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-mono">{code}</span> · {message}
        </p>
      </div>
    );
  }
  const explained = QUERY_ERROR_CODES.includes(code);
  return (
    <Card role="alert" variant="error">
      <p className="font-semibold">{t("sql.failed", { code })}</p>
      {explained ? (
        <>
          <p className="mt-1 text-sm">{t(`sql.errors.${code}`)}</p>
          {/* Builder's own sentence stays, as the detail behind the explanation. */}
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </>
      ) : (
        <p className="mt-1 text-sm">{message}</p>
      )}
    </Card>
  );
}

/** The query refusals Builder names with a `code` (#843); others show Builder's sentence. */
const QUERY_ERROR_CODES: readonly string[] = [
  "unsafe_query",
  "query_busy",
  "query_timeout",
  "query_resource_limit",
  "query_execution_failed",
];

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
        maskedColumns={result.masked_columns}
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
