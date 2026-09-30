/**
 * The one table of actionable quality issues across tables (#536).
 *
 * Columns: Table, Source, Rule, Column, Status, Actual / Threshold, Affected rows,
 * Snapshot. A schema drift finding is a row too, with status "Schema drift". Every value
 * is Builder's; a rule with no column is table-level, and a drift finding has no
 * threshold or row count to show.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { cn } from "@/shared/ui";
import { ActionableStatus, NotEvaluatedStatus } from "@/shared/ui/StatusState";

import { QualityBadge } from "./QualityBadge";
import { issueSource, issueStatus, type IssueRow } from "./issues";
import { formatQualityValue } from "./model";

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground", className)} scope="col">
      {children}
    </th>
  );
}

function rowCount(value: number | null, unit: string): ReactNode {
  return value === null ? <NotEvaluatedStatus /> : `${value.toLocaleString("ko-KR")}${unit}`;
}

function tableQualityHref(row: IssueRow): string {
  const params = new URLSearchParams({ run: row.runId, source: issueSource(row), tab: "quality" });
  return `/tables/${encodeURIComponent(row.dataset.dataset_id)}?${params.toString()}`;
}

export function QualityIssuesTable({ rows }: { rows: IssueRow[] }) {
  const { t } = useTranslation();
  const caption = t("quality.issues.caption");
  const link = "text-accent-subtle-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    // Wider than a phone: the table scrolls inside this region, never the page.
    <div
      aria-label={caption}
      className="relative max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[960px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <Th>{t("quality.issues.cols.table")}</Th>
            <Th>{t("quality.issues.cols.source")}</Th>
            <Th>{t("quality.issues.cols.rule")}</Th>
            <Th>{t("quality.issues.cols.column")}</Th>
            <Th>{t("quality.issues.cols.status")}</Th>
            <Th>{t("quality.issues.cols.actualThreshold")}</Th>
            <Th className="text-right">{t("quality.issues.cols.affected")}</Th>
            <Th>{t("quality.issues.cols.snapshot")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const status = issueStatus(row);
            return (
              <tr className="border-b border-border align-top last:border-b-0 hover:bg-muted/40" key={`${row.dataset.dataset_id}-${issueSource(row)}-${index}`}>
                <td className="px-3 py-2">
                  <Link className={cn("font-medium", link)} to={tableQualityHref(row)}>
                    {row.dataset.title}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{row.dataset.dataset_id}</p>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{issueSource(row)}</td>
                <td className="max-w-72 px-3 py-2">
                  {row.kind === "check" ? (
                    <>
                      <p className="text-foreground">
                        {row.result.category} · <span className="font-mono text-xs">{row.result.rule}</span>
                      </p>
                      {row.result.detail ? <p className="truncate text-xs text-muted-foreground" title={row.result.detail}>{row.result.detail}</p> : null}
                    </>
                  ) : (
                    <>
                      <p className="font-mono text-xs text-foreground">{row.finding.kind}</p>
                      <p className="text-xs text-muted-foreground">{row.finding.detail}</p>
                    </>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {(row.kind === "check" ? row.result.column : row.finding.column) ?? (
                    <span className="font-sans text-muted-foreground" title={t("quality.issues.tableLevelTitle")}>
                      {t("quality.issues.tableLevel")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {status === "drift" ? (
                    <ActionableStatus className="whitespace-nowrap" tone="warning">
                      {t("quality.issues.drift")}
                    </ActionableStatus>
                  ) : (
                    <QualityBadge status={status === "fail" ? "FAIL" : "WARN"} />
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {row.kind === "check" ? (
                    `${formatQualityValue(row.result.rule, row.result.actual)} / ${formatQualityValue(row.result.rule, row.result.threshold)}`
                  ) : (
                    <NotEvaluatedStatus className="font-sans">{t("quality.issues.notApplicable")}</NotEvaluatedStatus>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums">
                  {row.kind === "check" ? (
                    <>
                      {rowCount(row.result.affected_rows, t("quality.rowsUnit"))} / {rowCount(row.result.evaluated_rows, t("quality.rowsUnit"))}
                    </>
                  ) : (
                    <NotEvaluatedStatus className="font-sans">{t("quality.issues.notApplicable")}</NotEvaluatedStatus>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link className={cn("break-all font-mono text-xs", link)} to={`/refresh-jobs/${encodeURIComponent(row.runId)}`}>
                    {row.runId}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
