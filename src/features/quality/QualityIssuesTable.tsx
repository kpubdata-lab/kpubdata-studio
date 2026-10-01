/**
 * The one table of actionable quality issues across tables (#536), one row per
 * `GET /quality/issues` row (kpubdata-builder#843).
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
import { ActionableStatus, MissingStatus, NotEvaluatedStatus } from "@/shared/ui/StatusState";

import { QualityBadge } from "./QualityBadge";
import { issueSource, issueStatus, issueTableTitle, type IssueRow } from "./issues";
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
  const params = new URLSearchParams({ run: row.run_id, source: issueSource(row), tab: "quality" });
  return `/tables/${encodeURIComponent(row.dataset_id)}?${params.toString()}`;
}

function Rule({ row }: { row: IssueRow }) {
  if (row.kind === "check" && row.check) {
    return (
      <>
        <p className="text-foreground">
          {row.check.category} · <span className="font-mono text-xs">{row.check.rule}</span>
        </p>
        {row.check.detail ? <p className="truncate text-xs text-muted-foreground" title={row.check.detail}>{row.check.detail}</p> : null}
      </>
    );
  }
  if (row.kind === "drift" && row.drift) {
    return (
      <>
        <p className="font-mono text-xs text-foreground">{row.drift.kind}</p>
        <p className="text-xs text-muted-foreground">{row.drift.detail}</p>
      </>
    );
  }
  return <MissingStatus />;
}

export function QualityIssuesTable({ rows }: { rows: IssueRow[] }) {
  const { t } = useTranslation();
  const caption = t("quality.issues.caption");
  const link = "text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const notApplicable = <NotEvaluatedStatus className="font-sans">{t("quality.issues.notApplicable")}</NotEvaluatedStatus>;
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
            const column = row.kind === "check" ? row.check?.column : row.drift?.column;
            return (
              <tr className="border-b border-border align-top last:border-b-0 hover:bg-muted/40" key={`${row.dataset_id}-${issueSource(row)}-${index}`}>
                <td className="px-3 py-2">
                  <Link className={cn("font-medium", link)} to={tableQualityHref(row)}>
                    {issueTableTitle(row)}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{row.dataset_id}</p>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{issueSource(row)}</td>
                <td className="max-w-72 px-3 py-2">
                  <Rule row={row} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {column ?? (
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
                  {row.check
                    ? `${formatQualityValue(row.check.rule, row.check.actual)} / ${formatQualityValue(row.check.rule, row.check.threshold)}`
                    : notApplicable}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums">
                  {row.check ? (
                    <>
                      {rowCount(row.check.affected_rows, t("quality.rowsUnit"))} / {rowCount(row.check.evaluated_rows, t("quality.rowsUnit"))}
                    </>
                  ) : (
                    notApplicable
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link className={cn("break-all font-mono text-xs", link)} to={`/refresh-jobs/${encodeURIComponent(row.run_id)}`}>
                    {row.run_id}
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
