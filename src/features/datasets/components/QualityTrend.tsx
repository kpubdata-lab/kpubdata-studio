/**
 * A table's quality across runs (#650), read from `GET /datasets/{id}/quality/history`.
 *
 * Every number is Builder's: the pass rate is `rule_pass_rate`, never recomputed here, and a run
 * with no evaluated checks reads N/A — not 0% and not PASS (#246). A legacy run whose
 * `timestamp` is null says "time not recorded" instead of borrowing another date. A table
 * with no history (404) or an empty one gets an empty state, not a flat line.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDatasetQualityHistory } from "@/features/datasets/api";
import { formatDateTime } from "@/features/datasets/model";
import { ApiError, type DatasetQualityHistoryEntry, type DatasetQualityHistoryResponse } from "@/shared/lib/builderApi";
import { Card, EmptyState, Skeleton } from "@/shared/ui";
import { ActionableStatus, MissingStatus, NormalStatus, NotEvaluatedStatus, UnknownStatus } from "@/shared/ui/StatusState";

/** How many runs the trend asks for — bounded so one table never pulls its whole history. */
export const QUALITY_TREND_LIMIT = 20;

export type QualityTrendState =
  | { status: "loading" }
  | { status: "loaded"; data: DatasetQualityHistoryResponse }
  | { status: "not-found" }
  | { status: "error"; error: string };

/** Loads the history for `datasetId` and renders it. */
export function QualityTrend({ datasetId }: { datasetId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<QualityTrendState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getDatasetQualityHistory(datasetId, QUALITY_TREND_LIMIT, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "loaded", data });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404) setState({ status: "not-found" });
        else setState({ status: "error", error: cause instanceof Error ? cause.message : t("qualityTrend.error") });
      });
    return () => controller.abort();
  }, [datasetId, t]);

  return <QualityTrendView state={state} />;
}

/** Whether Builder evaluated anything in this run. `evaluated_checks` decides, not the rate. */
function isEvaluated(run: DatasetQualityHistoryEntry): boolean {
  return run.evaluated_checks > 0;
}

export function QualityTrendView({ state }: { state: QualityTrendState }) {
  const { t } = useTranslation();
  const heading = (
    <div className="border-b border-border px-5 py-4">
      <h3 className="text-sm font-semibold">{t("qualityTrend.title")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("qualityTrend.description")}</p>
    </div>
  );

  if (state.status === "loading") {
    return (
      <Card className="overflow-hidden p-0" aria-busy="true">
        {heading}
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card className="overflow-hidden p-0">
        {heading}
        <div className="p-5" role="alert" data-trend-state="error">
          <p className="text-sm font-medium text-status-failure">{t("qualityTrend.error")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{state.error}</p>
        </div>
      </Card>
    );
  }
  if (state.status === "not-found" || state.data.runs.length === 0) {
    return (
      <Card className="overflow-hidden p-0">
        {heading}
        <div data-trend-state="empty">
          <EmptyState title={t("qualityTrend.emptyTitle")} description={t("qualityTrend.emptyDescription")} />
        </div>
      </Card>
    );
  }

  const runs = state.data.runs;
  return (
    <Card className="overflow-hidden p-0">
      {heading}
      <div className="px-5 pt-4">
        <PassRateSparkline runs={runs} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-5 py-3">{t("labels.run")}</th>
              <th className="px-5 py-3">{t("qualityTrend.columns.time")}</th>
              <th className="px-5 py-3">{t("qualityTrend.columns.results")}</th>
              <th className="px-5 py-3">{t("qualityTrend.columns.passRate")}</th>
              <th className="px-5 py-3">{t("qualityTrend.columns.validatedRows")}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.run_id} className="border-b border-border last:border-0" data-run-id={run.run_id}>
                <td className="px-5 py-3">
                  <span className="font-mono text-xs">{run.run_id}</span>
                  {run.status === "ok" ? null : (
                    <span className="ml-2">
                      {run.status === "failed" ? (
                        <ActionableStatus tone="failure">{t("qualityTrend.runStatus.failed")}</ActionableStatus>
                      ) : (
                        <NormalStatus className="text-xs text-muted-foreground">{t("qualityTrend.runStatus.cancelled")}</NormalStatus>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {run.timestamp === null ? (
                    <span data-legacy-run="true">
                      <UnknownStatus className="text-xs">{t("qualityTrend.timeNotRecorded")}</UnknownStatus>
                    </span>
                  ) : (
                    formatDateTime(run.timestamp)
                  )}
                </td>
                <td className="px-5 py-3">
                  <RunResults run={run} />
                </td>
                <td className="px-5 py-3">
                  <PassRate run={run} />
                </td>
                <td className="px-5 py-3">
                  {run.validated_rows === null ? (
                    <MissingStatus className="text-xs" label={t("qualityTrend.validatedRowsMissing")} />
                  ) : (
                    run.validated_rows.toLocaleString("ko-KR")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** PASS/WARN/FAIL counts as words, with a proportional bar beside them; colour never alone. */
function RunResults({ run }: { run: DatasetQualityHistoryEntry }) {
  if (!isEvaluated(run)) return <NotEvaluatedStatus className="text-xs font-semibold" />;
  const total = run.evaluated_checks;
  const segments = [
    { key: "pass", count: run.pass_count, className: "bg-status-success-solid" },
    { key: "warn", count: run.warn_count, className: "bg-status-warning-solid" },
    { key: "fail", count: run.fail_count, className: "bg-status-failure-solid" },
  ];
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
        {segments.map((segment) =>
          segment.count > 0 ? (
            <span key={segment.key} className={segment.className} data-segment={segment.key} style={{ width: `${(segment.count / total) * 100}%` }} />
          ) : null,
        )}
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        PASS {run.pass_count} · WARN {run.warn_count} · FAIL {run.fail_count}
      </span>
    </div>
  );
}

/** `rule_pass_rate` as a percentage with "passed of evaluated" beside it. */
function PassRate({ run }: { run: DatasetQualityHistoryEntry }) {
  const { t } = useTranslation();
  if (!isEvaluated(run)) return <NotEvaluatedStatus className="text-xs font-semibold" />;
  // Checks were evaluated but Builder sent no rate: say so rather than derive one.
  if (run.rule_pass_rate === null) return <UnknownStatus className="text-xs" />;
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold">{t("qualityTrend.percent", { value: Math.round(run.rule_pass_rate * 100) })}</span>{" "}
      <span className="text-xs text-muted-foreground">{t("qualityTrend.passedOf", { passed: run.pass_count, total: run.evaluated_checks })}</span>
    </span>
  );
}

/**
 * Pass rate over the fetched runs, oldest on the left. A run without a rate leaves a gap — the
 * line breaks there instead of dropping to 0. The marks use the Brand v2 chart token
 * `data-accent-strong`, which keeps 3:1 against the card (#631).
 */
function PassRateSparkline({ runs }: { runs: DatasetQualityHistoryEntry[] }) {
  const { t } = useTranslation();
  const chronological = [...runs].reverse();
  const width = 240;
  const height = 48;
  const pad = 4;
  const step = chronological.length > 1 ? (width - pad * 2) / (chronological.length - 1) : 0;
  const points = chronological.map((run, index) => ({
    run,
    x: chronological.length > 1 ? pad + index * step : width / 2,
    y: isEvaluated(run) && run.rule_pass_rate !== null ? pad + (1 - run.rule_pass_rate) * (height - pad * 2) : null,
  }));
  const rated = points.filter((point) => point.y !== null);
  if (rated.length === 0) {
    return <p className="text-xs text-muted-foreground" data-trend-state="no-rate">{t("qualityTrend.noRateYet")}</p>;
  }

  // One path segment per run of consecutive rated points; an unrated run splits the line.
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  if (current.length > 1) segments.push(current.join(" "));

  const unrated = points.length - rated.length;
  return (
    <figure className="flex flex-wrap items-center gap-3">
      <svg
        role="img"
        aria-label={t("qualityTrend.sparklineLabel", { runs: points.length, rated: rated.length })}
        className="h-12 w-60 text-muted-foreground"
        viewBox={`0 0 ${width} ${height}`}
        data-chart="pass-rate"
      >
        <line x1={pad} x2={width - pad} y1={pad} y2={pad} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 3" />
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="currentColor" strokeOpacity={0.3} />
        {segments.map((d, index) => (
          <path key={index} d={d} className="stroke-data-accent-strong" fill="none" strokeWidth={2} strokeLinejoin="round" />
        ))}
        {rated.map((point) => (
          <circle key={point.run.run_id} cx={point.x} cy={point.y ?? 0} r={2.5} className="fill-data-accent-strong" data-point={point.run.run_id} />
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        {t("qualityTrend.sparklineCaption")}
        {unrated > 0 ? ` ${t("qualityTrend.sparklineGaps", { gaps: unrated })}` : ""}
      </figcaption>
    </figure>
  );
}
